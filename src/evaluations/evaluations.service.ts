import {
  resolveStudentPlacement,
  progressionRecordSelect,
} from '../common/utils/student-placement.util';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import {
  attachTargetLabelViews,
  loadTargetLabels,
  targetLabelSelect,
} from '../common/utils/target-labels.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { evaluation_participant_scope, Prisma } from '@prisma/client';
import { reviewJson } from '../reviewed-workflows/reviewed-operation.store';
import { EvaluationTargetingDto } from './dto/evaluation-targeting.dto';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import {
  activityState,
  recordEvaluationActivity,
} from './evaluation-activity.util';

import {
  normalizeClassGroup,
  normalizeClassGroups,
} from '../common/utils/class-group.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { EvaluationGroupScopeDto } from './dto/evaluation-group-scope.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

import { ListEvaluationsQueryDto } from './dto/list-evaluations-query.dto';

import { PreviewEvaluationParticipantsDto } from './dto/preview-evaluation-participants.dto';

const evaluationInclude = {
  course_offerings: {
    select: {
      id: true,

      section_code: true,

      year_level: true,

      class_type: true,

      courses: {
        select: {
          id: true,
          department_id: true,

          course_code: true,

          course_name: true,
        },
      },

      semesters: {
        select: {
          id: true,

          semester_name: true,

          semester_number: true,

          academic_year_id: true,

          academic_years: {
            select: {
              id: true,

              name: true,

              start_year: true,
            },
          },
        },
      },

      users: {
        select: {
          id: true,

          full_name: true,
        },
      },
    },
  },

  survey_versions: {
    select: {
      id: true,

      version_no: true,

      status: true,

      surveys: {
        select: {
          id: true,

          title: true,
        },
      },
    },
  },

  generation_targets: {
    select: {
      ...targetLabelSelect,
      generation_id: true,

      student_generations: {
        select: {
          major_id: true,
          generation_number: true,
          majors: {
            select: { id: true, code: true, name: true, department_id: true },
          },
          id: true,

          name: true,
        },
      },
    },

    orderBy: {
      generation_id: 'asc' as const,
    },
  },

  group_targets: {
    select: {
      ...targetLabelSelect,
      academic_year_id: true,
      generation_id: true,
      major_id: true,
      year_level: true,
      class_group: true,

      academic_years: {
        select: {
          id: true,
          name: true,
          start_year: true,
        },
      },

      student_generations: {
        select: {
          major_id: true,
          generation_number: true,
          majors: {
            select: { id: true, code: true, name: true, department_id: true },
          },
          id: true,
          name: true,
        },
      },

      majors: {
        select: {
          id: true,
          name: true,
        },
      },
    },

    orderBy: [
      {
        generation_id: 'asc' as const,
      },
      {
        major_id: 'asc' as const,
      },
      {
        year_level: 'asc' as const,
      },
      {
        class_group: 'asc' as const,
      },
    ],
  },

  _count: {
    select: {
      evaluation_participants: true,

      responses: true,
    },
  },
} satisfies Prisma.evaluationsInclude;

type EligibleStudent = {
  user_id: bigint;
  student_id: bigint;
  student_code: string;
  full_name: string;
  generation_id: bigint;
  generation_name: string;
  generation_number: number | null;
  generation_major_id: bigint | null;
  effective_year_level: number | null;
  year_level_source:
    | 'ACADEMIC_RECORD'
    | 'GENERATION_CALCULATION'
    | 'PROGRESSION_CALCULATION'
    | 'NOT_STARTED'
    | 'BEYOND_PROGRAM'
    | 'UNAVAILABLE';
  placement_academic_year_id: bigint;
  placement_major_id: bigint | null;
  class_group: string | null;
};

type EligibilityResult = {
  participant_scope: evaluation_participant_scope;
  generation_ids: bigint[];
  group_scope: {
    academic_year_id: bigint;
    generation_id: bigint;
    major_id: bigint;
    year_level: number;
    class_groups: string[];
  } | null;
  group_scopes?: ResolvedEvaluationGroupScope[];
  eligible_students: EligibleStudent[];
  enrolled_count: number;
  ineligible_count: number;
  ineligible_reasons: {
    audience_not_selected?: number;
    not_active_student: number;
    missing_student_profile: number;
    generation_not_selected: number;
    year_level_mismatch: number;
    year_level_unavailable: number;
    group_generation_mismatch: number;
    group_major_mismatch: number;
    group_year_level_mismatch: number;
    group_missing_placement: number;
    class_group_mismatch: number;
    paused_student: number;
    missing_yearly_group: number;
    progression_unresolved: number;
  };
};

type ResolvedEvaluationGroupScope = {
  academic_year_id: bigint;
  generation_id: bigint;
  major_id: bigint;
  year_level: number;
  class_groups: string[];
};

@Injectable()
export class EvaluationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListEvaluationsQueryDto, actorId?: bigint) {
    const scope =
      actorId === undefined
        ? []
        : await assertDepartmentScope(this.prisma, actorId);
    const rows = await this.prisma.evaluations.findMany({
      where: {
        status: query.status,
        ...(scope.length
          ? { course_offerings: { courses: { department_id: { in: scope } } } }
          : {}),
      },

      include: evaluationInclude,

      orderBy: {
        id: 'asc',
      },
    });
    return Promise.all(
      rows.map(async (row) => ({
        ...attachTargetLabelViews(row),
        filter_metadata: await this.audienceMetadata(row),
      })),
    );
  }

  async findOne(id: bigint, actorId?: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: {
        id,
      },

      include: evaluationInclude,
    });

    if (!evaluation) {
      throw new NotFoundException('Evaluation not found');
    }

    if (actorId !== undefined)
      await assertDepartmentScope(
        this.prisma,
        actorId,
        evaluation.course_offerings.courses.department_id,
      );
    return {
      ...attachTargetLabelViews(evaluation),
      filter_metadata: await this.audienceMetadata(evaluation),
    };
  }

  private async audienceMetadata(evaluation: {
    id: bigint;
    course_offerings: {
      courses: { department_id: bigint };
      semesters: { academic_year_id: bigint; semester_number: number | null };
    };
  }) {
    const participants = await this.prisma.evaluation_participants.findMany({
      where: { evaluation_id: evaluation.id },
      select: { placement_snapshot: true },
    });
    const contexts = participants.map(
      (p) =>
        p.placement_snapshot as {
          major?: { id?: string };
          year_level?: number;
        } | null,
    );
    const available =
      contexts.length > 0 &&
      contexts.every((c) => c?.major?.id && Number.isInteger(c.year_level));
    const pairs = new Map<string, { major_id: string; year_level: number }>();
    for (const c of contexts)
      if (c?.major?.id && c.year_level)
        pairs.set(`${c.major.id}:${c.year_level}`, {
          major_id: c.major.id,
          year_level: c.year_level,
        });
    return {
      academic_year_id: String(
        evaluation.course_offerings.semesters.academic_year_id,
      ),
      semester_number: evaluation.course_offerings.semesters.semester_number,
      department_id: String(evaluation.course_offerings.courses.department_id),
      audience_pairs: [...pairs.values()],
      audience_status: available ? 'COMPLETE' : 'UNAVAILABLE',
      unavailable_reason: available
        ? null
        : 'LEGACY_PARTICIPANT_PLACEMENT_NOT_CAPTURED',
    };
  }

  async previewParticipants(
    dto: PreviewEvaluationParticipantsDto,
    actorId?: bigint,
  ) {
    return inSerializableTransaction(this.prisma, (db) =>
      new EvaluationsService(db).previewParticipantsInTransaction(dto, actorId),
    );
  }

  private async previewParticipantsInTransaction(
    dto: PreviewEvaluationParticipantsDto,
    actorId?: bigint,
  ) {
    const offeringId = BigInt(dto.course_offering_id);
    if (actorId !== undefined) {
      const offering = await this.prisma.course_offerings.findUnique({
        where: { id: offeringId },
        include: { courses: true },
      });
      if (!offering) throw new NotFoundException('Course offering not found');
      await assertDepartmentScope(
        this.prisma,
        actorId,
        offering.courses.department_id,
      );
    }

    const result = await this.resolveAudience(offeringId, dto);

    return {
      course_offering_id: offeringId.toString(),

      participant_scope: result.participant_scope,

      generation_ids: result.generation_ids.map((id) => id.toString()),

      group_scope:
        result.group_scope === null
          ? null
          : {
              academic_year_id: result.group_scope.academic_year_id.toString(),
              generation_id: result.group_scope.generation_id.toString(),
              major_id: result.group_scope.major_id.toString(),
              year_level: result.group_scope.year_level,
              class_groups: result.group_scope.class_groups,
            },

      group_scopes: (result.group_scopes ?? []).map((scope) => ({
        ...scope,
        academic_year_id: String(scope.academic_year_id),
        generation_id: String(scope.generation_id),
        major_id: String(scope.major_id),
      })),
      major_ids: dto.major_ids ?? null,
      audience_breakdown: await this.audienceBreakdown(
        result.eligible_students,
      ),
      enrolled_count: result.enrolled_count,

      eligible_count: result.eligible_students.length,

      ineligible_count: result.ineligible_count,

      ineligible_reasons: {
        audience_not_selected:
          result.ineligible_reasons.audience_not_selected ?? 0,
        not_active_student: result.ineligible_reasons.not_active_student,
        missing_student_profile:
          result.ineligible_reasons.missing_student_profile,
        generation_not_selected:
          result.ineligible_reasons.generation_not_selected,
        year_level_mismatch: result.ineligible_reasons.year_level_mismatch,
        year_level_unavailable:
          result.ineligible_reasons.year_level_unavailable,
        group_generation_mismatch:
          result.ineligible_reasons.group_generation_mismatch,
        group_major_mismatch: result.ineligible_reasons.group_major_mismatch,
        group_year_level_mismatch:
          result.ineligible_reasons.group_year_level_mismatch,
        group_missing_placement:
          result.ineligible_reasons.group_missing_placement,
        class_group_mismatch: result.ineligible_reasons.class_group_mismatch,
        paused_student: result.ineligible_reasons.paused_student,
        missing_yearly_group: result.ineligible_reasons.missing_yearly_group,
        progression_unresolved:
          result.ineligible_reasons.progression_unresolved,
      },

      eligible_students: result.eligible_students.map((student) => ({
        user_id: student.user_id.toString(),

        student_id: student.student_id.toString(),

        student_code: student.student_code,

        full_name: student.full_name,

        generation_id: student.generation_id.toString(),

        generation_name: student.generation_name,
        generation_number: student.generation_number,
        generation_major_id: student.generation_major_id?.toString() ?? null,

        effective_year_level: student.effective_year_level,

        year_level_source: student.year_level_source,

        placement_academic_year_id:
          student.placement_academic_year_id.toString(),

        placement_major_id: student.placement_major_id?.toString() ?? null,

        class_group: student.class_group,
      })),

      confirmed_student_ids: result.eligible_students.map((student) =>
        student.user_id.toString(),
      ),
    };
  }

  /** Read-only full creation review; unlike participant preview it checks version/dates. */
  async previewReviewedCreate(dto: CreateEvaluationDto) {
    if (!dto.survey_version_id) {
      throw new BadRequestException(
        'Explicit survey_version_id is required for reviewed creation',
      );
    }
    const versionId = await this.resolveSurveyVersion(dto);
    this.checkWindow(
      dto.start_at ? new Date(dto.start_at) : null,
      dto.end_at ? new Date(dto.end_at) : null,
    );
    const preview = await this.previewParticipants(dto);
    if (!preview.eligible_count)
      throw new BadRequestException(
        'No eligible students match the reviewed scope',
      );
    const duplicate = await this.prisma.evaluations.findFirst({
      where: {
        course_offering_id: BigInt(dto.course_offering_id),
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException({
        code: 'EVALUATION_EXISTS',
        message: 'Evaluation already exists for this teaching assignment',
        existing_evaluation_id: String(duplicate.id),
      });
    return {
      ...preview,
      target_labels: await this.audienceLabels(dto),
      survey_version_id: versionId.toString(),
      start_at: dto.start_at ?? null,
      end_at: dto.end_at ?? null,
    };
  }

  async create(dto: CreateEvaluationDto, createdBy: bigint) {
    try {
      return await inSerializableTransaction(
        this.prisma,
        (db) => new EvaluationsService(db).createInTransaction(dto, createdBy),
        (e: any) => {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          ) {
            throw new ConflictException(
              'This course offering already has an evaluation using this survey version',
            );
          }

          throw e;
        },
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        const existing = await this.prisma.evaluations.findFirst({
          where: { course_offering_id: BigInt(dto.course_offering_id) },
          include: {
            course_offerings: { include: { courses: true, semesters: true } },
          },
        });
        if (existing) {
          await assertDepartmentScope(
            this.prisma,
            createdBy,
            existing.course_offerings.courses.department_id,
          );
          throw new ConflictException({
            code: 'EVALUATION_EXISTS',
            message: 'Evaluation already exists for this teaching assignment',
            existing_evaluation_id: String(existing.id),
            academic_year_id: String(
              existing.course_offerings.semesters.academic_year_id,
            ),
          });
        }
      }
      throw error;
    }
  }

  private async createInTransaction(
    dto: CreateEvaluationDto,

    createdBy: bigint,
  ) {
    const offeringId = BigInt(dto.course_offering_id);

    const offering = await this.prisma.course_offerings.findUnique({
      where: {
        id: offeringId,
      },

      select: {
        id: true,
      },
    });

    if (!offering) {
      throw new BadRequestException(
        'course_offering_id does not match any course offering',
      );
    }

    const context = await this.prisma.course_offerings.findUniqueOrThrow({
      where: { id: offeringId },
      include: { courses: true },
    });
    await assertDepartmentScope(
      this.prisma,
      createdBy,
      context.courses.department_id,
    );
    const versionId = await this.resolveSurveyVersion(dto);

    const startAt = dto.start_at ? new Date(dto.start_at) : null;

    const endAt = dto.end_at ? new Date(dto.end_at) : null;

    this.checkWindow(
      startAt,

      endAt,
    );

    const duplicate = await this.prisma.evaluations.findFirst({
      where: { course_offering_id: offeringId },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException({
        code: 'EVALUATION_EXISTS',
        message: 'Evaluation already exists for this teaching assignment',
        existing_evaluation_id: String(duplicate.id),
      });

    const scope =
      dto.participant_scope ?? evaluation_participant_scope.ALL_ENROLLED;

    const generationIds = this.parseGenerationIds(
      scope,

      dto.generation_ids,
    );

    const requiresConfirmedParticipants =
      scope === evaluation_participant_scope.SELECTED_GENERATIONS ||
      dto.group_scope !== undefined ||
      dto.group_scopes !== undefined ||
      dto.major_ids !== undefined ||
      dto.confirmed_student_ids !== undefined;

    let eligibility: EligibilityResult | null = null;

    if (requiresConfirmedParticipants) {
      if (dto.confirmed_student_ids === undefined) {
        throw new BadRequestException(
          'confirmed_student_ids is required after previewing the selected participant scope',
        );
      }

      eligibility = await this.resolveAudience(offeringId, dto);

      if (eligibility.eligible_students.length === 0) {
        throw new BadRequestException(
          'No eligible students match the selected participant scope',
        );
      }

      this.assertConfirmedStudentsUnchanged(
        dto.confirmed_student_ids,

        eligibility.eligible_students.map((student) => student.user_id),
      );
    }

    const now = new Date();

    try {
      const evaluationId = await this.prisma.$transaction(async (tx) => {
        let transactionEligibility = eligibility;

        if (requiresConfirmedParticipants) {
          transactionEligibility = await this.resolveAudience(
            offeringId,
            dto,
            tx,
          );

          this.assertConfirmedStudentsUnchanged(
            dto.confirmed_student_ids!,
            transactionEligibility.eligible_students.map(
              (student) => student.user_id,
            ),
          );

          if (transactionEligibility.eligible_students.length === 0) {
            throw new BadRequestException(
              'No eligible students match the selected participant scope',
            );
          }
        }

        const labels = await this.audienceLabels(dto);
        const created = await tx.evaluations.create({
          data: {
            course_offering_id: offeringId,

            survey_version_id: versionId,

            participant_scope: scope,

            status: 'DRAFT',

            start_at: startAt,

            end_at: endAt,

            created_by: createdBy,

            created_at: now,

            updated_at: now,
          },

          select: {
            id: true,
          },
        });

        if (generationIds.length > 0) {
          await tx.evaluation_generation_targets.createMany({
            data: generationIds.map((generationId) => ({
              evaluation_id: created.id,

              generation_id: generationId,
              historical_labels: labels.generations.find(
                (entry) => entry.generation_id === String(generationId),
              )!.historical_labels,
              labels_captured_at: now,

              created_at: now,
            })),
          });
        }

        for (const frozen of transactionEligibility?.group_scopes ?? []) {
          const captured = await loadTargetLabels(tx, [], frozen);
          await tx.evaluation_group_targets.createMany({
            data: frozen.class_groups.map((classGroup) => ({
              evaluation_id: created.id,
              academic_year_id: frozen.academic_year_id,
              generation_id: frozen.generation_id,
              major_id: frozen.major_id,
              year_level: frozen.year_level,
              class_group: classGroup,
              historical_labels: captured.groups.find(
                (entry) => entry.class_group === classGroup,
              )!.historical_labels,
              labels_captured_at: now,
              created_at: now,
            })),
          });
        }
        const majors = transactionEligibility
          ? await tx.majors.findMany({
              where: {
                id: {
                  in: transactionEligibility.eligible_students.flatMap(
                    (student) =>
                      student.placement_major_id
                        ? [student.placement_major_id]
                        : [],
                  ),
                },
              },
            })
          : [];
        const cohorts = transactionEligibility
          ? await tx.student_generations.findMany({
              where: {
                id: {
                  in: transactionEligibility.eligible_students.map(
                    (student) => student.generation_id,
                  ),
                },
              },
            })
          : [];

        if (transactionEligibility !== null) {
          await tx.evaluation_participants.createMany({
            data: transactionEligibility.eligible_students.map((student) => ({
              evaluation_id: created.id,

              student_id: student.user_id,
              placement_snapshot: reviewJson({
                academic_year_id: student.placement_academic_year_id,
                major:
                  majors.find(
                    (major) => major.id === student.placement_major_id,
                  ) ?? null,
                year_level: student.effective_year_level,
                class_group: student.class_group,
                generation:
                  cohorts.find(
                    (cohort) => cohort.id === student.generation_id,
                  ) ?? null,
              }),
              survey_version_id: versionId,

              has_submitted: false,

              created_at: now,
            })),
          });
        }

        await recordEvaluationActivity(
          tx as PrismaService,
          created.id,
          'CREATED',
          createdBy,
          null,
          {
            start_at: startAt?.toISOString() ?? null,
            end_at: endAt?.toISOString() ?? null,
            status: 'DRAFT',
          },
        );
        return created.id;
      });

      return this.findOne(evaluationId);
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'This course offering already has an evaluation using this survey version',
        );
      }

      throw e;
    }
  }

  async updateSchedule(id: bigint, dto: UpdateScheduleDto, actorId?: bigint) {
    return inSerializableTransaction(this.prisma, (db) =>
      new EvaluationsService(db).updateScheduleInTransaction(id, dto, actorId),
    );
  }

  private async updateScheduleInTransaction(
    id: bigint,

    dto: UpdateScheduleDto,
    actorId?: bigint,
  ) {
    const evaluation = await this.findOne(id, actorId);

    if (dto.start_at === null || dto.end_at === null)
      throw new BadRequestException(
        'Schedule dates must be valid ISO strings, not null',
      );
    const now = new Date();
    const extending =
      evaluation.status === 'OPEN' &&
      evaluation.start_at !== null &&
      evaluation.end_at !== null &&
      evaluation.start_at <= now &&
      now < evaluation.end_at;
    if (evaluation.status !== 'DRAFT') {
      if (!extending)
        throw new ConflictException(
          'Only DRAFT schedules or active OPEN deadlines can be changed',
        );
      if (
        dto.start_at !== undefined ||
        !dto.end_at ||
        new Date(dto.end_at) <= evaluation.end_at!
      )
        throw new BadRequestException(
          'An active extension must supply only a strictly later end_at',
        );
    }

    const startAt =
      dto.start_at !== undefined ? new Date(dto.start_at) : evaluation.start_at;

    const endAt =
      dto.end_at !== undefined ? new Date(dto.end_at) : evaluation.end_at;

    this.checkWindow(
      startAt,

      endAt,
    );

    const updated = await this.prisma.evaluations.update({
      where: {
        id,
      },

      data: {
        start_at: startAt,

        end_at: endAt,

        updated_at: new Date(),
      },

      include: evaluationInclude,
    });
    await recordEvaluationActivity(
      this.prisma,
      id,
      extending ? 'DEADLINE_EXTENDED' : 'SCHEDULE_UPDATED',
      actorId,
      activityState(evaluation),
      activityState(updated),
    );
    return updated;
  }

  async open(id: bigint, actorId?: bigint) {
    return inSerializableTransaction(this.prisma, (db) =>
      new EvaluationsService(db).openInTransaction(id, false, false, actorId),
    );
  }

  async previewReviewedOpening(id: bigint) {
    return this.openInTransaction(id, true, true);
  }

  /** Called only after the reviewed workflow verifies its stored opening snapshot. */
  async openReviewedAssigned(id: bigint, actorId?: bigint) {
    return this.openInTransaction(id, true, false, actorId);
  }

  private async openInTransaction(
    id: bigint,
    reviewedRetention = false,
    previewOnly = false,
    actorId?: bigint,
  ) {
    if (actorId !== undefined) await this.findOne(id, actorId);
    const evaluation = await this.prisma.evaluations.findUnique({
      where: {
        id,
      },

      include: {
        survey_versions: {
          include: {
            _count: {
              select: {
                questions: true,
              },
            },
          },
        },

        generation_targets: {
          select: {
            generation_id: true,
          },
        },

        group_targets: {
          select: {
            academic_year_id: true,
            generation_id: true,
            major_id: true,
            year_level: true,
            class_group: true,
          },
        },

        _count: {
          select: {
            evaluation_participants: true,
          },
        },
      },
    });

    if (!evaluation) {
      throw new NotFoundException('Evaluation not found');
    }

    if (evaluation.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT evaluation can be opened');
    }

    if (!evaluation.start_at || !evaluation.end_at) {
      throw new BadRequestException(
        'Set start_at and end_at before opening the evaluation',
      );
    }

    this.checkWindow(evaluation.start_at, evaluation.end_at);
    if (evaluation.end_at <= new Date()) {
      throw new BadRequestException('end_at is already in the past');
    }

    if (evaluation.survey_versions.status === 'ARCHIVED') {
      throw new BadRequestException('The survey version is archived');
    }

    if (evaluation.survey_versions._count.questions === 0) {
      throw new BadRequestException('The survey version has no questions');
    }

    const latestVersion = await this.prisma.survey_versions.findFirst({
      where: { survey_id: evaluation.survey_versions.survey_id },
      orderBy: { version_no: 'desc' },
      select: { id: true },
    });
    if (
      !latestVersion ||
      (!reviewedRetention && latestVersion.id !== evaluation.survey_version_id)
    ) {
      throw new ConflictException(
        'A newer question version exists. Review this draft before opening; its assigned version has been preserved.',
      );
    }

    const hasFrozenGroupTargets = evaluation.group_targets.length > 0;

    const isTargetedEvaluation =
      evaluation.participant_scope ===
        evaluation_participant_scope.SELECTED_GENERATIONS ||
      hasFrozenGroupTargets;

    if (
      evaluation._count.evaluation_participants === 0 &&
      isTargetedEvaluation
    ) {
      throw new BadRequestException(
        'This targeted evaluation has no confirmed participants. Preview and confirm the eligible students before opening.',
      );
    }

    let legacyParticipantIds: bigint[] = [];
    const legacySnapshots = new Map<bigint, Prisma.InputJsonValue>();

    if (
      evaluation._count.evaluation_participants === 0 &&
      evaluation.participant_scope ===
        evaluation_participant_scope.ALL_ENROLLED &&
      !hasFrozenGroupTargets
    ) {
      const eligibility = await this.resolveEligibleStudents(
        evaluation.course_offering_id,

        evaluation_participant_scope.ALL_ENROLLED,

        [],
      );

      const majors = await this.prisma.majors.findMany({
        where: {
          id: {
            in: eligibility.eligible_students.flatMap((student) =>
              student.placement_major_id ? [student.placement_major_id] : [],
            ),
          },
        },
      });
      const cohorts = await this.prisma.student_generations.findMany({
        where: {
          id: {
            in: eligibility.eligible_students.map(
              (student) => student.generation_id,
            ),
          },
        },
      });
      for (const student of eligibility.eligible_students)
        legacySnapshots.set(
          student.user_id,
          reviewJson({
            academic_year_id: student.placement_academic_year_id,
            major:
              majors.find((major) => major.id === student.placement_major_id) ??
              null,
            year_level: student.effective_year_level,
            class_group: student.class_group,
            generation:
              cohorts.find((cohort) => cohort.id === student.generation_id) ??
              null,
          }),
        );
      legacyParticipantIds = eligibility.eligible_students.map(
        (student) => student.user_id,
      );

      if (legacyParticipantIds.length === 0) {
        throw new BadRequestException(
          'No eligible students are enrolled in this course offering',
        );
      }
    }

    if (reviewedRetention && evaluation._count.evaluation_participants === 0) {
      throw new BadRequestException(
        'Reviewed assigned-version opening requires frozen confirmed participants',
      );
    }
    if (previewOnly) {
      return {
        evaluation_id: id.toString(),
        assigned_survey_id: evaluation.survey_versions.survey_id.toString(),
        assigned_survey_version_id: evaluation.survey_version_id.toString(),
        latest_survey_version_id: latestVersion!.id.toString(),
        can_retain_assigned_version: true,
        blocking_reasons: [],
        frozen_participant_count: evaluation._count.evaluation_participants,
        start_at: evaluation.start_at,
        end_at: evaluation.end_at,
      };
    }
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.evaluations.updateMany({
        where: {
          id,

          status: 'DRAFT',
        },

        data: {
          status: 'OPEN',

          updated_at: now,
        },
      });

      if (changed.count === 0) {
        throw new ConflictException('Only a DRAFT evaluation can be opened');
      }

      await tx.survey_versions.update({
        where: {
          id: evaluation.survey_version_id,
        },

        data: {
          status: 'LOCKED',

          locked_at: evaluation.survey_versions.locked_at ?? now,
        },
      });

      if (legacyParticipantIds.length > 0) {
        await tx.evaluation_participants.createMany({
          data: legacyParticipantIds.map((studentId) => ({
            evaluation_id: id,

            student_id: studentId,
            placement_snapshot: legacySnapshots.get(studentId),
            survey_version_id: evaluation.survey_version_id,

            has_submitted: false,

            created_at: now,
          })),

          skipDuplicates: true,
        });
      }
    });

    const opened = await this.findOne(id);
    await recordEvaluationActivity(
      this.prisma,
      id,
      'SCHEDULED',
      actorId,
      activityState(evaluation),
      activityState(opened),
    );
    return opened;
  }

  async close(id: bigint, actorId?: bigint) {
    return inSerializableTransaction(this.prisma, (db) =>
      new EvaluationsService(db).closeInTransaction(id, actorId),
    );
  }

  private async closeInTransaction(id: bigint, actorId?: bigint) {
    const before = await this.findOne(id, actorId);

    const changed = await this.prisma.evaluations.updateMany({
      where: {
        id,

        status: 'OPEN',
      },

      data: {
        status: 'CLOSED',

        updated_at: new Date(),
      },
    });

    if (changed.count === 0) {
      throw new ConflictException('Only an OPEN evaluation can be closed');
    }

    const closed = await this.findOne(id);
    await recordEvaluationActivity(
      this.prisma,
      id,
      'CLOSED',
      actorId,
      activityState(before),
      activityState(closed),
    );
    return closed;
  }

  async remove(id: bigint, actorId?: bigint) {
    return inSerializableTransaction(this.prisma, (db) =>
      new EvaluationsService(db).removeInTransaction(id, actorId),
    );
  }

  private async removeInTransaction(id: bigint, actorId?: bigint) {
    const evaluation = await this.findOne(id, actorId);

    if (evaluation.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT evaluation can be deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.evaluation_participants.deleteMany({
        where: {
          evaluation_id: id,
        },
      });

      await tx.evaluation_generation_targets.deleteMany({
        where: {
          evaluation_id: id,
        },
      });

      await tx.evaluation_group_targets.deleteMany({
        where: {
          evaluation_id: id,
        },
      });

      await tx.evaluations.delete({
        where: {
          id,
        },
      });
    });
  }

  private resolveEvaluationGroupScope(
    rawGroupScope: EvaluationGroupScopeDto | undefined,
    offering: {
      year_level: number | null;
      semesters: {
        academic_year_id: bigint;
      };
      group_scopes: Array<{
        academic_year_id: bigint;
        generation_id: bigint;
        major_id: bigint;
        year_level: number;
        class_group: string;
      }>;
    },
  ): ResolvedEvaluationGroupScope | null {
    if (rawGroupScope === undefined) {
      return null;
    }

    const academicYearId = BigInt(rawGroupScope.academic_year_id);
    const generationId = BigInt(rawGroupScope.generation_id);
    const majorId = BigInt(rawGroupScope.major_id);

    const classGroups = normalizeClassGroups(rawGroupScope.class_groups);

    if (classGroups.length === 0) {
      throw new BadRequestException(
        'Evaluation group scope must contain at least one non-empty class group',
      );
    }

    if (academicYearId !== offering.semesters.academic_year_id) {
      throw new BadRequestException(
        'Evaluation group scope academic_year_id must match the course offering academic year',
      );
    }

    if (
      offering.year_level !== null &&
      rawGroupScope.year_level !== offering.year_level
    ) {
      throw new BadRequestException(
        'Evaluation group scope year_level must match the course offering year_level',
      );
    }

    if (offering.group_scopes.length === 0) {
      throw new BadRequestException(
        'This course offering has no explicit group scope and cannot be used for group-targeted evaluation',
      );
    }

    const allowedGroups = new Set(
      offering.group_scopes
        .filter(
          (scope) =>
            scope.academic_year_id === academicYearId &&
            scope.generation_id === generationId &&
            scope.major_id === majorId &&
            scope.year_level === rawGroupScope.year_level,
        )
        .map((scope) => normalizeClassGroup(scope.class_group))
        .filter((value): value is string => value !== null),
    );

    const invalidGroups = classGroups.filter(
      (classGroup) => !allowedGroups.has(classGroup),
    );

    if (invalidGroups.length > 0) {
      throw new BadRequestException(
        `The course offering does not serve the requested group scope: ${invalidGroups.join(', ')}`,
      );
    }

    return {
      academic_year_id: academicYearId,
      generation_id: generationId,
      major_id: majorId,
      year_level: rawGroupScope.year_level,
      class_groups: classGroups,
    };
  }

  private async audienceLabels(dto: EvaluationTargetingDto) {
    const generations = this.parseGenerationIds(
      dto.participant_scope ?? evaluation_participant_scope.ALL_ENROLLED,
      dto.generation_ids,
    );
    const labels = await loadTargetLabels(this.prisma, generations, null);
    for (const scope of dto.group_scopes ??
      (dto.group_scope ? [dto.group_scope] : [])) {
      const captured = await loadTargetLabels(this.prisma, [], {
        ...scope,
        academic_year_id: BigInt(scope.academic_year_id),
        generation_id: BigInt(scope.generation_id),
        major_id: BigInt(scope.major_id),
      });
      labels.groups.push(...captured.groups);
    }
    return labels;
  }

  private async audienceBreakdown(students: EligibleStudent[]) {
    const majors = await this.prisma.majors.findMany({
      where: {
        id: {
          in: students.flatMap((s) =>
            s.placement_major_id ? [s.placement_major_id] : [],
          ),
        },
      },
      select: { id: true, code: true, name: true },
    });
    const counts = new Map<
      string,
      {
        major_id: string | null;
        major_label: string;
        class_group: string | null;
        count: number;
      }
    >();
    for (const student of students) {
      const major = majors.find((m) => m.id === student.placement_major_id);
      const key = JSON.stringify([
        student.placement_major_id?.toString() ?? null,
        student.class_group,
      ]);
      const entry = counts.get(key) ?? {
        major_id: student.placement_major_id?.toString() ?? null,
        major_label: major ? `${major.code} · ${major.name}` : 'Unavailable',
        class_group: student.class_group,
        count: 0,
      };
      entry.count++;
      counts.set(key, entry);
    }
    return [...counts.values()];
  }

  private async resolveAudience(
    offeringId: bigint,
    dto: EvaluationTargetingDto,
    tx?: Prisma.TransactionClient,
  ): Promise<EligibilityResult> {
    const db = tx ?? this.prisma;
    if (dto.group_scope === null)
      throw new BadRequestException(
        'group_scope must be an object; omit it for all eligible enrolled groups',
      );
    if (dto.group_scope !== undefined && dto.group_scopes !== undefined)
      throw new BadRequestException(
        'Supply group_scope or group_scopes, never both',
      );
    if (
      dto.group_scopes !== undefined &&
      (!Array.isArray(dto.group_scopes) || !dto.group_scopes.length)
    )
      throw new BadRequestException('group_scopes must be nonempty');
    if (
      dto.major_ids !== undefined &&
      (!Array.isArray(dto.major_ids) || !dto.major_ids.length)
    )
      throw new BadRequestException('major_ids must be nonempty');
    const scopes =
      dto.group_scopes ?? (dto.group_scope ? [dto.group_scope] : []);
    const mode =
      dto.participant_scope ?? evaluation_participant_scope.ALL_ENROLLED;
    const generations = this.parseGenerationIds(mode, dto.generation_ids);
    const offering = await db.course_offerings.findUnique({
      where: { id: offeringId },
      include: {
        courses: true,
        semesters: { include: { academic_years: true } },
        group_scopes: true,
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    const majorIds = dto.major_ids?.map(BigInt);
    for (const majorId of new Set([
      ...(majorIds ?? []),
      ...scopes.map((s) => BigInt(s.major_id)),
    ])) {
      const major = await db.majors.findUnique({ where: { id: majorId } });
      if (!major || major.department_id !== offering.courses.department_id)
        throw new BadRequestException(
          'Audience major must belong to the course department',
        );
    }
    for (const scope of scopes) {
      if (majorIds && !majorIds.includes(BigInt(scope.major_id)))
        throw new BadRequestException('Group scope conflicts with major_ids');
      if (
        mode === 'SELECTED_GENERATIONS' &&
        !generations.includes(BigInt(scope.generation_id))
      )
        throw new BadRequestException(
          'Group scope conflicts with generation_ids',
        );
      const cohort = await db.student_generations.findUnique({
        where: { id: BigInt(scope.generation_id) },
      });
      if (
        !cohort ||
        (cohort.major_id != null && cohort.major_id !== BigInt(scope.major_id))
      )
        throw new BadRequestException(
          'Group generation does not belong to its major',
        );
    }
    const normalizedScopes = scopes.map((scope) =>
      this.resolveEvaluationGroupScope(scope, offering)!,
    );
    const base = await this.resolveEligibleStudents(
      offeringId,
      mode,
      generations,
      undefined,
      tx,
      offering,
    );
    const selected = new Map<string, EligibleStudent>();
    const resolved: ResolvedEvaluationGroupScope[] = [];
    const scopeMap = new Map<string, ResolvedEvaluationGroupScope>();
    for (const group of normalizedScopes) {
      const key = JSON.stringify([
        String(group.academic_year_id),
        String(group.generation_id),
        String(group.major_id),
        group.year_level,
      ]);
      const existing = scopeMap.get(key);
      if (existing)
        existing.class_groups = [
          ...new Set([...existing.class_groups, ...group.class_groups]),
        ];
      else scopeMap.set(key, group);
      for (const student of base.eligible_students)
        if (
          student.generation_id === group.generation_id &&
          student.placement_major_id === group.major_id &&
          student.effective_year_level === group.year_level &&
          student.class_group !== null &&
          group.class_groups.includes(student.class_group)
        )
          selected.set(String(student.user_id), student);
    }
    resolved.push(...scopeMap.values());
    const students = (
      scopes.length ? [...selected.values()] : base.eligible_students
    )
      .filter(
        (student) =>
          !majorIds ||
          (student.placement_major_id !== null &&
            majorIds.includes(student.placement_major_id)),
      )
      .sort((a, b) =>
        a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0,
      );
    return {
      ...base,
      group_scope: resolved.length === 1 ? resolved[0] : null,
      group_scopes: resolved,
      eligible_students: students,
      ineligible_count: base.enrolled_count - students.length,
      ineligible_reasons: {
        ...base.ineligible_reasons,
        class_group_mismatch: scopes.length
          ? base.eligible_students.length - students.length
          : 0,
        audience_not_selected: base.eligible_students.length - students.length,
      },
    };
  }

  private async resolveEligibleStudents(
    offeringId: bigint,

    scope: evaluation_participant_scope,

    generationIds: bigint[],

    rawGroupScope?: EvaluationGroupScopeDto,

    tx?: Prisma.TransactionClient,
    preloadedOffering?: Prisma.course_offeringsGetPayload<{
      include: {
        courses: true;
        semesters: { include: { academic_years: true } };
        group_scopes: true;
      };
    }>,
  ): Promise<EligibilityResult> {
    const prisma = tx ?? this.prisma;

    const offering =
      preloadedOffering ??
      (await prisma.course_offerings.findUnique({
        where: {
          id: offeringId,
        },

        select: {
          id: true,

          year_level: true,

          group_scopes: {
            select: {
              academic_year_id: true,
              generation_id: true,
              major_id: true,
              year_level: true,
              class_group: true,
            },
          },

          semesters: {
            select: {
              academic_year_id: true,

              academic_years: {
                select: {
                  id: true,

                  name: true,

                  start_year: true,
                },
              },
            },
          },
        },
      }));

    if (!offering) {
      throw new NotFoundException('Course offering not found');
    }

    const groupScope = this.resolveEvaluationGroupScope(
      rawGroupScope,
      offering,
    );

    await this.validateGenerationIds(
      scope,

      generationIds,

      tx,
    );

    const enrollments = await prisma.enrollments.findMany({
      where: {
        course_offering_id: offeringId,
      },

      select: {
        student_id: true,

        users: {
          select: {
            id: true,

            full_name: true,

            role: true,

            status: true,

            student: {
              select: {
                id: true,

                student_code: true,

                generation_id: true,

                student_generations: {
                  select: {
                    major_id: true,
                    generation_number: true,
                    majors: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                        department_id: true,
                      },
                    },
                    id: true,

                    name: true,

                    starting_year_level: true,

                    entry_academic_year: {
                      select: {
                        id: true,

                        start_year: true,
                      },
                    },
                  },
                },

                student_academic_records: { select: progressionRecordSelect },
              },
            },
          },
        },
      },

      orderBy: {
        student_id: 'asc',
      },
    });

    const selectedGenerationSet = new Set(
      generationIds.map((id) => id.toString()),
    );

    const reasons = {
      not_active_student: 0,

      missing_student_profile: 0,

      generation_not_selected: 0,

      year_level_mismatch: 0,

      year_level_unavailable: 0,

      group_generation_mismatch: 0,

      group_major_mismatch: 0,

      group_year_level_mismatch: 0,

      group_missing_placement: 0,

      class_group_mismatch: 0,
      paused_student: 0,
      missing_yearly_group: 0,
      progression_unresolved: 0,
    };

    const eligibleStudents: EligibleStudent[] = [];

    for (const enrollment of enrollments) {
      const user = enrollment.users;

      if (user.role !== 'STUDENT' || user.status !== 'ACTIVE') {
        reasons.not_active_student += 1;

        continue;
      }

      const student = user.student;

      if (!student) {
        reasons.missing_student_profile += 1;

        continue;
      }

      if (
        scope === evaluation_participant_scope.SELECTED_GENERATIONS &&
        !selectedGenerationSet.has(student.generation_id.toString())
      ) {
        reasons.generation_not_selected += 1;

        continue;
      }

      const placement = resolveStudentPlacement(
        student.student_generations,
        student.student_academic_records,
        offering.semesters.academic_years,
      );
      const academicRecord = placement.academic_record;
      if (placement.progression_status === 'UNRESOLVED') {
        reasons.progression_unresolved += 1;
        continue;
      }
      if (placement.progression_status === 'PAUSED') {
        reasons.paused_student += 1;
        continue;
      }
      if (!academicRecord || placement.placement.class_group === null) {
        reasons.missing_yearly_group += 1;
        if (groupScope !== null) reasons.group_missing_placement += 1;
        continue;
      }

      if (groupScope !== null) {
        if (student.generation_id !== groupScope.generation_id) {
          reasons.group_generation_mismatch += 1;
          continue;
        }

        if (academicRecord === null) {
          reasons.group_missing_placement += 1;
          continue;
        }

        if (academicRecord.academic_year_id !== groupScope.academic_year_id) {
          reasons.group_missing_placement += 1;
          continue;
        }

        if (academicRecord.major_id !== groupScope.major_id) {
          reasons.group_major_mismatch += 1;
          continue;
        }

        if (academicRecord.year_level !== groupScope.year_level) {
          reasons.group_year_level_mismatch += 1;
          continue;
        }

        const studentClassGroup = normalizeClassGroup(
          academicRecord.class_group,
        );

        if (
          studentClassGroup === null ||
          !groupScope.class_groups.includes(studentClassGroup)
        ) {
          reasons.class_group_mismatch += 1;
          continue;
        }
      }

      const effectiveYearLevel = placement.effective_year_level;
      const yearLevelSource =
        placement.year_level_source as EligibleStudent['year_level_source'];

      if (effectiveYearLevel === null) {
        reasons.year_level_unavailable += 1;
        continue;
      }

      if (offering.year_level !== null) {
        if (effectiveYearLevel === null) {
          reasons.year_level_unavailable += 1;

          continue;
        }

        if (effectiveYearLevel !== offering.year_level) {
          reasons.year_level_mismatch += 1;

          continue;
        }
      }

      eligibleStudents.push({
        user_id: user.id,

        student_id: student.id,

        student_code: student.student_code,

        full_name: user.full_name,

        generation_id: student.generation_id,

        generation_name: student.student_generations.name,
        generation_number:
          student.student_generations.generation_number ?? null,
        generation_major_id: student.student_generations.major_id ?? null,

        effective_year_level: effectiveYearLevel,

        year_level_source: yearLevelSource,

        placement_academic_year_id: offering.semesters.academic_year_id,

        placement_major_id: academicRecord?.major_id ?? null,

        class_group: normalizeClassGroup(academicRecord?.class_group),
      });
    }

    return {
      participant_scope: scope,

      generation_ids: generationIds,

      group_scope: groupScope,

      eligible_students: eligibleStudents,

      enrolled_count: enrollments.length,

      ineligible_count: enrollments.length - eligibleStudents.length,

      ineligible_reasons: reasons,
    };
  }

  private parseGenerationIds(
    scope: evaluation_participant_scope,

    rawGenerationIds?: string[],
  ): bigint[] {
    if (rawGenerationIds !== undefined && !Array.isArray(rawGenerationIds)) {
      throw new BadRequestException('generation_ids must be an array');
    }
    const values = rawGenerationIds ?? [];

    if (scope === evaluation_participant_scope.ALL_ENROLLED) {
      if (values.length > 0) {
        throw new BadRequestException(
          'generation_ids can only be used when participant_scope is SELECTED_GENERATIONS',
        );
      }

      return [];
    }

    if (scope === evaluation_participant_scope.SELECTED_GENERATIONS) {
      if (values.length === 0) {
        throw new BadRequestException(
          'At least one generation_id is required when participant_scope is SELECTED_GENERATIONS',
        );
      }

      const uniqueIds = new Map<string, bigint>();

      for (const value of values) {
        if (!/^[1-9]\d*$/.test(value)) {
          throw new BadRequestException(
            'Each generation_id must be a positive integer',
          );
        }

        const id = BigInt(value);

        uniqueIds.set(
          id.toString(),

          id,
        );
      }

      return Array.from(uniqueIds.values());
    }

    throw new BadRequestException('Invalid participant_scope');
  }

  private async validateGenerationIds(
    scope: evaluation_participant_scope,

    generationIds: bigint[],

    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    if (scope !== evaluation_participant_scope.SELECTED_GENERATIONS) {
      return;
    }

    const generations = await prisma.student_generations.findMany({
      where: {
        id: {
          in: generationIds,
        },
      },

      select: {
        id: true,
      },
    });

    const foundIds = new Set(
      generations.map((generation) => generation.id.toString()),
    );

    const missingIds = generationIds.filter(
      (id) => !foundIds.has(id.toString()),
    );

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Student generation not found: ${missingIds

          .map((id) => id.toString())

          .join(', ')}`,
      );
    }
  }

  private assertConfirmedStudentsUnchanged(
    confirmedStudentIds: string[],

    currentStudentIds: bigint[],
  ) {
    const confirmed = Array.from(
      new Set(confirmedStudentIds.map((id) => id.trim())),
    ).sort();

    const current = Array.from(
      new Set(currentStudentIds.map((id) => id.toString())),
    ).sort();

    const unchanged =
      confirmed.length === current.length &&
      confirmed.every((id, index) => id === current[index]);

    if (!unchanged) {
      throw new ConflictException(
        'Eligible students changed after the preview. Preview and review the participant list again before creating the evaluation.',
      );
    }
  }

  private async resolveSurveyVersion(
    dto: CreateEvaluationDto,
  ): Promise<bigint> {
    const surveyId = dto.survey_id !== undefined ? BigInt(dto.survey_id) : null;

    const explicitVersionId =
      dto.survey_version_id !== undefined
        ? BigInt(dto.survey_version_id)
        : null;

    if (explicitVersionId !== null) {
      const version = await this.prisma.survey_versions.findFirst({
        where: {
          id: explicitVersionId,

          ...(surveyId !== null && {
            survey_id: surveyId,
          }),
        },

        select: {
          id: true,
          survey_id: true,
          status: true,

          surveys: {
            select: {
              archived_at: true,
            },
          },

          _count: {
            select: {
              questions: true,
            },
          },
        },
      });

      if (!version) {
        if (surveyId !== null) {
          const surveyExists = await this.prisma.surveys.findUnique({
            where: {
              id: surveyId,
            },

            select: {
              id: true,
              archived_at: true,
            },
          });

          if (!surveyExists) {
            throw new BadRequestException(
              'survey_id does not match any named question set',
            );
          }

          if (surveyExists.archived_at) {
            throw new BadRequestException(
              'An archived question set cannot be used for a new evaluation',
            );
          }

          throw new BadRequestException(
            'survey_version_id does not belong to the selected survey',
          );
        }

        throw new BadRequestException(
          'survey_version_id does not match any survey version',
        );
      }

      if (version.surveys.archived_at) {
        throw new BadRequestException(
          'An archived question set cannot be used for a new evaluation',
        );
      }

      const latest = await this.prisma.survey_versions.findFirst({
        where: { survey_id: version.survey_id },
        orderBy: { version_no: 'desc' },
        select: { id: true },
      });
      if (!latest || latest.id !== explicitVersionId) {
        throw new ConflictException(
          'The question set has a newer version. Reload and review its latest version before creating this evaluation.',
        );
      }

      this.assertVersionUsable(version.status, version._count.questions);

      return version.id;
    }

    if (surveyId === null) {
      throw new BadRequestException(
        'Either survey_id or survey_version_id is required',
      );
    }

    const survey = await this.prisma.surveys.findUnique({
      where: {
        id: surveyId,
      },

      select: {
        id: true,
        archived_at: true,
      },
    });

    if (!survey) {
      throw new BadRequestException(
        'survey_id does not match any named question set',
      );
    }

    if (survey.archived_at) {
      throw new BadRequestException(
        'An archived question set cannot be used for a new evaluation',
      );
    }

    const latestVersion = await this.prisma.survey_versions.findFirst({
      where: {
        survey_id: surveyId,
      },

      orderBy: {
        version_no: 'desc',
      },

      select: {
        id: true,
        status: true,
        _count: { select: { questions: true } },
      },
    });

    if (!latestVersion) {
      throw new BadRequestException(
        'The selected question set has no survey version',
      );
    }

    this.assertVersionUsable(
      latestVersion.status,
      latestVersion._count.questions,
    );
    return latestVersion.id;
  }

  private assertVersionUsable(
    status: string,

    questionCount: number,
  ) {
    if (status === 'ARCHIVED') {
      throw new BadRequestException(
        'An archived survey version cannot be used for a new evaluation',
      );
    }

    if (questionCount === 0) {
      throw new BadRequestException('The survey version has no questions');
    }
  }

  private checkWindow(
    startAt: Date | null,

    endAt: Date | null,
  ) {
    if (startAt && endAt && endAt <= startAt) {
      throw new BadRequestException('end_at must be after start_at');
    }
  }
}
