import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { question_type, questions } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StudentAccessService } from '../student-access/student-access.service';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import { AnswerDto, SubmitResponseDto } from './dto/submit-response.dto';

type AnswerToSave = {
  question_id: bigint;
  rating_value: number | null;
  text_value: string | null;
  selected_option_ids: bigint[];
};

// Midnight UTC of today. Stored instead of the exact time so a participant row
// can never be matched to a response row by comparing timestamps.
function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

@Injectable()
export class SubmissionsService {
  constructor(
    private prisma: PrismaService,
    private studentAccess: StudentAccessService,
  ) {}

  async submit(
    evaluationId: bigint,
    studentId: bigint,
    dto: SubmitResponseDto,
  ) {
    return inSerializableTransaction(this.prisma, (db) =>
      new SubmissionsService(db, this.studentAccess).submitInTransaction(
        evaluationId,
        studentId,
        dto,
      ),
    );
  }

  private async submitInTransaction(
    evaluationId: bigint,
    studentId: bigint,
    dto: SubmitResponseDto,
  ) {
    /*
     * 1. Apply the same access rules used when viewing the
     * questionnaire.
     *
     * effectiveSurveyVersionId is participant-specific.
     * For historical participant rows whose version is NULL,
     * StudentAccessService falls back to the evaluation's base
     * survey version.
     */
    const { participant, effectiveSurveyVersionId } =
      await this.studentAccess.getAnswerableEvaluation(
        evaluationId,
        studentId,
        this.prisma,
      );

    /*
     * 2. Load questions only from the exact version currently
     * assigned to this participant.
     */
    const questionList = await this.prisma.questions.findMany({
      where: {
        survey_version_id: effectiveSurveyVersionId,
      },
      include: {
        question_options: true,
      },
    });

    /*
     * 3. Validate every answer before any database write.
     */
    const answersToSave = this.buildAnswers(questionList, dto.answers);

    /*
     * 4. Final submission is all-or-nothing.
     */
    const day = startOfUtcDay(new Date());

    await this.prisma.$transaction(async (tx) => {
      /*
       * Re-check the evaluation lifecycle inside the transaction.
       *
       * The evaluation could have been closed after the first
       * StudentAccessService check but before this transaction.
       */
      const currentEvaluation = await tx.evaluations.findUnique({
        where: {
          id: evaluationId,
        },
        select: {
          status: true,
          start_at: true,
          end_at: true,
          survey_version_id: true,
        },
      });

      const now = new Date();

      if (
        !currentEvaluation ||
        currentEvaluation.status !== 'OPEN' ||
        !currentEvaluation.start_at ||
        !currentEvaluation.end_at ||
        now < currentEvaluation.start_at ||
        now >= currentEvaluation.end_at
      ) {
        throw new ConflictException('This evaluation is not open');
      }

      /*
       * Re-read the participant inside the transaction.
       *
       * This protects against a participant/version change between
       * initial questionnaire validation and the final write.
       */
      const currentParticipant = await tx.evaluation_participants.findUnique({
        where: {
          id: participant.id,
        },
        select: {
          id: true,
          evaluation_id: true,
          student_id: true,
          survey_version_id: true,
          has_submitted: true,
          placement_snapshot: true,
        },
      });

      if (
        !currentParticipant ||
        currentParticipant.evaluation_id !== evaluationId ||
        currentParticipant.student_id !== studentId
      ) {
        throw new ConflictException(
          'You are no longer eligible for this evaluation',
        );
      }

      if (currentParticipant.has_submitted) {
        throw new ConflictException(
          'You have already submitted this evaluation',
        );
      }

      /*
       * NULL participant survey_version_id means a historical
       * participant that still uses the evaluation's base version.
       */
      const currentEffectiveSurveyVersionId =
        currentParticipant.survey_version_id ??
        currentEvaluation.survey_version_id;

      /*
       * Do not accept answers validated against an old version if
       * the participant was moved to another version before the
       * transaction started.
       */
      if (currentEffectiveSurveyVersionId !== effectiveSurveyVersionId) {
        throw new ConflictException(
          'The questionnaire version changed before submission. Please reload the evaluation before submitting.',
        );
      }

      /*
       * Mark as submitted only if the participant is still
       * unsubmitted AND still has the same participant-level
       * version state that we just checked.
       *
       * Including survey_version_id in updateMany protects against
       * a concurrent version change between the participant read
       * and this update.
       *
       * Prisma treats null explicitly here for historical rows.
       */
      const marked = await tx.evaluation_participants.updateMany({
        where: {
          id: participant.id,
          has_submitted: false,
          survey_version_id: currentParticipant.survey_version_id,
        },
        data: {
          has_submitted: true,
          submitted_at: day,
        },
      });

      if (marked.count === 0) {
        throw new ConflictException(
          'The evaluation assignment changed or was already submitted. Please reload the evaluation.',
        );
      }

      /*
       * Anonymous response:
       *
       * There is intentionally no student_id and no participant_id.
       * survey_version_id records only which questionnaire version
       * produced this anonymous response.
       */
      const response = await tx.responses.create({
        data: {
          evaluation_id: evaluationId,
          audience_major_id: (currentParticipant.placement_snapshot as any)
            ?.major?.id
            ? BigInt((currentParticipant.placement_snapshot as any).major.id)
            : null,
          ...((currentParticipant.placement_snapshot as any)?.major
            ? {
                audience_major_label: (
                  currentParticipant.placement_snapshot as any
                ).major,
              }
            : {}),
          survey_version_id: effectiveSurveyVersionId,

          submitted_at: day,
          created_at: day,
        },
      });

      /*
       * Create answers individually.
       *
       * We need each generated answer.id because MULTIPLE_CHOICE
       * and CHECKBOX selections reference it through answer_options.
       */
      for (const answerToSave of answersToSave) {
        const answer = await tx.answers.create({
          data: {
            response_id: response.id,
            question_id: answerToSave.question_id,
            rating_value: answerToSave.rating_value,
            text_value: answerToSave.text_value,
            created_at: day,
          },
        });

        if (answerToSave.selected_option_ids.length > 0) {
          await tx.answer_options.createMany({
            data: answerToSave.selected_option_ids.map((optionId) => ({
              answer_id: answer.id,
              option_id: optionId,
            })),
          });
        }
      }

      /*
       * The final response is now safely stored anonymously.
       *
       * Remove the identifiable unfinished draft in the SAME
       * transaction.
       *
       * If any part of this transaction fails, Prisma rolls
       * everything back, so:
       *
       * - the participant remains unsubmitted;
       * - no partial response remains;
       * - the saved draft remains.
       */
      await tx.assessment_drafts.deleteMany({
        where: {
          participant_id: participant.id,
        },
      });
    });

    return {
      evaluation_id: evaluationId,
      survey_version_id: effectiveSurveyVersionId,
      submitted: true,
      message: 'Evaluation submitted successfully.',
    };
  }

  private buildAnswers(
    questionList: Array<
      questions & {
        question_options: {
          id: bigint;
          question_id: bigint;
          option_text: string;
          display_order: number;
        }[];
      }
    >,
    answers: AnswerDto[],
  ): AnswerToSave[] {
    const byId = new Map(
      questionList.map((question) => [question.id.toString(), question]),
    );

    const seen = new Set<string>();
    const toSave: AnswerToSave[] = [];

    for (const answer of answers) {
      const key = BigInt(answer.question_id).toString();

      const question = byId.get(key);

      if (!question) {
        throw new BadRequestException(
          `Question ${answer.question_id} is not part of this survey`,
        );
      }

      if (seen.has(key)) {
        throw new BadRequestException(
          `Question ${answer.question_id} is answered more than once`,
        );
      }

      seen.add(key);

      switch (question.question_type) {
        case question_type.RATING:
          this.rejectTextAndOptions(answer, question.display_order);

          if (answer.rating_value === undefined) {
            break;
          }

          this.validateRating(question, answer.rating_value);

          toSave.push({
            question_id: question.id,
            rating_value: answer.rating_value,
            text_value: null,
            selected_option_ids: [],
          });

          break;

        case question_type.AGREEMENT:
        case question_type.FREQUENCY:
          this.rejectTextAndOptions(answer, question.display_order);

          if (answer.rating_value === undefined) {
            break;
          }

          if (answer.rating_value < 1 || answer.rating_value > 5) {
            throw new BadRequestException(
              `Rating for question ${question.display_order} must be between 1 and 5`,
            );
          }

          toSave.push({
            question_id: question.id,
            rating_value: answer.rating_value,
            text_value: null,
            selected_option_ids: [],
          });

          break;

        case question_type.TEXT: {
          if (answer.rating_value !== undefined) {
            throw new BadRequestException(
              `Question ${question.display_order} takes text, not a rating`,
            );
          }

          if (answer.selected_option_ids !== undefined) {
            throw new BadRequestException(
              `Question ${question.display_order} takes text, not selected options`,
            );
          }

          const text = answer.text_value?.trim();

          // Empty optional text = unanswered.
          if (!text) {
            break;
          }

          toSave.push({
            question_id: question.id,
            rating_value: null,
            text_value: text,
            selected_option_ids: [],
          });

          break;
        }

        case question_type.MULTIPLE_CHOICE:
        case question_type.CHECKBOX: {
          if (answer.rating_value !== undefined) {
            throw new BadRequestException(
              `Question ${question.display_order} takes selected options, not a rating`,
            );
          }

          if (answer.text_value !== undefined) {
            throw new BadRequestException(
              `Question ${question.display_order} takes selected options, not text`,
            );
          }

          const selected = answer.selected_option_ids;

          // No options = unanswered.
          if (!selected || selected.length === 0) {
            break;
          }

          const uniqueIds = new Set(
            selected.map((id) => BigInt(id).toString()),
          );

          if (uniqueIds.size !== selected.length) {
            throw new BadRequestException(
              `Question ${question.display_order} contains duplicate selected options`,
            );
          }

          if (
            question.question_type === question_type.MULTIPLE_CHOICE &&
            selected.length !== 1
          ) {
            throw new BadRequestException(
              `Question ${question.display_order} allows exactly one option`,
            );
          }

          const validOptionIds = new Set(
            question.question_options.map((option) => option.id.toString()),
          );

          const selectedIds = selected.map((id) => BigInt(id));

          for (const optionId of selectedIds) {
            if (!validOptionIds.has(optionId.toString())) {
              throw new BadRequestException(
                `Option ${optionId.toString()} does not belong to question ${question.display_order}`,
              );
            }
          }

          toSave.push({
            question_id: question.id,
            rating_value: null,
            text_value: null,
            selected_option_ids: selectedIds,
          });

          break;
        }

        default:
          throw new BadRequestException(
            `Unsupported question type for question ${question.display_order}`,
          );
      }
    }

    /*
     * Check all required questions after validating submitted
     * answers.
     */
    const answered = new Set(
      toSave.map((answer) => answer.question_id.toString()),
    );

    const missing = questionList.filter(
      (question) =>
        question.is_required && !answered.has(question.id.toString()),
    );

    if (missing.length > 0) {
      const numbers = missing
        .map((question) => question.display_order)
        .join(', ');

      throw new BadRequestException(
        `Required question(s) not answered: ${numbers}`,
      );
    }

    return toSave;
  }

  private validateRating(question: questions, ratingValue: number) {
    const min = question.min_rating ?? 1;
    const max = question.max_rating ?? 5;

    if (ratingValue < min || ratingValue > max) {
      throw new BadRequestException(
        `Rating for question ${question.display_order} must be between ${min} and ${max}`,
      );
    }
  }

  private rejectTextAndOptions(answer: AnswerDto, displayOrder: number) {
    if (answer.text_value !== undefined) {
      throw new BadRequestException(
        `Question ${displayOrder} takes a rating, not text`,
      );
    }

    if (answer.selected_option_ids !== undefined) {
      throw new BadRequestException(
        `Question ${displayOrder} takes a rating, not selected options`,
      );
    }
  }
}
