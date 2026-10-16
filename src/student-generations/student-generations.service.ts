import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { CreateStudentGenerationDto } from './dto/create-student-generation.dto';
import { UpdateStudentGenerationDto } from './dto/update-student-generation.dto';
import { generationNumber } from './generation-identity.util';

const include = {
  majors: true,
  entry_academic_year: true,
  _count: {
    select: {
      students: true,
      evaluation_targets: true,
      course_offering_group_scopes: true,
      evaluation_group_targets: true,
    },
  },
} as const;
@Injectable()
export class StudentGenerationsService {
  constructor(private prisma: PrismaService) {}
  findAll() {
    return this.prisma.student_generations.findMany({
      include,
      orderBy: [
        { major_id: 'asc' },
        { generation_number: 'asc' },
        { id: 'asc' },
      ],
    });
  }
  async findOne(id: bigint) {
    const value = await this.prisma.student_generations.findUnique({
      where: { id },
      include,
    });
    if (!value) throw new NotFoundException('Student generation not found');
    return value;
  }
  async create(dto: CreateStudentGenerationDto, actorId?: bigint) {
    return inSerializableTransaction(
      this.prisma,
      async (db) => {
        if (!dto.major_id)
          throw new BadRequestException(
            'major_id is required; a global cohort name is ambiguous',
          );
        const number = generationNumber(dto.generation_number ?? dto.name);
        if (
          dto.generation_number !== undefined &&
          dto.name !== undefined &&
          generationNumber(dto.name) !== number
        )
          throw new BadRequestException('name and generation_number disagree');
        const major = await db.majors.findUnique({
          where: { id: BigInt(dto.major_id) },
          include: { departments: true },
        });
        if (!major || major.departments.status !== 'ACTIVE')
          throw new BadRequestException(
            'Choose a major in an active department',
          );
        if (actorId !== undefined)
          await assertDepartmentScope(db, actorId, major.department_id);
        const year = await db.academic_years.findUnique({
          where: { id: BigInt(dto.entry_academic_year_id) },
        });
        if (!year) throw new NotFoundException('Academic year not found');
        return db.student_generations.create({
          data: {
            major_id: major.id,
            generation_number: number,
            name: `Gen ${number}`,
            entry_academic_year_id: year.id,
            starting_year_level: dto.starting_year_level ?? 1,
          },
          include,
        });
      },
      (error) => {
        if (error.code === 'P2002')
          throw new ConflictException(
            'This major already has that generation number',
          );
        throw error;
      },
    );
  }
  async update(id: bigint, dto: UpdateStudentGenerationDto, actorId?: bigint) {
    return inSerializableTransaction(this.prisma, async (db) => {
      const current = await new StudentGenerationsService(db).findOne(id);
      if (current.major_id === null)
        throw new ConflictException(
          'Legacy cohort changes require the reviewed migration tool',
        );
      const majorId = dto.major_id ? BigInt(dto.major_id) : current.major_id;
      const number =
        dto.generation_number !== undefined || dto.name !== undefined
          ? generationNumber(dto.generation_number ?? dto.name)
          : current.generation_number!;
      if (majorId !== current.major_id || number !== current.generation_number)
        throw new ConflictException(
          'Cohort identity is immutable; use an explicitly reviewed reassignment',
        );
      if (actorId !== undefined)
        await assertDepartmentScope(db, actorId, current.majors!.department_id);
      const inUse = Object.values(current._count).some((n) => n > 0);
      if (
        inUse &&
        ((dto.entry_academic_year_id &&
          BigInt(dto.entry_academic_year_id) !==
            current.entry_academic_year_id) ||
          (dto.starting_year_level !== undefined &&
            dto.starting_year_level !== current.starting_year_level))
      )
        throw new ConflictException(
          'Used cohort entry/progression metadata is immutable',
        );
      if (
        dto.entry_academic_year_id &&
        !(await db.academic_years.findUnique({
          where: { id: BigInt(dto.entry_academic_year_id) },
        }))
      )
        throw new NotFoundException('Academic year not found');
      return db.student_generations.update({
        where: { id },
        data: {
          entry_academic_year_id: dto.entry_academic_year_id
            ? BigInt(dto.entry_academic_year_id)
            : undefined,
          starting_year_level: dto.starting_year_level,
        },
        include,
      });
    });
  }
  async remove(id: bigint) {
    return inSerializableTransaction(this.prisma, async (db) => {
      const current = await new StudentGenerationsService(db).findOne(id);
      if (Object.values(current._count).some((n) => n > 0))
        throw new ConflictException(
          'Student generation is in use and cannot be deleted',
        );
      return db.student_generations.delete({ where: { id } });
    });
  }
}
