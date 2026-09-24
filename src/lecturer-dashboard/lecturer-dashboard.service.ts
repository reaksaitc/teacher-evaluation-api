import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const contextSelect = {
  id: true,
  status: true,
  start_at: true,
  end_at: true,
  survey_version_id: true,
  course_offerings: {
    select: {
      lecturer_id: true,
      section_code: true,
      courses: { select: { course_code: true, course_name: true } },
      semesters: { select: { semester_name: true, academic_year: true } },
    },
  },
  survey_versions: {
    select: { version_no: true, surveys: { select: { title: true } } },
  },
} satisfies Prisma.evaluationsSelect;

type EvaluationContext = Prisma.evaluationsGetPayload<{ select: typeof contextSelect }>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Clean object for the lecturer (no internal ids, nothing about students)
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
      academic_year: e.course_offerings.semesters.academic_year,
    },
    survey: {
      title: e.survey_versions.surveys.title,
      version_no: e.survey_versions.version_no,
    },
  };
}

@Injectable()
export class LecturerDashboardService {
  constructor(private prisma: PrismaService) {}

  async findMyEvaluations(lecturerId: bigint) {
    const rows = await this.prisma.evaluations.findMany({
      where: {
        status: { not: 'DRAFT' },
        course_offerings: { lecturer_id: lecturerId },
      },
      select: {
        ...contextSelect,
        _count: { select: { evaluation_participants: true, responses: true } },
      },
      orderBy: { id: 'desc' },
    });

    return rows.map((row) => ({
      ...toContext(row),
      eligible_count: row._count.evaluation_participants,
      response_count: row._count.responses,
      results_available: row.status === 'CLOSED',
    }));
  }

  async getDashboard(evaluationId: bigint, lecturerId: bigint) {
    const evaluation = await this.getOwnClosedEvaluation(evaluationId, lecturerId);

    const [eligibleCount, responseCount, ratingQuestions, grouped] = await Promise.all([
      this.prisma.evaluation_participants.count({ where: { evaluation_id: evaluationId } }),
      this.prisma.responses.count({ where: { evaluation_id: evaluationId } }),
      this.prisma.questions.findMany({
        where: { survey_version_id: evaluation.survey_version_id, question_type: 'RATING' },
        orderBy: { display_order: 'asc' },
      }),
      // The database counts answers per (question, score)
      this.prisma.answers.groupBy({
        by: ['question_id', 'rating_value'],
        where: { rating_value: { not: null }, responses: { evaluation_id: evaluationId } },
        _count: { _all: true },
      }),
    ]);

    let totalSum = 0;
    let totalCount = 0;

    const questions = ratingQuestions.map((q) => {
      const min = q.min_rating ?? 1;
      const max = q.max_rating ?? 5;

      // Every score in the range, starting at 0
      const distribution: Record<string, number> = {};
      for (let score = min; score <= max; score++) distribution[score] = 0;

      let sum = 0;
      let count = 0;
      for (const row of grouped) {
        if (row.question_id !== q.id || row.rating_value === null) continue;
        const n = row._count._all;
        distribution[row.rating_value] = (distribution[row.rating_value] ?? 0) + n;
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
      response_rate: eligibleCount > 0 ? round4(responseCount / eligibleCount) : 0,
      overall_average: totalCount > 0 ? round2(totalSum / totalCount) : null,
      questions,
    };
  }

  // Shared with Comments (Feature 13): exists → mine → closed
  async getOwnClosedEvaluation(evaluationId: bigint, lecturerId: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: { id: evaluationId },
      select: contextSelect,
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    if (evaluation.course_offerings.lecturer_id !== lecturerId) {
      throw new ForbiddenException('You can only view results of your own evaluations');
    }
    if (evaluation.status !== 'CLOSED') {
      throw new ConflictException('Results are available after the evaluation is closed');
    }
    return evaluation;
  }
}