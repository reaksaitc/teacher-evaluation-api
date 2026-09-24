import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { question_type } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SurveyVersionsService } from '../survey-versions/survey-versions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

const DUPLICATE_ORDER = 'display_order is already used in this survey version';

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private surveyVersions: SurveyVersionsService,
  ) {}

  async findAllForVersion(versionId: bigint) {
    const version = await this.prisma.survey_versions.findUnique({
      where: { id: versionId },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('Survey version not found');

    return this.prisma.questions.findMany({
      where: { survey_version_id: versionId },
      orderBy: { display_order: 'asc' },
    });
  }

  async create(versionId: bigint, dto: CreateQuestionDto) {
    await this.surveyVersions.assertEditable(versionId);

    const range = this.resolveRatingRange(dto.question_type, dto.min_rating, dto.max_rating);
    const displayOrder = dto.display_order ?? (await this.nextDisplayOrder(versionId));
    const now = new Date();

    try {
      return await this.prisma.questions.create({
        data: {
          survey_version_id: versionId,
          question_text: dto.question_text,
          question_type: dto.question_type,
          category: dto.category,
          is_required: dto.is_required ?? true,
          min_rating: range.min,
          max_rating: range.max,
          display_order: displayOrder,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(DUPLICATE_ORDER);
      throw e;
    }
  }

  async update(questionId: bigint, dto: UpdateQuestionDto) {
    const question = await this.findQuestion(questionId);
    await this.surveyVersions.assertEditable(question.survey_version_id);

    // Work out the final type and range, then validate them together
    const type = dto.question_type ?? question.question_type;
    const typeChanged = type !== question.question_type;
    const min = dto.min_rating ?? (typeChanged ? undefined : question.min_rating ?? undefined);
    const max = dto.max_rating ?? (typeChanged ? undefined : question.max_rating ?? undefined);
    const range = this.resolveRatingRange(type, min, max);

    try {
      return await this.prisma.questions.update({
        where: { id: questionId },
        data: {
          question_text: dto.question_text,
          question_type: type,
          category: dto.category,
          is_required: dto.is_required,
          min_rating: range.min,
          max_rating: range.max,
          display_order: dto.display_order,
          updated_at: new Date(),
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(DUPLICATE_ORDER);
      throw e;
    }
  }

  async remove(questionId: bigint) {
    const question = await this.findQuestion(questionId);
    await this.surveyVersions.assertEditable(question.survey_version_id);

    try {
      await this.prisma.questions.delete({ where: { id: questionId } });
    } catch (e: any) {
      if (e.code === 'P2003') throw new ConflictException('Question already has answers and cannot be deleted');
      throw e;
    }
  }

  private async findQuestion(questionId: bigint) {
    const question = await this.prisma.questions.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  // RATING: range defaults to 1–5 and min must be below max. TEXT: no range allowed.
  private resolveRatingRange(type: question_type, min?: number, max?: number) {
    if (type === 'TEXT') {
      if (min !== undefined || max !== undefined) {
        throw new BadRequestException('min_rating and max_rating are only allowed for RATING questions');
      }
      return { min: null, max: null };
    }

    const low = min ?? 1;
    const high = max ?? 5;
    if (low >= high) {
      throw new BadRequestException('min_rating must be less than max_rating');
    }
    return { min: low, max: high };
  }

  private async nextDisplayOrder(versionId: bigint) {
    const result = await this.prisma.questions.aggregate({
      where: { survey_version_id: versionId },
      _max: { display_order: true },
    });
    return (result._max.display_order ?? 0) + 1;
  }
}