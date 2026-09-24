import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSurveyVersionDto } from './dto/create-survey-version.dto';

@Injectable()
export class SurveyVersionsService {
  constructor(private prisma: PrismaService) {}

  async findAllForSurvey(surveyId: bigint) {
    await this.checkSurveyExists(surveyId);
    return this.prisma.survey_versions.findMany({
      where: { survey_id: surveyId },
      include: { _count: { select: { questions: true, evaluations: true } } },
      orderBy: { version_no: 'asc' },
    });
  }

  // The version must belong to the survey in the URL, otherwise it's "not found"
  async findOne(surveyId: bigint, versionId: bigint) {
    const version = await this.prisma.survey_versions.findFirst({
      where: { id: versionId, survey_id: surveyId },
      include: {
        questions: { orderBy: { display_order: 'asc' } },
        _count: { select: { evaluations: true } },
      },
    });
    if (!version) throw new NotFoundException('Survey version not found');
    return version;
  }

  async create(surveyId: bigint, dto: CreateSurveyVersionDto, createdBy: bigint) {
    await this.checkSurveyExists(surveyId);

    try {
      // All or nothing: the new version and its copied questions are saved together
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.survey_versions.findFirst({
          where: { survey_id: surveyId },
          orderBy: { version_no: 'desc' },
          include: { questions: true },
        });

        const now = new Date();
        const version = await tx.survey_versions.create({
          data: {
            survey_id: surveyId,
            version_no: (latest?.version_no ?? 0) + 1,
            status: 'DRAFT',
            created_by: createdBy,
            created_at: now,
          },
        });

        if (dto.copy_questions && latest && latest.questions.length > 0) {
          await tx.questions.createMany({
            data: latest.questions.map((q) => ({
              survey_version_id: version.id,
              question_text: q.question_text,
              question_type: q.question_type,
              category: q.category,
              is_required: q.is_required,
              min_rating: q.min_rating,
              max_rating: q.max_rating,
              display_order: q.display_order,
              created_at: now,
              updated_at: now,
            })),
          });
        }

        return tx.survey_versions.findUniqueOrThrow({
          where: { id: version.id },
          include: { questions: { orderBy: { display_order: 'asc' } } },
        });
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('Another version was created at the same time, please try again');
      }
      throw e;
    }
  }

  async archive(surveyId: bigint, versionId: bigint) {
    const version = await this.findOne(surveyId, versionId);
    if (version.status === 'ARCHIVED') {
      throw new ConflictException('Survey version is already archived');
    }
    return this.prisma.survey_versions.update({
      where: { id: versionId },
      data: { status: 'ARCHIVED' },
    });
  }

  async remove(surveyId: bigint, versionId: bigint) {
    const version = await this.findOne(surveyId, versionId);
    if (version.status === 'LOCKED') {
      throw new ConflictException('A locked survey version cannot be deleted');
    }
    if (version._count.evaluations > 0) {
      throw new ConflictException('Survey version is used by evaluations and cannot be deleted');
    }

    // Remove its questions and the version together
    await this.prisma.$transaction([
      this.prisma.questions.deleteMany({ where: { survey_version_id: versionId } }),
      this.prisma.survey_versions.delete({ where: { id: versionId } }),
    ]);
  }

  // Used by the Questions feature (Feature 8).
  // Editable only while DRAFT and no evaluation using it has been opened.
  async assertEditable(versionId: bigint) {
    const version = await this.prisma.survey_versions.findUnique({
      where: { id: versionId },
      include: {
        evaluations: { where: { status: { not: 'DRAFT' } }, select: { id: true } },
      },
    });
    if (!version) throw new NotFoundException('Survey version not found');
    if (version.status !== 'DRAFT' || version.evaluations.length > 0) {
      throw new ConflictException('This survey version is locked and its questions cannot be changed');
    }
    return version;
  }

  private async checkSurveyExists(surveyId: bigint) {
    const survey = await this.prisma.surveys.findUnique({
      where: { id: surveyId },
      select: { id: true },
    });
    if (!survey) throw new NotFoundException('Survey not found');
  }
}