import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';

// Creator (safe fields only) and a summary of each version
const surveyInclude = {
  users: { select: { id: true, full_name: true } },
  survey_versions: {
    select: { id: true, version_no: true, status: true, locked_at: true },
    orderBy: { version_no: 'asc' },
  },
} satisfies Prisma.surveysInclude;

@Injectable()
export class SurveysService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.surveys.findMany({ include: surveyInclude, orderBy: { id: 'asc' } });
  }

  async findOne(id: bigint) {
    const survey = await this.prisma.surveys.findUnique({ where: { id }, include: surveyInclude });
    if (!survey) throw new NotFoundException('Survey not found');
    return survey;
  }

  create(dto: CreateSurveyDto, createdBy: bigint) {
    const now = new Date();
    return this.prisma.surveys.create({
      data: {
        title: dto.title,
        description: dto.description,
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      },
      include: surveyInclude,
    });
  }

  async update(id: bigint, dto: UpdateSurveyDto) {
    await this.findOne(id);
    return this.prisma.surveys.update({
      where: { id },
      data: { title: dto.title, description: dto.description, updated_at: new Date() },
      include: surveyInclude,
    });
  }

  async remove(id: bigint) {
    await this.findOne(id);
    try {
      await this.prisma.surveys.delete({ where: { id } });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new ConflictException('Survey has versions and cannot be deleted');
      }
      throw e;
    }
  }
}