import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LecturerDashboardService } from '../lecturer-dashboard/lecturer-dashboard.service';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private dashboard: LecturerDashboardService,
  ) {}

  async getComments(evaluationId: bigint, lecturerId: bigint) {
    // Same rules as the dashboard: exists → mine → closed
    const evaluation = await this.dashboard.getOwnClosedEvaluation(evaluationId, lecturerId);

    const textQuestions = await this.prisma.questions.findMany({
      where: { survey_version_id: evaluation.survey_version_id, question_type: 'TEXT' },
      select: { id: true, question_text: true, display_order: true },
      orderBy: { display_order: 'asc' },
    });

    // Only the question and the text — nothing that could point to a response or a student
    const answers = await this.prisma.answers.findMany({
      where: {
        text_value: { not: null },
        question_id: { in: textQuestions.map((q) => q.id) },
        responses: { evaluation_id: evaluationId },
      },
      select: { question_id: true, text_value: true },
    });

    const questions = textQuestions.map((q) => {
      const comments = answers
        .filter((a) => a.question_id === q.id && a.text_value)
        .map((a) => a.text_value as string)
        .sort((a, b) => a.localeCompare(b)); // alphabetical, never submission order

      return {
        question_id: q.id,
        question_text: q.question_text,
        display_order: q.display_order,
        comment_count: comments.length,
        comments,
      };
    });

    return {
      evaluation_id: evaluationId,
      course: {
        code: evaluation.course_offerings.courses.course_code,
        name: evaluation.course_offerings.courses.course_name,
      },
      comment_count: questions.reduce((total, q) => total + q.comment_count, 0),
      questions,
    };
  }
}