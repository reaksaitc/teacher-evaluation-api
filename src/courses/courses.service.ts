import { idempotentOperation } from '../common/utils/idempotent-operation.util';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { generatedCoursePrefix, nextCourseCode } from './course-code.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.courses.findMany({
      include: {
        departments: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
  }

  async findOne(id: bigint) {
    const course = await this.prisma.courses.findUnique({
      where: { id },
      include: {
        departments: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async create(dto: CreateCourseDto, actorId?: bigint) {
    if (dto.course_code === null)
      throw new BadRequestException(
        'Omit course_code for automatic allocation; null is invalid',
      );
    return idempotentOperation(
      this.prisma,
      actorId ?? 0n,
      'CREATE_COURSE',
      dto.idempotency_key,
      dto,
      async (db) => {
        const department = await db.departments.findUnique({
          where: { id: BigInt(dto.department_id) },
        });
        if (!department || department.status !== 'ACTIVE')
          throw new BadRequestException('Choose an active department');
        if (actorId !== undefined)
          await assertDepartmentScope(db, actorId, department.id);
        // Global allocation lock also coordinates manually supplied codes and sanitized prefix collisions.
        await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7248130201::bigint)`;
        const occupied = await db.courses.findMany({
          select: { course_code: true },
        });
        const code =
          dto.course_code === undefined
            ? nextCourseCode(
                generatedCoursePrefix(department.code),
                occupied.map((c) => c.course_code),
              )
            : dto.course_code;
        if (!code.trim() || code.length > 30)
          throw new BadRequestException(
            'course_code must contain 1–30 characters',
          );
        if (
          occupied.some(
            (c) => c.course_code.toLowerCase() === code.toLowerCase(),
          )
        )
          throw new ConflictException({
            code: 'COURSE_CODE_EXISTS',
            message: 'course_code already exists',
          });
        const now = new Date();
        return db.courses.create({
          data: {
            course_code: code,
            course_name: dto.course_name,
            description: dto.description,
            department_id: department.id,
            created_at: now,
            updated_at: now,
          },
          include: { departments: true },
        });
      },
    );
  }

  async update(id: bigint, dto: UpdateCourseDto) {
    await this.findOne(id);

    if (dto.department_id !== undefined) {
      await this.checkDepartment(BigInt(dto.department_id));
    }

    try {
      return await this.prisma.courses.update({
        where: { id },
        data: {
          course_code: dto.course_code,
          course_name: dto.course_name,
          description: dto.description,

          department_id:
            dto.department_id !== undefined
              ? BigInt(dto.department_id)
              : undefined,

          updated_at: new Date(),
        },
        include: {
          departments: true,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('course_code already exists');
      }

      if (e.code === 'P2003') {
        throw new BadRequestException('Invalid department_id');
      }

      throw e;
    }
  }

  async remove(id: bigint) {
    await this.findOne(id);

    try {
      await this.prisma.courses.delete({
        where: { id },
      });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new ConflictException(
          'Course is currently in use and cannot be deleted',
        );
      }

      throw e;
    }
  }

  private async checkDepartment(id: bigint) {
    const department = await this.prisma.departments.findUnique({
      where: { id },
    });

    if (!department) {
      throw new BadRequestException('Department not found');
    }

    if (department.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Cannot assign course to an inactive department',
      );
    }
  }
}
