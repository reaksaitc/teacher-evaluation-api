import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ListEvaluationsQueryDto } from './dto/list-evaluations-query.dto';

// Context shown with every evaluation (safe fields only) plus live counts
const evaluationInclude = {
  course_offerings: {
    select: {
      id: true,
      section_code: true,
      courses: { select: { id: true, course_code: true, course_name: true } },
      semesters: { select: { id: true, semester_name: true, academic_year: true } },
      users: { select: { id: true, full_name: true } },
    },
  },
  survey_versions: {
    select: {
      id: true,
      version_no: true,
      status: true,
      surveys: { select: { id: true, title: true } },
    },
  },
  _count: { select: { evaluation_participants: true, responses: true } },
} satisfies Prisma.evaluationsInclude;

@Injectable()
export class EvaluationsService {
  constructor(private prisma: PrismaService) {}

  findAll(query: ListEvaluationsQueryDto) {
    return this.prisma.evaluations.findMany({
      where: { status: query.status },
      include: evaluationInclude,
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: { id },
      include: evaluationInclude,
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    return evaluation;
  }

  async create(dto: CreateEvaluationDto, createdBy: bigint) {
    const offeringId = BigInt(dto.course_offering_id);
    const versionId = BigInt(dto.survey_version_id);

    const [offering, version] = await Promise.all([
      this.prisma.course_offerings.findUnique({ where: { id: offeringId }, select: { id: true } }),
      this.prisma.survey_versions.findUnique({ where: { id: versionId }, select: { status: true } }),
    ]);
    if (!offering) throw new BadRequestException('course_offering_id does not match any course offering');
    if (!version) throw new BadRequestException('survey_version_id does not match any survey version');
    if (version.status === 'ARCHIVED') {
      throw new BadRequestException('An archived survey version cannot be used for a new evaluation');
    }

    const startAt = dto.start_at ? new Date(dto.start_at) : null;
    const endAt = dto.end_at ? new Date(dto.end_at) : null;
    this.checkWindow(startAt, endAt);

    const now = new Date();
    try {
      return await this.prisma.evaluations.create({
        data: {
          course_offering_id: offeringId,
          survey_version_id: versionId,
          status: 'DRAFT',
          start_at: startAt,
          end_at: endAt,
          created_by: createdBy,
          created_at: now,
          updated_at: now,
        },
        include: evaluationInclude,
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('This course offering already has an evaluation using this survey version');
      }
      throw e;
    }
  }

  async updateSchedule(id: bigint, dto: UpdateScheduleDto) {
    const evaluation = await this.findOne(id);
    if (evaluation.status !== 'DRAFT') {
      throw new ConflictException('The schedule can only be changed while the evaluation is a DRAFT');
    }

    const startAt = dto.start_at !== undefined ? new Date(dto.start_at) : evaluation.start_at;
    const endAt = dto.end_at !== undefined ? new Date(dto.end_at) : evaluation.end_at;
    this.checkWindow(startAt, endAt);

    return this.prisma.evaluations.update({
      where: { id },
      data: { start_at: startAt, end_at: endAt, updated_at: new Date() },
      include: evaluationInclude,
    });
  }

  async open(id: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: { id },
      include: {
        survey_versions: { include: { _count: { select: { questions: true } } } },
      },
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    if (evaluation.status !== 'DRAFT') throw new ConflictException('Only a DRAFT evaluation can be opened');

    // Readiness checks
    if (!evaluation.start_at || !evaluation.end_at) {
      throw new BadRequestException('Set start_at and end_at before opening the evaluation');
    }
    if (evaluation.end_at <= new Date()) {
      throw new BadRequestException('end_at is already in the past');
    }
    if (evaluation.survey_versions.status === 'ARCHIVED') {
      throw new BadRequestException('The survey version is archived');
    }
    if (evaluation.survey_versions._count.questions === 0) {
      throw new BadRequestException('The survey version has no questions');
    }

    const enrollments = await this.prisma.enrollments.findMany({
      where: { course_offering_id: evaluation.course_offering_id },
      select: { student_id: true },
    });
    if (enrollments.length === 0) {
      throw new BadRequestException('No students are enrolled in this course offering');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Change status only if it is STILL a DRAFT — safe if two admins click at once
      const changed = await tx.evaluations.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'OPEN', updated_at: now },
      });
      if (changed.count === 0) throw new ConflictException('Only a DRAFT evaluation can be opened');

      // Lock the question set for good
      await tx.survey_versions.update({
        where: { id: evaluation.survey_version_id },
        data: { status: 'LOCKED', locked_at: evaluation.survey_versions.locked_at ?? now },
      });

      // One participant row per enrolled student (who may submit, and whether they have)
      await tx.evaluation_participants.createMany({
        data: enrollments.map((e) => ({
          evaluation_id: id,
          student_id: e.student_id,
          has_submitted: false,
          created_at: now,
        })),
        skipDuplicates: true,
      });
    });

    return this.findOne(id);
  }

  async close(id: bigint) {
    await this.findOne(id);

    const changed = await this.prisma.evaluations.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'CLOSED', updated_at: new Date() },
    });
    if (changed.count === 0) throw new ConflictException('Only an OPEN evaluation can be closed');

    return this.findOne(id);
  }

  async remove(id: bigint) {
    const evaluation = await this.findOne(id);
    if (evaluation.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT evaluation can be deleted');
    }
    await this.prisma.evaluations.delete({ where: { id } });
  }

  private checkWindow(startAt: Date | null, endAt: Date | null) {
    if (startAt && endAt && endAt <= startAt) {
      throw new BadRequestException('end_at must be after start_at');
    }
  }
}