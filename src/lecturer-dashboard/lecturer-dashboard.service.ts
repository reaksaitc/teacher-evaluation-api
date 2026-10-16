import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  targetLabelSelect,
  targetLabelView,
} from '../common/utils/target-labels.util';

// =========================================================
// EVALUATION CONTEXT
// =========================================================

const contextSelect = {
  id: true,
  status: true,
  start_at: true,
  end_at: true,
  survey_version_id: true,

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
          code: true,
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

  course_offerings: {
    select: {
      lecturer_id: true,
      section_code: true,

      courses: {
        select: {
          course_code: true,
          course_name: true,
        },
      },

      semesters: {
        select: {
          semester_name: true,
          academic_year_id: true,

          academic_years: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },

  survey_versions: {
    select: {
      version_no: true,

      surveys: {
        select: {
          title: true,
        },
      },
    },
  },
} satisfies Prisma.evaluationsSelect;

type EvaluationContext = Prisma.evaluationsGetPayload<{
  select: typeof contextSelect;
}>;

// =========================================================
// HELPERS
// =========================================================

const round2 = (n: number) => Math.round(n * 100) / 100;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Clean object for the lecturer.
// No student identity or internal participant information.
function toContext(e: EvaluationContext) {
  return {
    id: e.id,
    status: e.status,
    start_at: e.start_at,
    end_at: e.end_at,

    course: {
      code: e.course_offerings.courses.course_code,

      name: e.course_offerings.courses.course_name,
    },

    section_code: e.course_offerings.section_code,

    semester: {
      name: e.course_offerings.semesters.semester_name,

      academic_year_id: e.course_offerings.semesters.academic_year_id,

      academic_year: e.course_offerings.semesters.academic_years.name,
    },

    survey: {
      title: e.survey_versions.surveys.title,

      version_no: e.survey_versions.version_no,
    },

    group_scope: {
      complete: e.group_targets.length > 0,

      unavailable_reason:
        e.group_targets.length === 0 ? 'NO_FROZEN_GROUP_TARGETS' : null,

      groups: e.group_targets.map((target) => ({
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
  };
}

// =========================================================
// SERVICE
// =========================================================

@Injectable()
export class LecturerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // =======================================================
  // MY EVALUATIONS
  // =======================================================

  async findMyEvaluations(lecturerId: bigint) {
    const rows = await this.prisma.evaluations.findMany({
      where: {
        status: {
          not: 'DRAFT',
        },

        course_offerings: {
          lecturer_id: lecturerId,
        },
      },

      select: {
        ...contextSelect,

        _count: {
          select: {
            evaluation_participants: true,

            responses: true,
          },
        },
      },

      orderBy: {
        id: 'desc',
      },
    });

    return rows.map((row) => ({
      ...toContext(row),

      eligible_count: row._count.evaluation_participants,

      response_count: row._count.responses,

      results_available: row.status === 'CLOSED',
    }));
  }

  // =======================================================
  // DASHBOARD
  // =======================================================

  async getDashboard(evaluationId: bigint, lecturerId: bigint) {
    const evaluation = await this.getOwnClosedEvaluation(
      evaluationId,
      lecturerId,
    );

    const [eligibleCount, responseCount, ratingQuestions, grouped] =
      await Promise.all([
        // Number of eligible students
        this.prisma.evaluation_participants.count({
          where: {
            evaluation_id: evaluationId,
          },
        }),

        // Number of anonymous submissions
        this.prisma.responses.count({
          where: {
            evaluation_id: evaluationId,
          },
        }),

        // Rating questions for this survey version
        this.prisma.questions.findMany({
          where: {
            question_type: 'RATING',
            OR: [
              { survey_version_id: evaluation.survey_version_id },
              {
                survey_versions: {
                  responses: { some: { evaluation_id: evaluationId } },
                },
              },
            ],
          },

          orderBy: {
            display_order: 'asc',
          },
        }),

        // Count answers grouped by question and score
        this.prisma.answers.groupBy({
          by: ['question_id', 'rating_value'],

          where: {
            rating_value: {
              not: null,
            },

            responses: {
              evaluation_id: evaluationId,
              survey_version_id: { not: null },
            },
          },

          _count: {
            _all: true,
          },
        }),
      ]);

    let totalSum = 0;
    let totalCount = 0;

    const questions = ratingQuestions.map((q) => {
      const min = q.min_rating ?? 1;

      const max = q.max_rating ?? 5;

      // Every possible score begins at 0.
      const distribution: Record<string, number> = {};

      for (let score = min; score <= max; score++) {
        distribution[score.toString()] = 0;
      }

      let sum = 0;
      let count = 0;

      for (const row of grouped) {
        if (row.question_id !== q.id || row.rating_value === null) {
          continue;
        }

        const n = row._count._all;

        distribution[row.rating_value.toString()] =
          (distribution[row.rating_value.toString()] ?? 0) + n;

        sum += row.rating_value * n;

        count += n;
      }

      totalSum += sum;
      totalCount += count;

      return {
        question_id: q.id,

        question_text: q.question_text,

        display_order: q.display_order,

        response_count: count,

        average: count > 0 ? round2(sum / count) : null,

        distribution,
      };
    });

    return {
      ...toContext(evaluation),

      eligible_count: eligibleCount,

      response_count: responseCount,

      response_rate:
        eligibleCount > 0 ? round4(responseCount / eligibleCount) : 0,

      overall_average: totalCount > 0 ? round2(totalSum / totalCount) : null,

      questions,
    };
  }

  // =======================================================
  // OWN CLOSED EVALUATION
  // =======================================================

  /**
   * Shared with Comments (Feature 13).
   *
   * Checks:
   * 1. Evaluation exists
   * 2. Evaluation belongs to this lecturer
   * 3. Evaluation is CLOSED
   */
  async getOwnClosedEvaluation(evaluationId: bigint, lecturerId: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: {
        id: evaluationId,
      },

      select: contextSelect,
    });

    if (!evaluation) {
      throw new NotFoundException('Evaluation not found');
    }

    if (evaluation.course_offerings.lecturer_id !== lecturerId) {
      throw new ForbiddenException(
        'You can only view results of your own evaluations',
      );
    }

    if (evaluation.status !== 'CLOSED') {
      throw new ConflictException(
        'Results are available after the evaluation is closed',
      );
    }

    return evaluation;
  }
}
