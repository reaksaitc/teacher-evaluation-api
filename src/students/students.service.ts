import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { resolveStudentPlacement } from '../common/utils/student-placement.util';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  normalizeClassGroup,
  normalizeClassGroups,
} from '../common/utils/class-group.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentQueryDto } from './dto/student-query.dto';
import { StudentEvaluationProgressService } from './student-evaluation-progress.service';

import { assertCohortMajor } from '../student-generations/generation-identity.util';
const BCRYPT_ROUNDS = 10;

const studentSelect = {
  id: true,
  user_id: true,
  student_code: true,
  generation_id: true,
  notes: true,
  created_at: true,
  updated_at: true,

  users: {
    select: {
      id: true,
      email: true,
      full_name: true,
      gender: true,
      role: true,
      status: true,
      created_at: true,
      updated_at: true,
    },
  },

  student_generations: {
    select: {
      major_id: true,
      generation_number: true,
      majors: {
        select: { id: true, code: true, name: true, department_id: true },
      },
      id: true,
      name: true,
      entry_academic_year_id: true,
      starting_year_level: true,

      entry_academic_year: {
        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      },
    },
  },

  student_academic_records: {
    select: {
      id: true,
      academic_year_id: true,
      year_level: true,
      major_id: true,
      class_group: true,
      progression_action: true,
      created_at: true,
      updated_at: true,

      academic_years: {
        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      },

      majors: {
        select: {
          id: true,
          code: true,
          name: true,
          department_id: true,
        },
      },
    },

    orderBy: {
      academic_year_id: 'desc' as const,
    },
  },
} satisfies Prisma.studentsSelect;

type StudentWithRelations = Prisma.studentsGetPayload<{
  select: typeof studentSelect;
}>;

type AcademicYearContext = {
  id: bigint;
  name: string;
  start_year: number | null;
  is_active: boolean;
};

function normalizeStudentCode(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentEvaluationProgressService: StudentEvaluationProgressService,
  ) {}

  async findAll(query: StudentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const generationId =
      query.generation_id !== undefined
        ? BigInt(query.generation_id)
        : undefined;

    const academicYearId =
      query.academic_year_id !== undefined
        ? BigInt(query.academic_year_id)
        : undefined;

    const majorId =
      query.major_id !== undefined ? BigInt(query.major_id) : undefined;

    /*
     * year_level, major_id and class_group describe an
     * academic placement. They require an academic year.
     */
    const hasPlacementFilter =
      query.year_level !== undefined ||
      majorId !== undefined ||
      query.class_group !== undefined;

    if (hasPlacementFilter && academicYearId === undefined) {
      throw new BadRequestException(
        'academic_year_id is required when filtering by year_level, major_id, or class_group',
      );
    }

    let selectedAcademicYear: AcademicYearContext | null = null;

    if (academicYearId !== undefined) {
      selectedAcademicYear = await this.prisma.academic_years.findUnique({
        where: {
          id: academicYearId,
        },
        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      });

      if (!selectedAcademicYear) {
        throw new NotFoundException('Academic year not found');
      }
    }

    if (generationId !== undefined) {
      const generation = await this.prisma.student_generations.findUnique({
        where: {
          id: generationId,
        },
        select: {
          id: true,
        },
      });

      if (!generation) {
        throw new NotFoundException('Student generation not found');
      }
    }

    if (majorId !== undefined) {
      const major = await this.prisma.majors.findUnique({
        where: {
          id: majorId,
        },
        select: {
          id: true,
        },
      });

      if (!major) {
        throw new NotFoundException('Major not found');
      }
    }

    const search = query.search?.trim();

    const where: Prisma.studentsWhereInput = {
      ...(generationId !== undefined && {
        generation_id: generationId,
      }),

      ...(query.status !== undefined && {
        users: {
          is: {
            status: query.status,
          },
        },
      }),

      ...(search && {
        OR: [
          {
            student_code: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            users: {
              is: {
                full_name: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      }),
    };

    const students = await this.prisma.students.findMany({
      where,
      select: studentSelect,
      orderBy: {
        student_code: 'asc',
      },
    });

    /*
     * Do not combine contextual and non-contextual students
     * into one union. Keeping these branches separate lets
     * TypeScript know academic_context exists below.
     */
    let filteredStudents;

    if (selectedAcademicYear !== null) {
      const studentsWithContext = students.map((student) =>
        this.attachAcademicContext(student, selectedAcademicYear),
      );

      filteredStudents = studentsWithContext.filter((student) => {
        const context = student.academic_context;

        /*
         * Effective year level may come from the explicit
         * academic record or generation calculation.
         */
        if (
          query.year_level !== undefined &&
          context.effective_year_level !== query.year_level
        ) {
          return false;
        }

        /*
         * Major must come from the explicit placement
         * record for the selected academic year.
         */
        if (majorId !== undefined) {
          if (context.placement.major_id !== majorId) {
            return false;
          }
        }

        /*
         * Class/group also belongs to the explicit
         * historical placement for that academic year.
         */
        if (query.class_group !== undefined) {
          const expectedClassGroup = query.class_group.trim().toLowerCase();

          const actualClassGroup =
            context.academic_record?.class_group?.trim().toLowerCase() ?? null;

          if (actualClassGroup !== expectedClassGroup) {
            return false;
          }
        }

        return true;
      });
    } else {
      filteredStudents = students;
    }

    /*
     * Pagination is applied after effective-placement
     * filtering so total reflects the actual result set.
     */
    const total = filteredStudents.length;

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const start = (page - 1) * limit;

    const data = filteredStudents.slice(start, start + limit);

    /*
     * Progress is calculated only for students on the
     * current page. The progress service performs one
     * batched participant query for all user IDs.
     *
     * The same server-time snapshot is used for every
     * student on this page.
     */
    const now = new Date();

    const progressByUserId =
      await this.studentEvaluationProgressService.getProgressForUsers(
        data.map((student) => student.user_id),
        now,
      );

    const dataWithProgress = data.map((student) => ({
      ...student,
      evaluation_progress: progressByUserId.get(student.user_id)!,
    }));

    return {
      data: dataWithProgress,

      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },

      filters: {
        search: search || null,

        generation_id: generationId?.toString() ?? null,

        academic_year_id: academicYearId?.toString() ?? null,

        year_level: query.year_level ?? null,

        major_id: majorId?.toString() ?? null,

        class_group: query.class_group?.trim() || null,

        status: query.status ?? null,
      },
    };
  }

  async selectStudentsForEnrollment(
    filters: {
      generation_id?: string;
      academic_year_id: string;
      year_level?: number;
      major_id?: string;
      class_groups?: string[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    const generationId =
      filters.generation_id !== undefined
        ? BigInt(filters.generation_id)
        : undefined;

    const academicYearId = BigInt(filters.academic_year_id);

    const majorId =
      filters.major_id !== undefined ? BigInt(filters.major_id) : undefined;

    /*
     * Enrollment group resolution always uses an academic
     * year so that effective year level, major and class
     * placement are evaluated in the correct context.
     */
    const selectedAcademicYear = await prisma.academic_years.findUnique({
      where: {
        id: academicYearId,
      },
      select: {
        id: true,
        name: true,
        start_year: true,
        is_active: true,
      },
    });

    if (!selectedAcademicYear) {
      throw new NotFoundException('Academic year not found');
    }

    if (generationId !== undefined) {
      const generation = await prisma.student_generations.findUnique({
        where: {
          id: generationId,
        },
        select: {
          id: true,
          major_id: true,
        },
      });
      if (
        generation?.major_id != null &&
        majorId !== undefined &&
        generation.major_id !== majorId
      )
        throw new BadRequestException(
          'Generation does not belong to selected major',
        );

      if (!generation) {
        throw new NotFoundException('Student generation not found');
      }
    }

    if (majorId !== undefined) {
      const major = await prisma.majors.findUnique({
        where: {
          id: majorId,
        },
        select: {
          id: true,
        },
      });

      if (!major) {
        throw new NotFoundException('Major not found');
      }
    }

    /*
     * Only ACTIVE student accounts can be selected for a
     * new course-offering enrollment.
     *
     * Generation is applied directly at database level.
     * Academic placement filters are applied after the
     * shared academic-context calculation below.
     */
    const students = await prisma.students.findMany({
      where: {
        ...(generationId !== undefined && {
          generation_id: generationId,
        }),

        users: {
          is: {
            role: 'STUDENT',
            status: 'ACTIVE',
          },
        },
      },

      select: studentSelect,

      orderBy: {
        student_code: 'asc',
      },
    });

    /*
     * Reuse the same academic-context logic used by the
     * existing Students API. This prevents Enrollment from
     * having a second implementation of effective year.
     */
    const studentsWithContext = students.map((student) =>
      this.attachAcademicContext(student, selectedAcademicYear),
    );

    return studentsWithContext.filter((student) => {
      const context = student.academic_context;

      if (!context.placement_eligible) return false;

      /*
       * Effective year may come from an explicit academic
       * record or from the generation calculation.
       */
      if (
        filters.year_level !== undefined &&
        context.effective_year_level !== filters.year_level
      ) {
        return false;
      }

      /*
       * Major is an explicit academic placement value.
       */
      if (majorId !== undefined) {
        if (context.placement.major_id !== majorId) {
          return false;
        }
      }

      /*
       * Class/group is also an explicit academic
       * placement value for the selected academic year.
       */
      if (filters.class_groups !== undefined) {
        const expectedClassGroups = normalizeClassGroups(filters.class_groups);

        const actualClassGroup = normalizeClassGroup(
          context.academic_record?.class_group,
        );

        if (
          actualClassGroup === null ||
          !expectedClassGroups.includes(actualClassGroup)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  async getGroupOptions(
    academicYearId: bigint,
    generationId: bigint,
    majorId: bigint,
  ) {
    const records = await this.prisma.student_academic_records.findMany({
      where: {
        academic_year_id: academicYearId,
        major_id: majorId,

        students: {
          generation_id: generationId,
        },

        class_group: {
          not: null,
        },
      },

      select: {
        class_group: true,
      },
    });

    const groups = [
      ...new Set(
        records
          .map((record) => normalizeClassGroup(record.class_group))
          .filter((group): group is string => group !== null),
      ),
    ].sort((a, b) => a.localeCompare(b));

    return {
      academic_year_id: academicYearId.toString(),

      generation: await this.prisma.student_generations.findUnique({
        where: { id: generationId },
        select: {
          id: true,
          name: true,
          major_id: true,
          generation_number: true,
          majors: { select: { id: true, code: true, name: true } },
        },
      }),
      generation_id: generationId.toString(),

      major_id: majorId.toString(),

      groups,

      total: groups.length,
    };
  }

  async bulkUpdateClassGroup(
    academicYearId: bigint,
    studentIds: bigint[],
    classGroupValue: string,
  ) {
    return inSerializableTransaction(this.prisma, (db) =>
      new StudentsService(
        db,
        this.studentEvaluationProgressService,
      ).bulkUpdateClassGroupInTransaction(
        academicYearId,
        studentIds,
        classGroupValue,
      ),
    );
  }

  private async bulkUpdateClassGroupInTransaction(
    academicYearId: bigint,
    studentIds: bigint[],
    classGroupValue: string,
  ) {
    const classGroup = normalizeClassGroup(classGroupValue);

    if (classGroup === null) {
      throw new BadRequestException('class_group must not be empty');
    }

    const uniqueStudentIds = [
      ...new Set(studentIds.map((id) => id.toString())),
    ].map((id) => BigInt(id));

    return this.prisma.$transaction(async (tx) => {
      /*
       * Only existing placements may be changed. Missing
       * records abort the transaction before any updates.
       */
      const records = await tx.student_academic_records.findMany({
        where: {
          academic_year_id: academicYearId,

          student_id: {
            in: uniqueStudentIds,
          },
        },

        select: {
          id: true,
          student_id: true,
          academic_year_id: true,
          year_level: true,
          major_id: true,
          class_group: true,
        },
      });

      const foundStudentIds = new Set(
        records.map((record) => record.student_id.toString()),
      );

      const missingStudentIds = uniqueStudentIds
        .filter((studentId) => !foundStudentIds.has(studentId.toString()))
        .map((studentId) => studentId.toString());

      if (missingStudentIds.length > 0) {
        throw new BadRequestException({
          message:
            'Some students do not have an existing placement for the selected academic year',
          missing_student_ids: missingStudentIds,
        });
      }

      await tx.student_academic_records.updateMany({
        where: {
          academic_year_id: academicYearId,

          student_id: {
            in: uniqueStudentIds,
          },
        },

        data: {
          class_group: classGroup,
        },
      });

      return {
        academic_year_id: academicYearId.toString(),

        class_group: classGroup,

        updated_student_ids: uniqueStudentIds.map((studentId) =>
          studentId.toString(),
        ),

        updated_count: uniqueStudentIds.length,

        complete: true,
      };
    });
  }

  async findOne(id: bigint, academicYearId?: string) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: studentSelect,
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    /*
     * Student evaluation progress uses users.id because
     * evaluation_participants.student_id references users.id.
     */
    const now = new Date();

    const evaluationProgress =
      await this.studentEvaluationProgressService.getProgressForUser(
        student.user_id,
        now,
      );

    /*
     * Without an academic-year query, preserve the
     * original student response and add evaluation progress.
     */
    if (academicYearId === undefined) {
      return {
        ...student,
        evaluation_progress: evaluationProgress,
      };
    }

    if (!/^[1-9]\d*$/.test(academicYearId)) {
      throw new BadRequestException(
        'academic_year_id must be a positive integer',
      );
    }

    const selectedAcademicYearId = BigInt(academicYearId);

    const selectedAcademicYear = await this.prisma.academic_years.findUnique({
      where: {
        id: selectedAcademicYearId,
      },
      select: {
        id: true,
        name: true,
        start_year: true,
        is_active: true,
      },
    });

    if (!selectedAcademicYear) {
      throw new NotFoundException('Academic year not found');
    }

    return {
      ...this.attachAcademicContext(student, selectedAcademicYear),

      evaluation_progress: evaluationProgress,
    };
  }

  private attachAcademicContext(
    student: StudentWithRelations,
    selectedAcademicYear: AcademicYearContext,
  ) {
    return {
      ...student,
      academic_context: {
        academic_year: selectedAcademicYear,
        generation_entry_academic_year:
          student.student_generations.entry_academic_year,
        starting_year_level: student.student_generations.starting_year_level,
        ...resolveStudentPlacement(
          student.student_generations,
          student.student_academic_records,
          selectedAcademicYear,
        ),
      },
    };
  }

  private async ensureGenerationExists(generationId: bigint, majorId?: bigint) {
    const generation = await this.prisma.student_generations.findUnique({
      where: {
        id: generationId,
      },
      select: {
        id: true,
        major_id: true,
      },
    });

    if (!generation) {
      throw new NotFoundException('Student generation not found');
    }
    if (majorId !== undefined) assertCohortMajor(generation, majorId);
    return generation;
  }

  async create(dto: CreateStudentDto, actorId?: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) =>
        new StudentsService(
          db,
          this.studentEvaluationProgressService,
        ).createInTransaction(dto, actorId),
      (error: any) => {
        this.handlePrismaError(error);
      },
    );
  }

  private async createInTransaction(dto: CreateStudentDto, actorId?: bigint) {
    const studentCode = normalizeStudentCode(dto.student_code);

    const email = dto.email === undefined ? null : normalizeEmail(dto.email);

    const generationId = BigInt(dto.generation_id);

    const academicYearId = BigInt(dto.academic_year_id);

    const majorId = BigInt(dto.major_id);
    if (actorId !== undefined) {
      const context = await this.prisma.majors.findUnique({
        where: { id: majorId },
        include: { departments: true },
      });
      if (!context || context.departments.status !== 'ACTIVE')
        throw new BadRequestException('Choose a major in an active department');
      await assertDepartmentScope(this.prisma, actorId, context.department_id);
    }

    /*
     * Validate all references before writing anything.
     */
    await this.ensureGenerationExists(generationId, majorId);

    const [academicYear, major] = await Promise.all([
      this.prisma.academic_years.findUnique({
        where: {
          id: academicYearId,
        },
        select: {
          id: true,
        },
      }),

      this.prisma.majors.findUnique({
        where: {
          id: majorId,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    if (!major) {
      throw new NotFoundException('Major not found');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const classGroup = dto.class_group?.trim() || null;

    try {
      const student = await this.prisma.$transaction(async (tx) => {
        /*
         * 1. Authentication account.
         */
        const user = await tx.users.create({
          data: {
            email,
            password_hash: passwordHash,
            full_name: dto.full_name.trim(),
            gender: dto.gender ?? null,
            role: 'STUDENT',
            status: 'ACTIVE',
            created_at: new Date(),
            updated_at: new Date(),
          },
          select: {
            id: true,
          },
        });

        /*
         * 2. Student profile.
         */
        const createdStudent = await tx.students.create({
          data: {
            user_id: user.id,
            student_code: studentCode,
            generation_id: generationId,
            notes: dto.notes?.trim() || null,
          },
          select: {
            id: true,
          },
        });

        /*
         * 3. Initial academic placement.
         *
         * All three writes are inside the same
         * transaction. If this fails, the user and
         * student profile are rolled back too.
         */
        await tx.student_academic_records.create({
          data: {
            student_id: createdStudent.id,
            academic_year_id: academicYearId,
            year_level: dto.year_level,
            major_id: majorId,
            class_group: classGroup,
          },
        });

        /*
         * 4. Return the complete student.
         */
        return tx.students.findUniqueOrThrow({
          where: {
            id: createdStudent.id,
          },
          select: studentSelect,
        });
      });

      return student;
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: bigint, dto: UpdateStudentDto) {
    return inSerializableTransaction(
      this.prisma,
      (db) =>
        new StudentsService(
          db,
          this.studentEvaluationProgressService,
        ).updateInTransaction(id, dto),
      (error: any) => {
        this.handlePrismaError(error);
      },
    );
  }

  private async updateInTransaction(id: bigint, dto: UpdateStudentDto) {
    const existingStudent = await this.prisma.students.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
        generation_id: true,
      },
    });

    if (!existingStudent) {
      throw new NotFoundException('Student not found');
    }

    let generationId: bigint | undefined;

    if (dto.generation_id !== undefined) {
      generationId = BigInt(dto.generation_id);

      if (generationId !== existingStudent.generation_id)
        throw new ConflictException(
          'Cohort reassignment requires an approved migration policy',
        );
    }

    const normalizedStudentCode =
      dto.student_code !== undefined
        ? normalizeStudentCode(dto.student_code)
        : undefined;

    const normalizedEmail =
      dto.email === undefined
        ? undefined
        : dto.email === null
          ? null
          : normalizeEmail(dto.email);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.users.update({
          where: {
            id: existingStudent.user_id,
          },
          data: {
            ...(dto.full_name !== undefined && {
              full_name: dto.full_name.trim(),
            }),

            ...(dto.email !== undefined && {
              email: normalizedEmail,
            }),

            ...(dto.gender !== undefined && {
              gender: dto.gender,
            }),

            ...(dto.status !== undefined && {
              status: dto.status,
            }),

            updated_at: new Date(),
          },
        });

        await tx.students.update({
          where: {
            id,
          },
          data: {
            ...(normalizedStudentCode !== undefined && {
              student_code: normalizedStudentCode,
            }),

            ...(generationId !== undefined && {
              generation_id: generationId,
            }),

            ...(dto.notes !== undefined && {
              notes: dto.notes === null ? null : dto.notes.trim() || null,
            }),
          },
        });

        return tx.students.findUniqueOrThrow({
          where: {
            id,
          },
          select: studentSelect,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) =>
        new StudentsService(
          db,
          this.studentEvaluationProgressService,
        ).removeInTransaction(id),
      (error: any) => {
        this.handlePrismaError(error);
      },
    );
  }

  private async removeInTransaction(id: bigint) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
        student_code: true,

        _count: {
          select: {
            student_academic_records: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const [enrollmentCount, participantCount] = await Promise.all([
      this.prisma.enrollments.count({
        where: {
          student_id: student.user_id,
        },
      }),

      this.prisma.evaluation_participants.count({
        where: {
          student_id: student.user_id,
        },
      }),
    ]);

    const hasHistoricalReferences =
      student._count.student_academic_records > 0 ||
      enrollmentCount > 0 ||
      participantCount > 0;

    if (hasHistoricalReferences) {
      throw new ConflictException(
        'Student has historical records and cannot be permanently deleted. Disable the student account instead.',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.students.delete({
          where: {
            id,
          },
        });

        await tx.users.delete({
          where: {
            id: student.user_id,
          },
        });
      });

      return {
        message: 'Student deleted successfully',
      };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map(String)
          : [];

        if (target.some((field) => field.includes('student_code'))) {
          throw new ConflictException('Student code already exists');
        }

        if (target.some((field) => field.includes('email'))) {
          throw new ConflictException('Email is already in use');
        }

        throw new ConflictException('Student data already exists');
      }

      if (error.code === 'P2003') {
        throw new ConflictException(
          'Student cannot be changed or deleted because related records exist',
        );
      }
    }

    throw error;
  }
}
