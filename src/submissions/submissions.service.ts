import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { questions } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentAccessService } from '../student-access/student-access.service';
import { AnswerDto, SubmitResponseDto } from './dto/submit-response.dto';

type AnswerToSave = { question_id: bigint; rating_value: number | null; text_value: string | null };

// Midnight UTC of today. Stored instead of the exact time so a participant row
// can never be matched to a response row by comparing timestamps.
function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

@Injectable()
export class SubmissionsService {
  constructor(
    private prisma: PrismaService,
    private studentAccess: StudentAccessService,
  ) {}

  async submit(evaluationId: bigint, studentId: bigint, dto: SubmitResponseDto) {
    // 1. Same eligibility rules as viewing the survey
    const { evaluation, participant } = await this.studentAccess.getAnswerableEvaluation(evaluationId, studentId);

    // 2. Validate every answer before any write
    const questionList = await this.prisma.questions.findMany({
      where: { survey_version_id: evaluation.survey_version_id },
    });
    const answersToSave = this.buildAnswers(questionList, dto.answers);

    // 3. All or nothing
    const day = startOfUtcDay(new Date());
    await this.prisma.$transaction(async (tx) => {
      // Re-check the evaluation is still open (it could have closed a moment ago)
      const current = await tx.evaluations.findUnique({
        where: { id: evaluationId },
        select: { status: true, start_at: true, end_at: true },
      });
      const now = new Date();
      if (
        !current ||
        current.status !== 'OPEN' ||
        !current.start_at ||
        !current.end_at ||
        now < current.start_at ||
        now >= current.end_at
      ) {
        throw new ConflictException('This evaluation is not open');
      }

      // Mark as submitted ONLY if not already — safe against double-clicks
      const marked = await tx.evaluation_participants.updateMany({
        where: { id: participant.id, has_submitted: false },
        data: { has_submitted: true, submitted_at: day },
      });
      if (marked.count === 0) {
        throw new ConflictException('You have already submitted this evaluation');
      }

      // Anonymous response: no student id, no participant id
      const response = await tx.responses.create({
        data: { evaluation_id: evaluationId, submitted_at: day, created_at: day },
      });

      await tx.answers.createMany({
        data: answersToSave.map((a) => ({ ...a, response_id: response.id, created_at: day })),
      });
    });

    return {
      evaluation_id: evaluationId,
      submitted: true,
      message: 'Evaluation submitted successfully.',
    };
  }

  private buildAnswers(questionList: questions[], answers: AnswerDto[]): AnswerToSave[] {
    const byId = new Map(questionList.map((q) => [q.id.toString(), q]));
    const seen = new Set<string>();
    const toSave: AnswerToSave[] = [];

    for (const answer of answers) {
      const key = BigInt(answer.question_id).toString();
      const question = byId.get(key);

      if (!question) {
        throw new BadRequestException(`Question ${answer.question_id} is not part of this survey`);
      }
      if (seen.has(key)) {
        throw new BadRequestException(`Question ${answer.question_id} is answered more than once`);
      }
      seen.add(key);

      if (question.question_type === 'RATING') {
        if (answer.text_value !== undefined) {
          throw new BadRequestException(`Question ${question.display_order} takes a rating, not text`);
        }
        if (answer.rating_value === undefined) continue; // unanswered; required check below
        const min = question.min_rating ?? 1;
        const max = question.max_rating ?? 5;
        if (answer.rating_value < min || answer.rating_value > max) {
          throw new BadRequestException(
            `Rating for question ${question.display_order} must be between ${min} and ${max}`,
          );
        }
        toSave.push({ question_id: question.id, rating_value: answer.rating_value, text_value: null });
      } else {
        if (answer.rating_value !== undefined) {
          throw new BadRequestException(`Question ${question.display_order} takes text, not a rating`);
        }
        const text = answer.text_value?.trim();
        if (!text) continue; // empty comment = not answered
        toSave.push({ question_id: question.id, rating_value: null, text_value: text });
      }
    }

    const answered = new Set(toSave.map((a) => a.question_id.toString()));
    const missing = questionList.filter((q) => q.is_required && !answered.has(q.id.toString()));
    if (missing.length > 0) {
      const numbers = missing.map((q) => q.display_order).join(', ');
      throw new BadRequestException(`Required question(s) not answered: ${numbers}`);
    }

    return toSave;
  }
}