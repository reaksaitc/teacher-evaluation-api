import { assertDepartmentScope } from '../common/utils/department-scope.util';
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { targetLabelView } from '../common/utils/target-labels.util';

type EvaluationGenerationTarget = Prisma.evaluationsGetPayload<{
  include: {
    generation_targets: {
      include: {
        student_generations: {
          select: {
            id: true;
            name: true;
            entry_academic_year_id: true;
            starting_year_level: true;
            entry_academic_year: {
              select: {
                id: true;
                name: true;
                start_year: true;
              };
            };
          };
        };
      };
    };
  };
}>['generation_targets'][number];

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================
  // ADMIN - ALL RESULTS
  // =========================================================

  async getAdminResults(majorId?: bigint, actorId?: bigint) {
    const scope =
      actorId === undefined
        ? []
        : await assertDepartmentScope(this.prisma, actorId);
    const evaluations = await this.prisma.evaluations.findMany({
      where: {
        ...(scope.length
          ? { course_offerings: { courses: { department_id: { in: scope } } } }
          : {}),
        status: {
          not: 'DRAFT',
        },
      },

      include: this.evaluationInclude(),

      orderBy: {
        created_at: 'desc',
      },
    });

    return evaluations.map((evaluation) =>
      this.filteredResult(evaluation, majorId),
    );
  }

  // =========================================================
  // ADMIN - RESULTS FOR ONE LECTURER
  // =========================================================

  async getAdminResultsByLecturer(
    lecturerId: bigint,
    majorId?: bigint,
    actorId?: bigint,
  ) {
    const scope =
      actorId === undefined
        ? []
        : await assertDepartmentScope(this.prisma, actorId);
    const lecturer = await this.prisma.users.findFirst({
      where: {
        id: lecturerId,
        role: 'LECTURER',
      },

      select: {
        id: true,
        full_name: true,
        email: true,
      },
    });

    if (!lecturer) {
      throw new NotFoundException('Lecturer not found');
    }

    const evaluations = await this.prisma.evaluations.findMany({
      where: {
        status: {
          not: 'DRAFT',
        },

        course_offerings: {
          ...(scope.length
            ? { courses: { department_id: { in: scope } } }
            : {}),
          lecturer_id: lecturerId,
        },
      },

      include: this.evaluationInclude(),

      orderBy: {
        created_at: 'desc',
      },
    });

    return {
      lecturer: {
        id: lecturer.id,
        full_name: lecturer.full_name,
        email: lecturer.email,
      },

      evaluations: evaluations.map((evaluation) =>
        this.filteredResult(evaluation, majorId),
      ),
    };
  }

  // =========================================================
  // LECTURER - OWN RESULTS
  // =========================================================

  async getLecturerResults(lecturerId: bigint, majorId?: bigint) {
    const lecturer = await this.prisma.users.findFirst({
      where: {
        id: lecturerId,
        role: 'LECTURER',
      },

      select: {
        id: true,
        full_name: true,
        email: true,
      },
    });

    if (!lecturer) {
      throw new NotFoundException('Lecturer not found');
    }

    const evaluations = await this.prisma.evaluations.findMany({
      where: {
        status: 'CLOSED',

        course_offerings: {
          lecturer_id: lecturerId,
        },
      },

      include: this.evaluationInclude(),

      orderBy: {
        created_at: 'desc',
      },
    });

    return {
      lecturer: {
        id: lecturer.id,
        full_name: lecturer.full_name,
        email: lecturer.email,
      },

      evaluations: evaluations.map((evaluation) =>
        this.filteredResult(evaluation, majorId),
      ),
    };
  }

  // =========================================================
  // PRISMA INCLUDE
  // =========================================================

  private evaluationInclude() {
    return {
      course_offerings: {
        include: {
          courses: {
            include: {
              departments: true,
            },
          },

          users: {
            select: {
              id: true,
              full_name: true,
              email: true,
            },
          },

          semesters: {
            include: {
              academic_years: true,
            },
          },
        },
      },

      /*
       * Keep the evaluation's base version.
       *
       * This remains useful as assignment/history metadata,
       * but it is NOT used as the only source of questions
       * when aggregating submitted responses.
       */
      survey_versions: {
        include: {
          surveys: true,
        },
      },

      generation_targets: {
        include: {
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
              entry_academic_year_id: true,
              starting_year_level: true,
              entry_academic_year: {
                select: {
                  id: true,
                  name: true,
                  start_year: true,
                },
              },
            },
          },
        },
      },

      group_targets: {
        include: {
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
                select: {
                  id: true,
                  code: true,
                  name: true,
                  department_id: true,
                },
              },
              id: true,
              name: true,
            },
          },

          majors: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },

      /*
       * Every submitted response may belong to a different
       * survey version.
       *
       * We therefore load the exact version attached to
       * each response, together with that version's
       * original questions and options.
       */
      responses: {
        include: {
          survey_versions: {
            include: {
              surveys: true,

              questions: {
                include: {
                  question_options: {
                    orderBy: {
                      display_order: 'asc' as const,
                    },
                  },
                },

                orderBy: {
                  display_order: 'asc' as const,
                },
              },
            },
          },

          answers: {
            include: {
              answer_options: {
                include: {
                  question_options: true,
                },
              },
            },
          },
        },
      },

      evaluation_participants: { select: { placement_snapshot: true } },
      _count: {
        select: {
          evaluation_participants: true,
          responses: true,
        },
      },
    };
  }

  // =========================================================
  // BUILD ONE EVALUATION RESULT
  // =========================================================

  private filteredResult(evaluation: any, majorId?: bigint) {
    const release = {
      results_available: true,
      policy: 'CLOSED_ONLY_FOR_LECTURERS',
      minimum_response_count: null,
      small_cohort_suppression: 'NOT_CONFIGURED',
      anonymous_scope: 'WHOLE_EVALUATION_OR_CAPTURED_MAJOR',
    };
    if (majorId === undefined)
      return {
        ...this.buildEvaluationResult(evaluation),
        release,
        audience_filter: {
          major_id: null,
          label: 'All targeted majors',
          available: true,
        },
      };
    const participants = evaluation.evaluation_participants ?? [];
    if (
      participants.some((p: any) => !p.placement_snapshot?.major?.id) ||
      evaluation.responses.some(
        (response: any) => response.audience_major_id == null,
      )
    )
      throw new ConflictException({
        code: 'LEGACY_AUDIENCE_UNAVAILABLE',
        message:
          'This report includes historical records without captured major metadata; combined results remain available',
      });
    const selected = participants.filter(
      (p: any) => String(p.placement_snapshot.major.id) === String(majorId),
    );
    const responses = evaluation.responses.filter(
      (response: any) => response.audience_major_id === majorId,
    );
    const label =
      selected[0]?.placement_snapshot.major ??
      responses[0]?.audience_major_label ??
      null;
    const result = this.buildEvaluationResult({
      ...evaluation,
      responses,
      _count: {
        ...evaluation._count,
        evaluation_participants: selected.length,
        responses: responses.length,
      },
    });
    return {
      ...result,
      release,
      audience_filter: {
        major_id: String(majorId),
        label,
        available: true,
        source: 'EVALUATION_TIME_SNAPSHOT',
      },
      combined_participant_count: evaluation._count.evaluation_participants,
      combined_submission_count: evaluation._count.responses,
    };
  }

  private buildEvaluationResult(evaluation: any) {
    const offering = evaluation.course_offerings;

    const semester = offering.semesters;

    const responses = evaluation.responses;

    /*
     * Group submitted responses by their ACTUAL saved
     * survey_version_id.
     *
     * We intentionally do not fall back to the evaluation
     * base version for a response whose survey_version_id
     * is NULL. Doing so would guess historical data and
     * could produce incorrect aggregates.
     */
    const versionGroups = new Map<
      string,
      {
        surveyVersion: any;
        responses: any[];
      }
    >();

    const unversionedResponses: any[] = [];

    for (const response of responses) {
      if (
        response.survey_version_id === null ||
        response.survey_versions === null
      ) {
        unversionedResponses.push(response);
        continue;
      }

      const key = response.survey_version_id.toString();

      const existing = versionGroups.get(key);

      if (existing) {
        existing.responses.push(response);
      } else {
        versionGroups.set(key, {
          surveyVersion: response.survey_versions,

          responses: [response],
        });
      }
    }

    const versionResults = Array.from(versionGroups.values())
      .sort((a, b) => a.surveyVersion.version_no - b.surveyVersion.version_no)
      .map((group) =>
        this.buildVersionResult(group.surveyVersion, group.responses),
      );

    return {
      evaluation: {
        id: evaluation.id,

        status: evaluation.status,

        start_at: evaluation.start_at,

        end_at: evaluation.end_at,

        participant_scope: evaluation.participant_scope,
      },

      offering: {
        id: offering.id,
        class_type: offering.class_type,
        year_level: offering.year_level,
      },

      lecturer: {
        id: offering.users.id,

        full_name: offering.users.full_name,

        email: offering.users.email,
      },

      course: {
        id: offering.courses.id,

        code: offering.courses.course_code,

        name: offering.courses.course_name,

        section_code: offering.section_code,
      },

      department: {
        id: offering.courses.departments.id,

        code: offering.courses.departments.code,

        name: offering.courses.departments.name,
      },

      semester: {
        id: semester.id,

        name: semester.semester_name,

        semester_number: semester.semester_number,

        academic_year: {
          id: semester.academic_years.id,

          name: semester.academic_years.name,

          start_year: semester.academic_years.start_year,

          is_active: semester.academic_years.is_active,
        },
      },

      /*
       * This is the evaluation's original/base question-set
       * assignment. It remains useful metadata even when
       * unfinished participants later move to a newer
       * version of the same named set.
       */
      survey: {
        id: evaluation.survey_versions.survey_id,

        title: evaluation.survey_versions.surveys.title,

        base_version_id: evaluation.survey_versions.id,

        base_version_no: evaluation.survey_versions.version_no,
      },

      target_scope: {
        participant_scope: evaluation.participant_scope,

        generations_complete:
          evaluation.participant_scope === 'SELECTED_GENERATIONS' &&
          evaluation.generation_targets.length > 0,

        generations_unavailable_reason:
          evaluation.participant_scope === 'ALL_ENROLLED'
            ? 'SCOPE_NOT_GENERATION_ONLY'
            : evaluation.generation_targets.length === 0
              ? 'NO_FROZEN_GENERATION_TARGETS'
              : null,

        generations: evaluation.generation_targets.map(
          (target: EvaluationGenerationTarget) => ({
            ...targetLabelView(target, {
              generation: {
                id: target.student_generations.id,
                name: target.student_generations.name,
              },
              entry_academic_year:
                target.student_generations.entry_academic_year,
              starting_year_level:
                target.student_generations.starting_year_level,
            }),
            id: target.student_generations.id,

            name: target.student_generations.name,

            entry_academic_year_id:
              target.student_generations.entry_academic_year_id,

            starting_year_level: target.student_generations.starting_year_level,

            entry_academic_year: {
              id: target.student_generations.entry_academic_year.id,

              name: target.student_generations.entry_academic_year.name,

              start_year:
                target.student_generations.entry_academic_year.start_year,
            },
          }),
        ),

        groups_complete: evaluation.group_targets.length > 0,

        groups_unavailable_reason:
          evaluation.group_targets.length === 0
            ? 'NO_FROZEN_GROUP_TARGETS'
            : null,

        groups: evaluation.group_targets.map((target: any) => ({
          ...targetLabelView(target, {
            academic_year: target.academic_years,
            generation: target.student_generations,
            major: target.majors,
            year_level: target.year_level,
            class_group: target.class_group,
          }),
          academic_year: {
            id: target.academic_years.id,

            name: target.academic_years.name,

            start_year: target.academic_years.start_year,
          },

          generation: {
            id: target.student_generations.id,

            name: target.student_generations.name,
          },

          major: {
            id: target.majors.id,

            code: target.majors.code,

            name: target.majors.name,
          },

          year_level: target.year_level,

          class_group: target.class_group,
        })),
      },

      participant_count: evaluation._count.evaluation_participants,

      submission_count: evaluation._count.responses,

      response_rate: this.calculateResponseRate(
        evaluation._count.evaluation_participants,
        evaluation._count.responses,
      ),

      /*
       * Results are now separated by the exact version
       * actually used for each submitted response.
       */
      version_results: versionResults,

      /*
       * Historical responses with no saved version are
       * reported explicitly instead of being silently
       * assigned to the evaluation base version.
       *
       * No response/student identity is exposed.
       */
      unversioned_submission_count: unversionedResponses.length,
    };
  }

  // =========================================================
  // BUILD ONE VERSION RESULT
  // =========================================================

  private buildVersionResult(surveyVersion: any, responses: any[]) {
    return {
      survey_id: surveyVersion.survey_id,

      survey_title: surveyVersion.surveys.title,

      survey_version_id: surveyVersion.id,

      version_no: surveyVersion.version_no,

      submission_count: responses.length,

      questions: surveyVersion.questions.map((question: any) =>
        this.buildQuestionResult(question, responses),
      ),
    };
  }

  // =========================================================
  // BUILD QUESTION RESULT
  // =========================================================

  private buildQuestionResult(question: any, responses: any[]) {
    /*
     * Only responses belonging to this exact survey
     * version reach this method.
     *
     * We aggregate by immutable question_id rather than
     * question text.
     *
     * We intentionally do not expose:
     * - student_id
     * - participant_id
     * - response_id
     * - student name
     * - student email
     */
    const answers = responses.flatMap((response: any) =>
      response.answers.filter(
        (answer: any) => answer.question_id === question.id,
      ),
    );

    const base = {
      question_id: question.id,

      question_text: question.question_text,

      question_text_km: question.question_text_km,

      question_type: question.question_type,

      category: question.category,

      is_required: question.is_required,

      min_rating: question.min_rating,

      max_rating: question.max_rating,

      display_order: question.display_order,

      answer_count: answers.length,
    };

    // =====================================================
    // RATING / AGREEMENT / FREQUENCY
    // =====================================================

    if (
      question.question_type === 'RATING' ||
      question.question_type === 'AGREEMENT' ||
      question.question_type === 'FREQUENCY'
    ) {
      const ratings: number[] = answers
        .map((answer: any) => answer.rating_value)
        .filter((value: number | null): value is number => value !== null);

      const average =
        ratings.length > 0
          ? ratings.reduce((sum: number, value: number) => sum + value, 0) /
            ratings.length
          : null;

      const distribution: Record<string, number> = {};

      if (question.min_rating !== null && question.max_rating !== null) {
        for (
          let value = question.min_rating;
          value <= question.max_rating;
          value++
        ) {
          distribution[value.toString()] = 0;
        }
      }

      for (const rating of ratings) {
        const key = rating.toString();

        distribution[key] = (distribution[key] ?? 0) + 1;
      }

      return {
        ...base,

        average: average === null ? null : Number(average.toFixed(2)),

        distribution,
      };
    }

    // =====================================================
    // TEXT
    // =====================================================

    if (question.question_type === 'TEXT') {
      const feedback: string[] = answers
        .map((answer: any) => answer.text_value)
        .filter(
          (value: string | null): value is string =>
            value !== null && value.trim().length > 0,
        );

      return {
        ...base,

        feedback,
      };
    }

    // =====================================================
    // MULTIPLE CHOICE / CHECKBOX
    // =====================================================

    if (
      question.question_type === 'MULTIPLE_CHOICE' ||
      question.question_type === 'CHECKBOX'
    ) {
      const options = question.question_options.map((option: any) => {
        let count = 0;

        for (const answer of answers) {
          const selected = answer.answer_options.some(
            (answerOption: any) => answerOption.option_id === option.id,
          );

          if (selected) {
            count++;
          }
        }

        return {
          option_id: option.id,

          option_text: option.option_text,

          display_order: option.display_order,

          count,
        };
      });

      return {
        ...base,

        options,
      };
    }

    // =====================================================
    // FALLBACK
    // =====================================================

    return base;
  }

  // =========================================================
  // RESPONSE RATE
  // =========================================================

  private calculateResponseRate(
    participantCount: number,
    submissionCount: number,
  ) {
    if (participantCount === 0) {
      return {
        value: null,
        unavailable_reason: 'NO_PARTICIPANTS',
      };
    }

    return {
      value: Number(((submissionCount / participantCount) * 100).toFixed(2)),
      unavailable_reason: null,
    };
  }
}
