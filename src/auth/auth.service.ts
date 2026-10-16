import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { backendCapabilities } from './backend-capabilities';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

/*
 * This describes only the part of StudentsService.findOne()
 * that AuthService needs after requesting an academic-year
 * context.
 *
 * It avoids duplicating the placement calculation itself.
 */
type StudentAcademicContext = {
  academic_year: {
    id: bigint;
    name: string;
    start_year: number | null;
    is_active: boolean;
  };

  effective_year_level: number | null;

  academic_record: {
    majors: {
      id: bigint;
      code: string;
      name: string;
      department_id: bigint;
    };
  } | null;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private studentsService: StudentsService,
  ) {}

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();

    const isEmail = identifier.includes('@');

    const user = isEmail
      ? await this.prisma.users.findFirst({
          where: {
            email: identifier.toLowerCase(),
          },
        })
      : await this.findUserByStudentCode(identifier);

    if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid identifier or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    const payload = {
      sub: user.id.toString(),
      email: user.email,
      role: user.role,
      auth_version: user.auth_version,
    };

    return {
      access_token: await this.jwt.signAsync(payload),

      user: {
        capabilities: backendCapabilities,
        id: user.id.toString(),
        email: user.email,
        full_name: user.full_name,
        gender: user.gender,
        role: user.role,
      },
    };
  }

  async getMe(userId: bigint) {
    const user = await this.prisma.users.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        email: true,
        full_name: true,
        gender: true,
        role: true,
        status: true,

        user_departments: {
          select: {
            is_primary: true,

            departments: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },

          orderBy: [
            {
              is_primary: 'desc',
            },
            {
              department_id: 'asc',
            },
          ],
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const capabilities = backendCapabilities;

    /*
     * Staff profile.
     *
     * Department assignments are returned with safe
     * department information only.
     */
    if (user.role !== 'STUDENT') {
      return {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        email: user.email,
        gender: user.gender,

        user_departments: user.user_departments.map((assignment) => ({
          is_primary: assignment.is_primary,

          department: {
            id: assignment.departments.id,

            code: assignment.departments.code,

            name: assignment.departments.name,
          },
        })),

        capabilities,
      };
    }

    /*
     * Student profile.
     */
    const student = await this.prisma.students.findUnique({
      where: {
        user_id: userId,
      },

      select: {
        id: true,
      },
    });

    /*
     * A STUDENT-role user may temporarily have no linked
     * student profile during migration/backfill.
     *
     * Do not invent student information.
     */
    if (!student) {
      return {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        email: user.email,
        gender: user.gender,

        student: null,

        profile_academic_year: null,

        capabilities,
      };
    }

    /*
     * Profile academic-year selection:
     *
     * 1. Use the newest ACTIVE academic year.
     * 2. If none is active, use the newest academic year.
     *
     * start_year is used for chronology.
     *
     * id is only a deterministic secondary ordering field.
     * It is NOT used to calculate a student's year level.
     */
    let profileAcademicYear = await this.prisma.academic_years.findFirst({
      where: {
        is_active: true,
      },

      orderBy: [
        {
          start_year: 'desc',
        },
        {
          id: 'desc',
        },
      ],

      select: {
        id: true,
        name: true,
        start_year: true,
        is_active: true,
      },
    });

    /*
     * No active academic year:
     * fall back to the newest available academic year.
     */
    if (!profileAcademicYear) {
      profileAcademicYear = await this.prisma.academic_years.findFirst({
        orderBy: [
          {
            start_year: 'desc',
          },
          {
            id: 'desc',
          },
        ],

        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      });
    }

    /*
     * There may be no academic-year records yet.
     *
     * We can still return the safe student identity and
     * generation, but effective placement is unavailable.
     */
    if (!profileAcademicYear) {
      const studentProfile = await this.studentsService.findOne(student.id);

      return {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        email: user.email,
        gender: user.gender,

        student: {
          student_code: studentProfile.student_code,

          generation: {
            id: studentProfile.student_generations.id,

            name: studentProfile.student_generations.name,
          },

          effective_placement: {
            major: null,
            year_level: null,
            academic_year: null,
          },
        },

        profile_academic_year: null,

        capabilities,
      };
    }

    /*
     * Reuse StudentsService.
     *
     * This keeps /auth/me consistent with the student
     * administration APIs and avoids implementing a second
     * version of the year-level calculation here.
     */
    const studentProfile = await this.studentsService.findOne(
      student.id,
      profileAcademicYear.id.toString(),
    );

    /*
     * StudentsService.findOne() normally returns
     * academic_context whenever academicYearId is supplied.
     *
     * Keep a defensive fallback rather than inventing
     * placement information.
     */
    if (!('academic_context' in studentProfile)) {
      return {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        email: user.email,
        gender: user.gender,

        student: {
          student_code: studentProfile.student_code,

          generation: {
            id: studentProfile.student_generations.id,

            name: studentProfile.student_generations.name,
          },

          effective_placement: {
            major: null,
            year_level: null,

            academic_year: {
              id: profileAcademicYear.id,
              name: profileAcademicYear.name,
            },
          },
        },

        profile_academic_year: {
          id: profileAcademicYear.id,
          name: profileAcademicYear.name,
        },

        capabilities,
      };
    }

    /*
     * TypeScript knows academic_context exists after the
     * check above, but because findOne() has multiple
     * inferred return shapes, the property is otherwise
     * narrowed to unknown.
     *
     * This assertion describes the already-existing
     * StudentsService response. It does NOT change runtime
     * behavior or placement calculation.
     */
    const academicContext =
      studentProfile.academic_context as StudentAcademicContext;

    /*
     * Major comes only from the explicit academic placement
     * record for the selected academic year.
     *
     * Generation calculation can calculate year level but
     * cannot safely infer a student's major.
     */
    const major = academicContext.academic_record?.majors ?? null;

    return {
      id: user.id,
      full_name: user.full_name,
      role: user.role,
      status: user.status,
      email: user.email,
      gender: user.gender,

      student: {
        academic_context: academicContext,
        student_code: studentProfile.student_code,

        generation: {
          major_id: studentProfile.student_generations.major_id ?? null,
          generation_number:
            studentProfile.student_generations.generation_number ?? null,
          major: studentProfile.student_generations.majors ?? null,
          id: studentProfile.student_generations.id,

          name: studentProfile.student_generations.name,
        },

        effective_placement: {
          major:
            major === null
              ? null
              : {
                  id: major.id,
                  code: major.code,
                  name: major.name,
                },

          year_level: academicContext.effective_year_level,

          academic_year: {
            id: academicContext.academic_year.id,

            name: academicContext.academic_year.name,
          },
        },
      },

      /*
       * Explicitly identify which academic year was used
       * to resolve the student's profile context.
       */
      profile_academic_year: {
        id: profileAcademicYear.id,
        name: profileAcademicYear.name,
      },

      capabilities,
    };
  }

  async changePassword(userId: bigint, dto: ChangePasswordDto) {
    /*
     * bcrypt only safely uses the first 72 UTF-8 bytes.
     *
     * Character validation is also performed by the DTO,
     * but multibyte characters can exceed bcrypt's byte
     * limit while remaining within 72 characters.
     */
    if (
      Buffer.byteLength(dto.current_password, 'utf8') > 72 ||
      Buffer.byteLength(dto.new_password, 'utf8') > 72
    ) {
      throw new BadRequestException('Password must not exceed 72 UTF-8 bytes');
    }

    const user = await this.prisma.users.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        password_hash: true,
        status: true,
        auth_version: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    const currentPasswordMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash,
    );

    if (!currentPasswordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newPasswordMatchesCurrent = await bcrypt.compare(
      dto.new_password,
      user.password_hash,
    );

    if (newPasswordMatchesCurrent) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const newPasswordHash = await bcrypt.hash(dto.new_password, 10);

    /*
     * Atomic compare-and-swap.
     *
     * The update succeeds only if the credential state is
     * still exactly the state that was verified above.
     *
     * Incrementing auth_version revokes all previously
     * issued JWTs for this account.
     */
    const updateResult = await this.prisma.users.updateMany({
      where: {
        id: user.id,
        status: 'ACTIVE',
        password_hash: user.password_hash,
        auth_version: user.auth_version,
      },

      data: {
        password_hash: newPasswordHash,

        auth_version: {
          increment: 1,
        },
      },
    });

    if (updateResult.count !== 1) {
      throw new UnauthorizedException(
        'Credentials changed. Please sign in again.',
      );
    }

    return {
      message: 'Password changed successfully. Please sign in again.',
    };
  }

  private async findUserByStudentCode(studentCode: string) {
    const student = await this.prisma.students.findUnique({
      where: {
        student_code: studentCode.toLowerCase(),
      },

      select: {
        users: true,
      },
    });

    return student?.users ?? null;
  }
}
