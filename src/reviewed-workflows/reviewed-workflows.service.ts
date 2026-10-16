import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { progressionRecordSelect } from '../common/utils/student-placement.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { StudentEvaluationProgressService } from '../students/student-evaluation-progress.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { SurveyVersionsService } from '../survey-versions/survey-versions.service';
import { EnrollmentGroupSelectionDto } from '../enrollments/dto/enrollment-group-selection.dto';
import {
  ConfirmEnrollmentReassignmentDto,
  EnrollmentReassignmentDto,
} from '../enrollments/dto/enrollment-reassignment.dto';
import { CreateEvaluationDto } from '../evaluations/dto/create-evaluation.dto';
import { BulkUpdateStudentGroupDto } from '../students/dto/bulk-update-student-group.dto';
import {
  normalizeClassGroup,
  normalizeClassGroups,
} from '../common/utils/class-group.util';
import { ReviewedOperationStore } from './reviewed-operation.store';

const ids = (values: string[] = []) =>
  [...new Set(values.map((id) => BigInt(id).toString()))].sort();
const id = (value?: string) =>
  value === undefined ? null : BigInt(value).toString();
const date = (value?: string) =>
  value === undefined ? null : new Date(value).toISOString();
const groups = (values?: string[]) =>
  values === undefined ? null : normalizeClassGroups(values).sort();

function enrollmentInput(
  dto: EnrollmentGroupSelectionDto,
  confirmed: string[],
) {
  return {
    academic_year_id: id(dto.academic_year_id),
    generation_id: id(dto.generation_id),
    major_id: id(dto.major_id),
    year_level: dto.year_level ?? null,
    class_groups: groups(dto.class_groups),
    confirmed_student_ids: ids(confirmed),
  };
}
function creationInput(dto: CreateEvaluationDto, confirmed: string[]) {
  const scope = dto.group_scope;
  return {
    publish: dto.publish ?? false,
    course_offering_id: id(dto.course_offering_id),
    survey_id: id(dto.survey_id),
    survey_version_id: id(dto.survey_version_id),
    start_at: date(dto.start_at),
    end_at: date(dto.end_at),
    participant_scope: dto.participant_scope ?? 'ALL_ENROLLED',
    generation_ids: ids(dto.generation_ids),
    group_scope: scope
      ? {
          academic_year_id: id(scope.academic_year_id),
          generation_id: id(scope.generation_id),
          major_id: id(scope.major_id),
          year_level: scope.year_level,
          class_groups: groups(scope.class_groups),
        }
      : null,
    major_ids: dto.major_ids === undefined ? null : ids(dto.major_ids),
    group_scopes:
      dto.group_scopes?.map((scope) => ({
        academic_year_id: id(scope.academic_year_id),
        generation_id: id(scope.generation_id),
        major_id: id(scope.major_id),
        year_level: scope.year_level,
        class_groups: groups(scope.class_groups),
      })) ?? null,
    confirmed_student_ids: ids(confirmed),
  };
}
function placementInput(dto: BulkUpdateStudentGroupDto) {
  return {
    academic_year_id: id(dto.academic_year_id),
    student_ids: ids(dto.student_ids),
    class_group: normalizeClassGroup(dto.class_group),
  };
}
function reassignmentInput(
  dto: EnrollmentReassignmentDto,
  enrollmentId: string,
) {
  return {
    student_id: id(dto.student_id),
    target_offering_id: id(dto.target_offering_id),
    confirmed_enrollment_id: id(enrollmentId),
  };
}

/** Orchestrates existing domain rules; every constructed service uses the bound transaction. */
@Injectable()
export class ReviewedWorkflowsService {
  constructor(private readonly prisma: PrismaService) {}
  private students(db: PrismaService) {
    return new StudentsService(db, new StudentEvaluationProgressService(db));
  }
  private enrollments(db: PrismaService) {
    return new EnrollmentsService(db, this.students(db));
  }
  private store() {
    return new ReviewedOperationStore(this.prisma);
  }

  private async offeringState(db: PrismaService, offeringId: bigint) {
    const offering = await db.course_offerings.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        course_id: true,
        semester_id: true,
        lecturer_id: true,
        year_level: true,
        class_type: true,
        semesters: {
          select: {
            academic_year_id: true,
            semester_number: true,
            academic_years: { select: { id: true, start_year: true } },
          },
        },
        group_scopes: {
          orderBy: { id: 'asc' },
          select: {
            academic_year_id: true,
            generation_id: true,
            major_id: true,
            year_level: true,
            class_group: true,
            curriculum_revision_id: true,
          },
        },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    return offering;
  }

  private async accountPlacements(
    db: PrismaService,
    accountIds: string[],
    yearId: bigint,
  ) {
    const year = await db.academic_years.findUnique({
      where: { id: yearId },
      select: { id: true, start_year: true },
    });
    const students = await db.students.findMany({
      where: { user_id: { in: accountIds.map(BigInt) } },
      orderBy: { user_id: 'asc' },
      select: {
        id: true,
        user_id: true,
        generation_id: true,
        users: { select: { role: true, status: true } },
        student_generations: {
          select: {
            starting_year_level: true,
            entry_academic_year_id: true,
            entry_academic_year: { select: { start_year: true } },
          },
        },
        student_academic_records: {
          // Include prior anchors and pause/resume states, not just this year's group.
          where: {
            OR: [
              { academic_year_id: yearId },
              {
                academic_years: { start_year: { lte: year?.start_year ?? -1 } },
              },
            ],
          },
          orderBy: { id: 'asc' },
          select: progressionRecordSelect,
        },
      },
    });
    return { year, students };
  }

  private async versionState(db: PrismaService, versionId: bigint) {
    const version = await db.survey_versions.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        survey_id: true,
        version_no: true,
        status: true,
        surveys: { select: { archived_at: true } },
        questions: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            question_text: true,
            question_text_km: true,
            question_type: true,
            category: true,
            is_required: true,
            min_rating: true,
            max_rating: true,
            display_order: true,
            question_options: {
              orderBy: { id: 'asc' },
              select: { id: true, option_text: true, display_order: true },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Survey version not found');
    const latest = await db.survey_versions.findFirst({
      where: { survey_id: version.survey_id },
      orderBy: { version_no: 'desc' },
      select: { id: true },
    });
    return { version, latest };
  }

  private async groupState(
    db: PrismaService,
    offeringId: bigint,
    dto: EnrollmentGroupSelectionDto,
  ) {
    const output = await this.enrollments(db).previewGroup(offeringId, dto);
    const offering = await this.offeringState(db, offeringId);
    const placements = await this.accountPlacements(
      db,
      output.confirmed_student_ids,
      BigInt(dto.academic_year_id),
    );
    const enrolled = await db.enrollments.findMany({
      where: {
        course_offering_id: offeringId,
        student_id: { in: output.confirmed_student_ids.map(BigInt) },
      },
      orderBy: { student_id: 'asc' },
      select: { id: true, student_id: true },
    });
    return {
      input: enrollmentInput(dto, output.confirmed_student_ids),
      snapshot: {
        offering,
        placements,
        enrolled,
        selected: ids(output.confirmed_student_ids),
      },
      output,
    };
  }
  previewGroup(
    offeringId: bigint,
    dto: EnrollmentGroupSelectionDto,
    actor: bigint,
  ) {
    return this.store().preview(
      'ENROLL_GROUP',
      offeringId.toString(),
      actor,
      (db) => this.groupState(db, offeringId, dto),
    );
  }
  confirmGroup(
    offeringId: bigint,
    dto: EnrollmentGroupSelectionDto & { review_id?: string },
    actor: bigint,
  ) {
    if (!dto.confirmed_student_ids)
      throw new BadRequestException('confirmed_student_ids is required');
    return this.store().confirm(
      'ENROLL_GROUP',
      offeringId.toString(),
      actor,
      dto.review_id!,
      enrollmentInput(dto, dto.confirmed_student_ids),
      (db) => this.groupState(db, offeringId, dto),
      (db) => this.enrollments(db).bulkCreate(offeringId, dto),
    );
  }

  private async createState(
    db: PrismaService,
    dto: CreateEvaluationDto,
    actor?: bigint,
  ) {
    if (actor !== undefined) {
      const context = await db.course_offerings.findUnique({
        where: { id: BigInt(dto.course_offering_id) },
        include: { courses: true },
      });
      if (!context)
        throw new NotFoundException('Teaching assignment not found');
      await assertDepartmentScope(db, actor, context.courses.department_id);
    }
    if (
      dto.publish &&
      (!dto.start_at || !dto.end_at || Date.parse(dto.end_at) <= Date.now())
    )
      throw new BadRequestException(
        'Publication requires start_at and a future end_at',
      );
    const output = await new EvaluationsService(db).previewReviewedCreate(dto);
    const offering = await this.offeringState(
      db,
      BigInt(dto.course_offering_id),
    );
    const placements = await this.accountPlacements(
      db,
      output.confirmed_student_ids,
      BigInt(
        dto.group_scope?.academic_year_id ??
          offering.semesters.academic_year_id,
      ),
    );
    const version = await this.versionState(db, BigInt(dto.survey_version_id!));
    // Include ineligible reason counts because those are part of the reviewed impact.
    const impact = {
      enrolled_count: output.enrolled_count,
      ineligible_count: output.ineligible_count,
      ineligible_reasons: output.ineligible_reasons,
    };
    return {
      input: creationInput(dto, output.confirmed_student_ids),
      snapshot: {
        offering,
        placements,
        version,
        impact,
        selected: ids(output.confirmed_student_ids),
        target_labels: output.target_labels,
      },
      output,
    };
  }
  previewCreate(dto: CreateEvaluationDto, actor: bigint) {
    return this.store().preview(
      'CREATE_EVALUATION',
      dto.course_offering_id,
      actor,
      (db) => this.createState(db, dto, actor),
    );
  }
  confirmCreate(
    dto: CreateEvaluationDto & { review_id?: string },
    actor: bigint,
  ) {
    if (!dto.confirmed_student_ids)
      throw new BadRequestException('confirmed_student_ids is required');
    return this.store().confirm(
      'CREATE_EVALUATION',
      dto.course_offering_id,
      actor,
      dto.review_id!,
      creationInput(dto, dto.confirmed_student_ids),
      (db) => this.createState(db, dto, actor),
      async (db) => {
        const evaluations = new EvaluationsService(db);
        const created = await evaluations.create(dto, actor);
        return dto.publish ? evaluations.open(created.id, actor) : created;
      },
    );
  }

  private async reassignmentState(
    db: PrismaService,
    offeringId: bigint,
    dto: EnrollmentReassignmentDto,
  ) {
    const output = await this.enrollments(db).previewReassignment(
      offeringId,
      dto,
    );
    const source = await this.offeringState(db, offeringId);
    const target = await this.offeringState(db, BigInt(dto.target_offering_id));
    const placements = await this.accountPlacements(
      db,
      [dto.student_id],
      target.semesters.academic_year_id,
    );
    return {
      input: reassignmentInput(dto, output.confirmed_enrollment_id),
      snapshot: {
        source,
        target,
        placements,
        impact: output.impact,
        source_enrollment_id: output.confirmed_enrollment_id,
        can_confirm: output.can_confirm,
      },
      output,
    };
  }
  previewReassignment(
    offeringId: bigint,
    dto: EnrollmentReassignmentDto,
    actor: bigint,
  ) {
    return this.store().preview(
      'REASSIGN_ENROLLMENT',
      offeringId.toString(),
      actor,
      (db) => this.reassignmentState(db, offeringId, dto),
    );
  }
  confirmReassignment(
    offeringId: bigint,
    dto: ConfirmEnrollmentReassignmentDto & { review_id?: string },
    actor: bigint,
  ) {
    return this.store().confirm(
      'REASSIGN_ENROLLMENT',
      offeringId.toString(),
      actor,
      dto.review_id!,
      reassignmentInput(dto, dto.confirmed_enrollment_id),
      (db) => this.reassignmentState(db, offeringId, dto),
      (db) => this.enrollments(db).confirmReassignment(offeringId, dto),
    );
  }

  private async placementState(
    db: PrismaService,
    dto: BulkUpdateStudentGroupDto,
  ) {
    const input = placementInput(dto);
    if (!input.class_group)
      throw new BadRequestException('class_group must not be empty');
    const records = await db.student_academic_records.findMany({
      where: {
        academic_year_id: BigInt(dto.academic_year_id),
        student_id: { in: dto.student_ids.map(BigInt) },
      },
      orderBy: { student_id: 'asc' },
      select: {
        id: true,
        student_id: true,
        year_level: true,
        major_id: true,
        class_group: true,
        students: { select: { user_id: true } },
      },
    });
    if (records.length !== ids(dto.student_ids).length)
      throw new BadRequestException(
        'All selected profiles must have an existing placement',
      );
    const placements = await this.accountPlacements(
      db,
      records.map((record) => record.students.user_id.toString()),
      BigInt(dto.academic_year_id),
    );
    const enrollments = await db.enrollments.findMany({
      where: {
        student_id: { in: records.map((record) => record.students.user_id) },
        course_offerings: {
          semesters: { academic_year_id: BigInt(dto.academic_year_id) },
        },
      },
      orderBy: { id: 'asc' },
      select: { id: true, student_id: true, course_offering_id: true },
    });
    const participants = await db.evaluation_participants.findMany({
      where: {
        student_id: { in: records.map((record) => record.students.user_id) },
        evaluations: {
          course_offerings: {
            semesters: { academic_year_id: BigInt(dto.academic_year_id) },
          },
        },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        evaluation_id: true,
        has_submitted: true,
        survey_version_id: true,
        assessment_drafts: {
          select: { id: true, survey_version_id: true, updated_at: true },
        },
      },
    });
    return {
      input,
      snapshot: { placements, enrollments, participants },
      output: {
        ...input,
        proposed_updated_count: records.length,
        placements: records.map((record) => ({
          student_id: record.student_id.toString(),
          from_class_group: record.class_group,
          to_class_group: input.class_group,
        })),
        impact: {
          enrollment_count: enrollments.length,
          frozen_participant_count: participants.length,
          draft_count: participants.filter((p) => p.assessment_drafts).length,
          submitted_count: participants.filter((p) => p.has_submitted).length,
        },
      },
    };
  }
  previewPlacement(dto: BulkUpdateStudentGroupDto, actor: bigint) {
    return this.store().preview(
      'BULK_GROUP_PLACEMENT',
      dto.academic_year_id,
      actor,
      (db) => this.placementState(db, dto),
    );
  }
  confirmPlacement(
    dto: BulkUpdateStudentGroupDto & { review_id: string },
    actor: bigint,
  ) {
    return this.store().confirm(
      'BULK_GROUP_PLACEMENT',
      dto.academic_year_id,
      actor,
      dto.review_id,
      placementInput(dto),
      (db) => this.placementState(db, dto),
      (db) =>
        this.students(db).bulkUpdateClassGroup(
          BigInt(dto.academic_year_id),
          dto.student_ids.map(BigInt),
          dto.class_group,
        ),
    );
  }

  private async openingState(db: PrismaService, evaluationId: bigint) {
    const output = (await new EvaluationsService(db).previewReviewedOpening(
      evaluationId,
    )) as {
      assigned_survey_version_id: string;
      [key: string]: unknown;
    };
    const evaluation = await db.evaluations.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        course_offering_id: true,
        survey_version_id: true,
        participant_scope: true,
        status: true,
        start_at: true,
        end_at: true,
        generation_targets: {
          orderBy: { generation_id: 'asc' },
          select: { generation_id: true },
        },
        group_targets: {
          orderBy: { id: 'asc' },
          select: {
            academic_year_id: true,
            generation_id: true,
            major_id: true,
            year_level: true,
            class_group: true,
          },
        },
        evaluation_participants: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            student_id: true,
            survey_version_id: true,
            has_submitted: true,
            assessment_drafts: {
              select: { id: true, survey_version_id: true, updated_at: true },
            },
          },
        },
      },
    });
    const version = await this.versionState(
      db,
      BigInt(output.assigned_survey_version_id),
    );
    // Whole-set archive continuity is deliberately allowed here; individual version archive is not.
    const input = {
      decision: 'RETAIN_ASSIGNED_VERSION',
      retain_assigned_version_id: output.assigned_survey_version_id,
    };
    return { input, snapshot: { evaluation, version }, output };
  }
  previewOpening(evaluationId: bigint, actor: bigint) {
    return this.store().preview(
      'OPEN_ASSIGNED_VERSION',
      evaluationId.toString(),
      actor,
      (db) => this.openingState(db, evaluationId),
    );
  }
  confirmOpening(
    evaluationId: bigint,
    dto: {
      review_id: string;
      decision: string;
      retain_assigned_version_id: string;
    },
    actor: bigint,
  ) {
    return this.store().confirm(
      'OPEN_ASSIGNED_VERSION',
      evaluationId.toString(),
      actor,
      dto.review_id,
      {
        decision: dto.decision,
        retain_assigned_version_id: id(dto.retain_assigned_version_id),
      },
      (db) => this.openingState(db, evaluationId),
      (db) =>
        new EvaluationsService(db).openReviewedAssigned(evaluationId, actor),
    );
  }

  private async applicationState(
    db: PrismaService,
    surveyId: bigint,
    versionId: bigint,
  ) {
    const version = await this.versionState(db, versionId);
    if (version.version.survey_id !== surveyId)
      throw new NotFoundException('Version does not belong to this set');
    if (
      version.version.surveys.archived_at ||
      version.version.status === 'ARCHIVED'
    )
      throw new ConflictException('Archived questionnaires cannot be applied');
    if (!version.version.questions.length)
      throw new BadRequestException('The survey version has no questions');
    if (version.latest?.id !== versionId)
      throw new ConflictException('Review the latest version before applying');
    const evaluations = await db.evaluations.findMany({
      where: {
        status: { in: ['DRAFT', 'OPEN'] },
        survey_versions: { survey_id: surveyId },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        survey_version_id: true,
        evaluation_participants: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            survey_version_id: true,
            has_submitted: true,
            submitted_at: true,
            assessment_drafts: {
              select: { id: true, survey_version_id: true, updated_at: true },
            },
          },
        },
      },
    });
    const totals = { submitted: 0, protected_draft: 0, already_on_target: 0 };
    let moved = 0;
    const impact = evaluations.map((evaluation) => {
      let move = 0;
      let skip = 0;
      for (const p of evaluation.evaluation_participants) {
        if (p.has_submitted) {
          totals.submitted++;
          skip++;
        } else if (p.survey_version_id === versionId) {
          totals.already_on_target++;
          skip++;
        } else if (p.assessment_drafts) {
          totals.protected_draft++;
          skip++;
        } else {
          move++;
        }
      }
      moved += move;
      return {
        evaluation_id: evaluation.id.toString(),
        proposed_moved_participants: move,
        proposed_skipped_participants: skip,
      };
    });
    return {
      input: {},
      snapshot: { version, evaluations },
      output: {
        survey_id: surveyId.toString(),
        survey_version_id: versionId.toString(),
        version_no: version.version.version_no,
        eligible_evaluations: evaluations.length,
        proposed_moved_participants: moved,
        proposed_skipped_participants:
          totals.submitted + totals.protected_draft + totals.already_on_target,
        skipped_reasons: totals,
        evaluations: impact,
      },
    };
  }
  previewApplication(surveyId: bigint, versionId: bigint, actor: bigint) {
    return this.store().preview(
      'APPLY_LATEST_VERSION',
      `${surveyId}/${versionId}`,
      actor,
      (db) => this.applicationState(db, surveyId, versionId),
    );
  }
  confirmApplication(
    surveyId: bigint,
    versionId: bigint,
    reviewId: string,
    actor: bigint,
  ) {
    return this.store().confirm(
      'APPLY_LATEST_VERSION',
      `${surveyId}/${versionId}`,
      actor,
      reviewId,
      {},
      (db) => this.applicationState(db, surveyId, versionId),
      (db) =>
        new SurveyVersionsService(db).applyToUnfinished(surveyId, versionId),
    );
  }
}
