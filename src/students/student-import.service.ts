import { assertDepartmentScope } from '../common/utils/department-scope.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { normalizeClassGroup } from '../common/utils/class-group.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportStudentRowDto,
  ImportStudentsDto,
} from './dto/import-students.dto';

import { generationNumber } from '../student-generations/generation-identity.util';
import { StudentGenerationsService } from '../student-generations/student-generations.service';
const BCRYPT_ROUNDS = 10;
const DEFAULT_INITIAL_PASSWORD = 'password@1235';
const MAX_BCRYPT_PASSWORD_BYTES = 72;

type ImportRowStatus = 'CREATED' | 'SKIPPED' | 'FAILED';

type ImportRowResult = {
  row: number;
  student_code: string;
  status: ImportRowStatus;
  message: string;
  student_id?: string;
};

type ResolvedMajor = {
  id: bigint;
  code: string;
  name: string;
};

@Injectable()
export class StudentImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importStudents(dto: ImportStudentsDto, actorId?: bigint) {
    const major = dto.major_id
      ? await this.prisma.majors.findUnique({
          where: { id: BigInt(dto.major_id) },
          include: { departments: true },
        })
      : null;
    if (dto.major_id && (!major || major.departments.status !== 'ACTIVE'))
      throw new BadRequestException('Choose a major in an active department');
    if (actorId !== undefined && major)
      await assertDepartmentScope(this.prisma, actorId, major.department_id);
    return this.importInTransaction(dto);
  }
  private async importInTransaction(dto: ImportStudentsDto) {
    if (!dto.major_id)
      throw new BadRequestException(
        'major_id is required; submit separate major/cohort batches',
      );
    const number = generationNumber(dto.generation_number ?? dto.generation);
    const generationName = `Gen ${number}`;

    if (!generationName) {
      throw new BadRequestException('Generation is required');
    }

    const password = this.resolveInitialPassword(dto.initial_password);

    this.validateInitialPassword(password);

    const academicYearId = BigInt(dto.academic_year_id);

    /*
     * Validate the initial academic year before creating
     * a generation or any students.
     */
    const academicYear = await this.prisma.academic_years.findUnique({
      where: {
        id: academicYearId,
      },
      select: {
        id: true,
        name: true,
        start_year: true,
      },
    });

    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    /*
     * Normalize all student codes first so duplicate rows
     * are rejected before any database writes happen.
     */
    const normalizedRows = dto.students.map((row, index) => ({
      rowNumber: index + 1,
      data: row,
      studentCode: this.normalizeStudentCode(row.student_code),
    }));

    const seenStudentCodes = new Set<string>();
    const duplicateStudentCodes = new Set<string>();

    for (const row of normalizedRows) {
      if (!row.studentCode) {
        throw new BadRequestException(
          `Student code is required at row ${row.rowNumber}`,
        );
      }

      if (seenStudentCodes.has(row.studentCode)) {
        duplicateStudentCodes.add(row.studentCode);
      } else {
        seenStudentCodes.add(row.studentCode);
      }
    }

    if (duplicateStudentCodes.size > 0) {
      throw new BadRequestException(
        `Duplicate student codes in import: ${Array.from(
          duplicateStudentCodes,
        ).join(', ')}`,
      );
    }

    /*
     * Resolve or create the shared generation only after
     * request-wide validation succeeds.
     */

    /*
     * Resolve all unique major values before student writes.
     *
     * Invalid/ambiguous majors are remembered and reported
     * as FAILED for the affected rows. They are never guessed
     * or silently created.
     */
    const majorInputs = Array.from(
      new Set(
        normalizedRows.map((row) => this.normalizeLookupValue(row.data.major)),
      ),
    );

    const majorResolution = new Map<
      string,
      | {
          major: ResolvedMajor;
          error: null;
        }
      | {
          major: null;
          error: string;
        }
    >();

    for (const majorInput of majorInputs) {
      try {
        const major = await this.resolveMajor(majorInput);

        majorResolution.set(majorInput, {
          major,
          error: null,
        });
      } catch (error) {
        majorResolution.set(majorInput, {
          major: null,
          error: this.getErrorMessage(error),
        });
      }
    }

    for (const resolution of majorResolution.values()) {
      if (
        resolution.error ||
        !resolution.major ||
        resolution.major.id !== BigInt(dto.major_id)
      )
        throw new BadRequestException(
          resolution.error ||
            'Every student row must belong to the request major',
        );
    }
    const generation = await this.resolveGeneration(generationName, dto);

    /*
     * Fetch existing student codes in one query.
     *
     * Existing students must be skipped without changing
     * their profile, password, status, generation, or
     * academic placement.
     */
    const existingStudents = await this.prisma.students.findMany({
      where: {
        student_code: {
          in: normalizedRows.map((row) => row.studentCode),
        },
      },
      select: {
        id: true,
        student_code: true,
      },
    });

    const existingStudentCodes = new Set(
      existingStudents.map((student) =>
        this.normalizeStudentCode(student.student_code),
      ),
    );

    const results: ImportRowResult[] = [];

    /*
     * Process each row independently.
     *
     * Each new student's user/profile/placement writes are
     * atomic, while one failed row does not roll back other
     * successfully created students.
     */
    for (const row of normalizedRows) {
      const studentCode = row.studentCode;

      if (existingStudentCodes.has(studentCode)) {
        results.push({
          row: row.rowNumber,
          student_code: studentCode,
          status: 'SKIPPED',
          message: 'Student code already exists',
        });

        continue;
      }

      const majorKey = this.normalizeLookupValue(row.data.major);

      const resolvedMajor = majorResolution.get(majorKey);

      if (!resolvedMajor || resolvedMajor.major === null) {
        results.push({
          row: row.rowNumber,
          student_code: studentCode,
          status: 'FAILED',
          message: resolvedMajor?.error ?? 'Major could not be resolved',
        });

        continue;
      }

      try {
        /*
         * Hash independently for every newly created account.
         * bcrypt therefore generates a separate salt/hash for
         * each student even though the group password is shared.
         */
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const student = await this.createImportedStudent({
          row: row.data,
          studentCode,
          passwordHash,
          generationId: generation.id,
          academicYearId,
          yearLevel: dto.year_level,
          majorId: resolvedMajor.major.id,
          classGroup: normalizeClassGroup(dto.class_group),
        });

        results.push({
          row: row.rowNumber,
          student_code: studentCode,
          status: 'CREATED',
          message: 'Student created successfully',
          student_id: student.id.toString(),
        });

        /*
         * Protect against a repeated code later in the same
         * processing path even though request duplicates were
         * already rejected above.
         */
        existingStudentCodes.add(studentCode);
      } catch (error) {
        if (this.isStudentCodeConflict(error)) {
          /*
           * A concurrent request may have created the same
           * student after the initial existence check.
           *
           * Treat it as SKIPPED so retries remain safe and no
           * existing account is modified.
           */
          results.push({
            row: row.rowNumber,
            student_code: studentCode,
            status: 'SKIPPED',
            message: 'Student code already exists',
          });

          existingStudentCodes.add(studentCode);

          continue;
        }

        results.push({
          row: row.rowNumber,
          student_code: studentCode,
          status: 'FAILED',
          message: this.getErrorMessage(error),
        });
      }
    }

    const created = results.filter(
      (result) => result.status === 'CREATED',
    ).length;

    const skipped = results.filter(
      (result) => result.status === 'SKIPPED',
    ).length;

    const failed = results.filter(
      (result) => result.status === 'FAILED',
    ).length;

    return {
      generation: {
        id: generation.id.toString(),
        name: generation.name,
        major_id: generation.major_id?.toString() ?? null,
        generation_number: generation.generation_number,
        entry_academic_year_id: generation.entry_academic_year_id.toString(),
        starting_year_level: generation.starting_year_level,
      },

      academic_year: {
        id: academicYear.id.toString(),
        name: academicYear.name,
        start_year: academicYear.start_year,
      },

      summary: {
        total: results.length,
        created,
        skipped,
        failed,
      },

      results,
    };
  }

  private normalizeStudentCode(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeGenerationName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeLookupValue(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private resolveInitialPassword(value?: string): string {
    if (value === undefined || value.trim() === '') {
      return DEFAULT_INITIAL_PASSWORD;
    }

    return value;
  }

  private validateInitialPassword(password: string) {
    if (password.length < 6 || password.length > 72) {
      throw new BadRequestException(
        'Initial password must be between 6 and 72 characters',
      );
    }

    if (Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
      throw new BadRequestException(
        'Initial password must not exceed 72 UTF-8 bytes',
      );
    }
  }

  private async resolveGeneration(
    normalizedName: string,
    dto: ImportStudentsDto,
  ) {
    const majorId = BigInt(dto.major_id);
    const number = generationNumber(dto.generation_number ?? normalizedName);
    const existing = await this.prisma.student_generations.findUnique({
      where: {
        major_id_generation_number: {
          major_id: majorId,
          generation_number: number,
        },
      },
    });
    if (existing) return existing;
    if (!dto.entry_academic_year_id)
      throw new BadRequestException(
        'entry_academic_year_id is required for a new major cohort',
      );
    return new StudentGenerationsService(this.prisma).create({
      major_id: dto.major_id,
      generation_number: number,
      entry_academic_year_id: dto.entry_academic_year_id,
      starting_year_level: dto.starting_year_level,
    });
  }

  private async resolveMajor(normalizedInput: string): Promise<ResolvedMajor> {
    if (!normalizedInput) {
      throw new BadRequestException('Major is required');
    }

    /*
     * Resolve by either code or exact name.
     * Case-insensitive matching supports spreadsheet values
     * such as "AMS", "ams", or the full major name.
     */
    const matches = await this.prisma.majors.findMany({
      where: {
        OR: [
          {
            code: {
              equals: normalizedInput,
              mode: 'insensitive',
            },
          },
          {
            name: {
              equals: normalizedInput,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    /*
     * A major could theoretically match one row by code and
     * another by name. Deduplicate by database ID before
     * deciding whether the input is ambiguous.
     */
    const uniqueMatches = Array.from(
      new Map(matches.map((major) => [major.id.toString(), major])).values(),
    );

    if (uniqueMatches.length === 0) {
      throw new NotFoundException(`Major "${normalizedInput}" was not found`);
    }

    if (uniqueMatches.length > 1) {
      throw new ConflictException(`Major "${normalizedInput}" is ambiguous`);
    }

    return uniqueMatches[0];
  }

  private async createImportedStudent(params: {
    row: ImportStudentRowDto;
    studentCode: string;
    passwordHash: string;
    generationId: bigint;
    academicYearId: bigint;
    yearLevel: number;
    majorId: bigint;
    classGroup: string | null;
  }) {
    const fullName = params.row.full_name?.trim() || params.studentCode;

    const notes = params.row.notes?.trim() || null;

    return this.prisma.$transaction(
      async (tx) => {
        /*
         * 1. Authentication account.
         *
         * Import does not require or generate an email.
         */
        const user = await tx.users.create({
          data: {
            email: null,
            password_hash: params.passwordHash,
            full_name: fullName,
            gender: params.row.gender ?? null,
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
        const student = await tx.students.create({
          data: {
            user_id: user.id,
            student_code: params.studentCode,
            generation_id: params.generationId,
            notes,
          },
          select: {
            id: true,
          },
        });

        /*
         * 3. Initial academic placement.
         *
         * These writes are in the same transaction. A failure
         * here rolls back both the user and student profile.
         */
        await tx.student_academic_records.create({
          data: {
            student_id: student.id,
            academic_year_id: params.academicYearId,
            year_level: params.yearLevel,
            major_id: params.majorId,
            class_group: params.classGroup,
          },
        });

        return student;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private isStudentCodeConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.map(String)
      : [];

    return target.some((field) => field.includes('student_code'));
  }

  private getErrorMessage(error: unknown): string {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof ConflictException
    ) {
      const response = error.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const message = (
          response as {
            message: string | string[];
          }
        ).message;

        return Array.isArray(message) ? message.join(', ') : message;
      }
    }

    /*
     * Do not expose raw database/internal error details to
     * the frontend.
     */
    return 'Student could not be imported';
  }
}
