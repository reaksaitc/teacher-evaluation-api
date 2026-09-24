import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Only what a student needs to see about an evaluation
const contextSelect = {
  id: true,
  status: true,
  start_at: true,
  end_at: true,
  survey_version_id: true,
  course_offering_id: true,
  course_offerings: {
    select: {
      section_code: true,
      courses: { select: { course_code: true, course_name: true } },
      semesters: { select: { semester_name: true, academic_year: true } },
      users: { select: { full_name: true } },
    },
  },
  survey_versions: {
    select: { version_no: true, surveys: { select: { title: true } } },
  },
} satisfies Prisma.evaluationsSelect;

type EvaluationContext = Prisma.evaluationsGetPayload<{ select: typeof contextSelect }>;

const questionSelect = {
  id: true,
  question_text: true,
  question_type: true,
  category: true,
  is_required: true,
  min_rating: true,
  max_rating: true,
  display_order: true,
} satisfies Prisma.questionsSelect;

// Build the clean object sent to the student (no internal ids)
function toSummary(e: EvaluationContext) {
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
    lecturer: { full_name: e.course_offerings.users.full_name },
    survey: {
      title: e.survey_versions.surveys.title,
      version_no: e.survey_versions.version_no,
    },
  };
}

@Injectable()
export class StudentAccessService {
  constructor(private prisma: PrismaService) {}

  async findAvailable(studentId: bigint) {
    const now = new Date();
    const rows = await this.prisma.evaluation_participants.findMany({
      where: {
        student_id: studentId,
        has_submitted: false,
        evaluations: {
          status: 'OPEN',
          start_at: { lte: now },
          end_at: { gt: now },
          course_offerings: { enrollments: { some: { student_id: studentId } } },
        },
      },
      select: { evaluations: { select: contextSelect } },
      orderBy: { evaluations: { end_at: 'asc' } },
    });
    return rows.map((row) => toSummary(row.evaluations));
  }

  async getSurvey(evaluationId: bigint, studentId: bigint) {
    const { evaluation } = await this.getAnswerableEvaluation(evaluationId, studentId);

    const questions = await this.prisma.questions.findMany({
      where: { survey_version_id: evaluation.survey_version_id },
      select: questionSelect,
      orderBy: { display_order: 'asc' },
    });

    return { evaluation: toSummary(evaluation), questions };
  }

  async getSubmissionStatus(evaluationId: bigint, studentId: bigint) {
    await this.findEvaluation(evaluationId);

    const participant = await this.prisma.evaluation_participants.findFirst({
      where: { evaluation_id: evaluationId, student_id: studentId },
      select: { has_submitted: true, submitted_at: true },
    });
    if (!participant) throw new ForbiddenException('You are not eligible for this evaluation');

    return {
      evaluation_id: evaluationId,
      has_submitted: participant.has_submitted,
      submitted_at: participant.submitted_at,
    };
  }

  // The single place that decides "may this student answer this evaluation right now?"
  // Also used by Submission (Feature 11).
  async getAnswerableEvaluation(evaluationId: bigint, studentId: bigint) {
    const evaluation = await this.findEvaluation(evaluationId);

    const [participant, enrollment] = await Promise.all([
      this.prisma.evaluation_participants.findFirst({
        where: { evaluation_id: evaluationId, student_id: studentId },
      }),
      this.prisma.enrollments.findFirst({
        where: { student_id: studentId, course_offering_id: evaluation.course_offering_id },
        select: { id: true },
      }),
    ]);

    if (!participant || !enrollment) {
      throw new ForbiddenException('You are not eligible for this evaluation');
    }
    if (!this.isOpenNow(evaluation)) {
      throw new ConflictException('This evaluation is not open');
    }
    if (participant.has_submitted) {
      throw new ConflictException('You have already submitted this evaluation');
    }

    return { evaluation, participant };
  }

  private async findEvaluation(evaluationId: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: { id: evaluationId },
      select: contextSelect,
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    return evaluation;
  }

  private isOpenNow(e: EvaluationContext) {
    const now = new Date();
    return (
      e.status === 'OPEN' &&
      e.start_at !== null &&
      e.end_at !== null &&
      e.start_at <= now &&
      now < e.end_at
    );
  }
}