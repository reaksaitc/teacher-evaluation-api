import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import { attachTargetLabelViews } from '../common/utils/target-labels.util';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { class_type, Prisma } from '@prisma/client';

import { normalizeClassGroups } from '../common/utils/class-group.util';
import { requireCurriculumApproval } from './curriculum-approval.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseOfferingDto } from './dto/create-course-offering.dto';
import { CourseOfferingGroupScopeDto } from './dto/course-offering-group-scope.dto';
import { LecturerCourseOfferingsQueryDto } from './dto/lecturer-course-offerings-query.dto';
import { UpdateCourseOfferingDto } from './dto/update-course-offering.dto';

const groupScopeInclude = {
  curriculum_revision: true,
  academic_years: {
    select: {
      id: true,
      name: true,
      start_year: true,
      is_active: true,
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
    },
  },
  majors: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
} satisfies Prisma.course_offering_group_scopesInclude;

const evaluationGroupTargetInclude = {
  academic_years: {
    select: {
      id: true,
      name: true,
      start_year: true,
      is_active: true,
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
    },
  },

  majors: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
} satisfies Prisma.evaluation_group_targetsInclude;

// Related rows returned with each offering.
// section_code remains a display label and is not used
// as proof of student class-group assignment.
const offeringInclude = {
  _count: { select: { enrollments: true } },
  courses: true,
  semesters: {
    include: {
      academic_years: true,
    },
  },
  users: {
    select: {
      id: true,
      full_name: true,
      email: true,
    },
  },
  group_scopes: {
    include: groupScopeInclude,
    orderBy: [
      {
        generation_id: 'asc' as const,
      },
      {
        major_id: 'asc' as const,
      },
      {
        year_level: 'asc' as const,
      },
      {
        class_group: 'asc' as const,
      },
    ],
  },
} satisfies Prisma.course_offeringsInclude;

const DUPLICATE_MESSAGE = 'This course offering already exists';

type PrismaWriteClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CourseOfferingsService {
  constructor(private prisma: PrismaService) {}

  private async readerScope(
    actorId: bigint,
  ): Promise<Prisma.course_offeringsWhereInput> {
    const actor = await this.prisma.users.findUnique({
      where: { id: actorId },
      select: { role: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE')
      throw new ForbiddenException('Active account required');
    if (actor.role === 'ADMIN') {
      const departments = await assertDepartmentScope(this.prisma, actorId);
      return departments.length
        ? { courses: { department_id: { in: departments } } }
        : {};
    }
    if (actor.role === 'LECTURER') return { lecturer_id: actorId };
    return {
      OR: [
        { enrollments: { some: { student_id: actorId } } },
        {
          evaluations: {
            some: {
              evaluation_participants: { some: { student_id: actorId } },
            },
          },
        },
      ],
    };
  }
  async findAll(actorId?: bigint) {
    const where = actorId === undefined ? {} : await this.readerScope(actorId);
    return this.prisma.course_offerings.findMany({
      ...(Object.keys(where).length ? { where } : {}),
      include: offeringInclude,
      orderBy: { id: 'asc' },
    });
  }

  async findOwnedByLecturer(
    lecturerId: bigint,
    query: LecturerCourseOfferingsQueryDto,
  ) {
    const search = query.search?.trim();

    const where: Prisma.course_offeringsWhereInput = {
      lecturer_id: lecturerId,

      semester_id:
        query.semester_id !== undefined ? BigInt(query.semester_id) : undefined,

      year_level: query.year_level,

      class_type: query.class_type,

      semesters:
        query.academic_year_id !== undefined
          ? {
              academic_year_id: BigInt(query.academic_year_id),
            }
          : undefined,

      OR:
        search && search.length > 0
          ? [
              {
                courses: {
                  is: {
                    course_code: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                courses: {
                  is: {
                    course_name: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                section_code: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
    };

    const offerings = await this.prisma.course_offerings.findMany({
      where,

      include: {
        courses: true,

        semesters: {
          include: {
            academic_years: true,
          },
        },

        group_scopes: {
          include: groupScopeInclude,
          orderBy: [
            {
              generation_id: 'asc',
            },
            {
              major_id: 'asc',
            },
            {
              year_level: 'asc',
            },
            {
              class_group: 'asc',
            },
          ],
        },

        evaluations: {
          select: {
            id: true,
            status: true,
            start_at: true,
            end_at: true,
            survey_version_id: true,

            group_targets: {
              include: evaluationGroupTargetInclude,

              orderBy: [
                {
                  generation_id: 'asc',
                },
                {
                  major_id: 'asc',
                },
                {
                  year_level: 'asc',
                },
                {
                  class_group: 'asc',
                },
              ],
            },
          },

          orderBy: {
            created_at: 'desc',
          },
        },
      },

      orderBy: {
        id: 'asc',
      },
    });

    return {
      items: offerings.map((offering) => ({
        ...offering,
        evaluations: offering.evaluations.map(attachTargetLabelViews),
      })),
      total: offerings.length,
      complete: true,
    };
  }

  async findOne(id: bigint, actorId?: bigint) {
    const offering = await this.prisma.course_offerings.findUnique({
      where: {
        id,
      },
      include: offeringInclude,
    });

    if (!offering) {
      throw new NotFoundException('Course offering not found');
    }

    if (
      actorId !== undefined &&
      !(await this.prisma.course_offerings.count({
        where: { AND: [{ id }, await this.readerScope(actorId)] },
      }))
    )
      throw new ForbiddenException(
        'This offering is outside your authorized scope',
      );
    return offering;
  }

  async create(dto: CreateCourseOfferingDto, actorId?: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) => new CourseOfferingsService(db).createInTransaction(dto, actorId),
      (e: any) => {
        this.handleWriteError(e);
      },
    );
  }

  private async createInTransaction(
    dto: CreateCourseOfferingDto,
    actorId?: bigint,
  ) {
    const courseId = BigInt(dto.course_id);
    const lecturerId = BigInt(dto.lecturer_id);
    const semesterId = BigInt(dto.semester_id);

    const sectionCode =
      dto.section_code !== undefined ? dto.section_code.trim() : null;

    const yearLevel = dto.year_level !== undefined ? dto.year_level : null;

    const classType = dto.class_type;

    await this.checkReferences(courseId, lecturerId, semesterId);
    const approval = await requireCurriculumApproval(
      this.prisma,
      courseId,
      semesterId,
      yearLevel,
      dto.group_scopes,
    );
    if (actorId !== undefined)
      await assertDepartmentScope(
        this.prisma,
        actorId,
        approval.course.department_id,
      );

    await this.checkNotDuplicate(
      courseId,
      lecturerId,
      semesterId,
      sectionCode,
      yearLevel,
      classType ?? null,
    );

    await this.validateGroupScopes(semesterId, yearLevel, dto.group_scopes);
    const curriculumBindings = await this.resolveCurriculumScopes(
      courseId,
      dto.group_scopes,
    );

    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const offering = await tx.course_offerings.create({
          data: {
            course_id: courseId,
            lecturer_id: lecturerId,
            semester_id: semesterId,
            section_code: sectionCode,
            year_level: yearLevel,
            class_type: classType,
            created_at: now,
            updated_at: now,
          },
        });

        if (dto.group_scopes !== undefined) {
          await this.createGroupScopes(
            tx,
            offering.id,
            dto.group_scopes,
            curriculumBindings,
          );
        }

        return tx.course_offerings.findUniqueOrThrow({
          where: {
            id: offering.id,
          },
          include: offeringInclude,
        });
      });
    } catch (e: any) {
      this.handleWriteError(e);
    }
  }

  async update(id: bigint, dto: UpdateCourseOfferingDto, actorId?: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) =>
        new CourseOfferingsService(db).updateInTransaction(id, dto, actorId),
      (e: any) => {
        this.handleWriteError(e);
      },
    );
  }

  private async updateInTransaction(
    id: bigint,
    dto: UpdateCourseOfferingDto,
    actorId?: bigint,
  ) {
    const existing = await this.findOne(id, actorId);
    if (actorId !== undefined)
      await assertDepartmentScope(
        this.prisma,
        actorId,
        existing.courses.department_id,
      );

    const courseId =
      dto.course_id !== undefined ? BigInt(dto.course_id) : existing.course_id;

    const lecturerId =
      dto.lecturer_id !== undefined
        ? BigInt(dto.lecturer_id)
        : existing.lecturer_id;

    const semesterId =
      dto.semester_id !== undefined
        ? BigInt(dto.semester_id)
        : existing.semester_id;

    const sectionCode =
      dto.section_code !== undefined
        ? dto.section_code.trim()
        : existing.section_code;

    const yearLevel =
      dto.year_level !== undefined ? dto.year_level : existing.year_level;

    const classType =
      dto.class_type !== undefined ? dto.class_type : existing.class_type;

    if (
      courseId !== existing.course_id ||
      lecturerId !== existing.lecturer_id ||
      semesterId !== existing.semester_id
    ) {
      const evaluationCount = await this.prisma.evaluations.count({
        where: { course_offering_id: id },
      });
      if (evaluationCount > 0)
        throw new ConflictException({
          code: 'OFFERING_HISTORY_PROTECTED',
          message:
            'An offering with evaluations keeps its original course, lecturer and semester. Create a new offering for a changed teaching assignment.',
        });
    }

    const scopeKeys = (
      scopes: {
        academic_year_id: string | bigint;
        generation_id: string | bigint;
        major_id: string | bigint;
        year_level: number;
        class_groups?: string[];
        class_group?: string;
      }[],
    ) =>
      [
        ...new Set(
          scopes.flatMap((scope) =>
            normalizeClassGroups(
              scope.class_groups ?? [scope.class_group!],
            ).map((group) =>
              JSON.stringify([
                String(BigInt(scope.academic_year_id)),
                String(BigInt(scope.generation_id)),
                String(BigInt(scope.major_id)),
                scope.year_level,
                group,
              ]),
            ),
          ),
        ),
      ].sort();
    if (
      courseId !== existing.course_id ||
      semesterId !== existing.semester_id ||
      yearLevel !== existing.year_level ||
      (dto.group_scopes !== undefined &&
        JSON.stringify(scopeKeys(dto.group_scopes)) !==
          JSON.stringify(scopeKeys(existing.group_scopes)))
    )
      await requireCurriculumApproval(
        this.prisma,
        courseId,
        semesterId,
        yearLevel,
        dto.group_scopes,
      );
    if (actorId !== undefined && courseId !== existing.course_id) {
      const course = await this.prisma.courses.findUniqueOrThrow({
        where: { id: courseId },
      });
      await assertDepartmentScope(this.prisma, actorId, course.department_id);
    }
    await this.checkReferences(courseId, lecturerId, semesterId);

    if (
      courseId !== existing.course_id ||
      lecturerId !== existing.lecturer_id ||
      semesterId !== existing.semester_id ||
      yearLevel !== existing.year_level ||
      classType !== existing.class_type
    ) {
      await this.checkNotDuplicate(
        courseId,
        lecturerId,
        semesterId,
        sectionCode,
        yearLevel,
        classType,
        id,
      );
    }

    /*
     * If group_scopes is omitted, existing scopes are
     * preserved. But if the offering academic context itself
     * changes, those preserved scopes must still remain valid.
     */
    const scopesForValidation: CourseOfferingGroupScopeDto[] =
      dto.group_scopes !== undefined
        ? dto.group_scopes
        : existing.group_scopes.map((scope) => ({
            academic_year_id: scope.academic_year_id.toString(),
            generation_id: scope.generation_id.toString(),
            major_id: scope.major_id.toString(),
            year_level: scope.year_level,
            class_groups: [scope.class_group],
          }));

    await this.validateGroupScopes(semesterId, yearLevel, scopesForValidation);
    const pinnedScopes = existing.group_scopes.filter(
      (scope) =>
        scope.curriculum_revision_id !== null &&
        scope.curriculum_revision_id !== undefined,
    );
    let curriculumBindings = new Map<string, bigint | null>();
    if (pinnedScopes.length) {
      const scopeKeys = (scopes: CourseOfferingGroupScopeDto[]) =>
        scopes
          .flatMap((scope) =>
            normalizeClassGroups(scope.class_groups).map((group) =>
              [
                BigInt(scope.academic_year_id),
                BigInt(scope.generation_id),
                BigInt(scope.major_id),
                scope.year_level,
                group,
              ].join(':'),
            ),
          )
          .sort();
      const originalScopes = existing.group_scopes.map((scope) => ({
        academic_year_id: String(scope.academic_year_id),
        generation_id: String(scope.generation_id),
        major_id: String(scope.major_id),
        year_level: scope.year_level,
        class_groups: [scope.class_group],
      }));
      if (
        courseId !== existing.course_id ||
        semesterId !== existing.semester_id ||
        yearLevel !== existing.year_level ||
        JSON.stringify(scopeKeys(scopesForValidation)) !==
          JSON.stringify(scopeKeys(originalScopes))
      ) {
        throw new ConflictException(
          'A curriculum-bound offering keeps its original course, semester, year level and group assignments. Create another offering for changed curriculum context.',
        );
      }
      for (const scope of existing.group_scopes)
        curriculumBindings.set(
          `${BigInt(scope.major_id)}:${scope.year_level}`,
          scope.curriculum_revision_id,
        );
      for (const scope of scopesForValidation) {
        const pinned = curriculumBindings.get(
          `${BigInt(scope.major_id)}:${scope.year_level}`,
        );
        if (
          scope.curriculum_revision_id !== undefined &&
          String(pinned) !== scope.curriculum_revision_id
        )
          throw new ConflictException(
            'Existing curriculum bindings cannot be replaced',
          );
      }
    } else if (dto.group_scopes !== undefined) {
      curriculumBindings = await this.resolveCurriculumScopes(
        courseId,
        dto.group_scopes,
      );
    } else if (
      existing.group_scopes.length &&
      courseId !== existing.course_id
    ) {
      // A changed course is a new assignment even when scopes were omitted.
      curriculumBindings = await this.resolveCurriculumScopes(
        courseId,
        scopesForValidation,
      );
      if ([...curriculumBindings.values()].some((id) => id !== null))
        throw new ConflictException(
          'Changing to a revisioned course requires explicit group_scopes to save curriculum bindings',
        );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.course_offerings.update({
          where: {
            id,
          },
          data: {
            course_id: courseId,
            lecturer_id: lecturerId,
            semester_id: semesterId,
            section_code: sectionCode,
            year_level: yearLevel,
            class_type: classType,
            updated_at: new Date(),
          },
        });

        if (dto.group_scopes !== undefined && pinnedScopes.length === 0) {
          await tx.course_offering_group_scopes.deleteMany({
            where: {
              course_offering_id: id,
            },
          });

          await this.createGroupScopes(
            tx,
            id,
            dto.group_scopes,
            curriculumBindings,
          );
        }

        return tx.course_offerings.findUniqueOrThrow({
          where: {
            id,
          },
          include: offeringInclude,
        });
      });
    } catch (e: any) {
      this.handleWriteError(e);
    }
  }

  async remove(id: bigint, actorId?: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) => new CourseOfferingsService(db).removeInTransaction(id, actorId),
      (e: any) => {
        if (e.code === 'P2003') {
          throw new ConflictException(
            'Course offering has enrollments or evaluations and cannot be deleted',
          );
        }
        throw e;
      },
    );
  }

  private async removeInTransaction(id: bigint, actorId?: bigint) {
    const existing = await this.findOne(id, actorId);
    if (actorId !== undefined)
      await assertDepartmentScope(
        this.prisma,
        actorId,
        existing.courses.department_id,
      );

    try {
      await this.prisma.$transaction(async (tx) => {
        /*
         * Group-scope rows are configuration owned by the
         * offering. Remove them explicitly before deleting
         * an otherwise unused offering because the schema
         * intentionally uses NO ACTION foreign keys.
         */
        await tx.course_offering_group_scopes.deleteMany({
          where: {
            course_offering_id: id,
          },
        });

        await tx.course_offerings.delete({
          where: {
            id,
          },
        });
      });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new ConflictException(
          'Course offering has enrollments or evaluations and cannot be deleted',
        );
      }
      throw e;
    }
  }

  private async validateGroupScopes(
    semesterId: bigint,
    offeringYearLevel: number | null,
    scopes: CourseOfferingGroupScopeDto[] | undefined,
  ) {
    if (scopes === undefined) {
      return;
    }

    const semester = await this.prisma.semesters.findUnique({
      where: {
        id: semesterId,
      },
      select: {
        academic_year_id: true,
      },
    });

    if (!semester) {
      throw new BadRequestException('semester_id does not match any semester');
    }

    const seen = new Set<string>();

    for (const scope of scopes) {
      const academicYearId = BigInt(scope.academic_year_id);
      const generationId = BigInt(scope.generation_id);
      const majorId = BigInt(scope.major_id);

      if (academicYearId !== semester.academic_year_id) {
        throw new BadRequestException(
          'Group scope academic_year_id must match the course offering semester academic year',
        );
      }

      if (
        offeringYearLevel !== null &&
        scope.year_level !== offeringYearLevel
      ) {
        throw new BadRequestException(
          'Group scope year_level must match the course offering year_level',
        );
      }

      const normalizedGroups = normalizeClassGroups(scope.class_groups);

      if (normalizedGroups.length === 0) {
        throw new BadRequestException(
          'Each group scope must contain at least one non-empty class group',
        );
      }

      const [academicYear, generation, major] = await Promise.all([
        this.prisma.academic_years.findUnique({
          where: {
            id: academicYearId,
          },
          select: {
            id: true,
          },
        }),

        this.prisma.student_generations.findUnique({
          where: {
            id: generationId,
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
        throw new BadRequestException(
          'Group scope academic_year_id does not match any academic year',
        );
      }

      if (!generation) {
        throw new BadRequestException(
          'Group scope generation_id does not match any student generation',
        );
      }

      if (!major) {
        throw new BadRequestException(
          'Group scope major_id does not match any major',
        );
      }

      for (const classGroup of normalizedGroups) {
        const key = [
          academicYearId.toString(),
          generationId.toString(),
          majorId.toString(),
          scope.year_level.toString(),
          classGroup,
        ].join(':');

        if (seen.has(key)) {
          throw new BadRequestException(
            'Duplicate course offering group scope',
          );
        }

        seen.add(key);
      }
    }
  }

  private async createGroupScopes(
    prisma: PrismaWriteClient,
    offeringId: bigint,
    scopes: CourseOfferingGroupScopeDto[],
    curriculumBindings: Map<string, bigint | null>,
  ) {
    const rows = scopes.flatMap((scope) => {
      const normalizedGroups = normalizeClassGroups(scope.class_groups);

      return normalizedGroups.map((classGroup) => ({
        course_offering_id: offeringId,
        academic_year_id: BigInt(scope.academic_year_id),
        generation_id: BigInt(scope.generation_id),
        major_id: BigInt(scope.major_id),
        year_level: scope.year_level,
        class_group: classGroup,
        curriculum_revision_id:
          curriculumBindings.get(
            `${BigInt(scope.major_id)}:${scope.year_level}`,
          ) ?? null,
      }));
    });

    if (rows.length === 0) {
      return;
    }

    await prisma.course_offering_group_scopes.createMany({
      data: rows,
    });
  }

  private async resolveCurriculumScopes(
    courseId: bigint,
    scopes: CourseOfferingGroupScopeDto[] | undefined,
  ) {
    const bindings = new Map<string, bigint | null>();
    for (const scope of scopes ?? []) {
      const rules = await this.prisma.course_year_rules.findMany({
        where: { course_id: courseId, major_id: BigInt(scope.major_id) },
        include: { revisions: { orderBy: { effective_start_year: 'asc' } } },
      });
      const tracked = rules.some((rule) => rule.revisions.length > 0);
      const rule = rules.find(
        (candidate) => candidate.year_level === scope.year_level,
      );
      let revisionId: bigint | null = null;
      if (tracked) {
        const year = await this.prisma.academic_years.findUnique({
          where: { id: BigInt(scope.academic_year_id) },
        });
        if (!year || year.start_year === null)
          throw new BadRequestException(
            'Revisioned curriculum assignment requires an academic year with structured start_year',
          );
        const applicable = rule?.revisions
          .filter(
            (revision) => revision.effective_start_year <= year.start_year!,
          )
          .at(-1);
        if (!applicable?.enabled)
          throw new ConflictException(
            'No enabled curriculum revision permits this course, major and year level in the offering academic year',
          );
        revisionId = applicable.id;
      }
      if (
        scope.curriculum_revision_id !== undefined &&
        String(revisionId) !== scope.curriculum_revision_id
      )
        throw new ConflictException(
          'Selected curriculum revision is obsolete, inapplicable or does not match the assignment. Reload curriculum history.',
        );
      bindings.set(`${BigInt(scope.major_id)}:${scope.year_level}`, revisionId);
    }
    return bindings;
  }

  private async checkReferences(
    courseId: bigint,
    lecturerId: bigint,
    semesterId: bigint,
  ) {
    const [course, lecturer, semester] = await Promise.all([
      this.prisma.courses.findUnique({
        where: {
          id: courseId,
        },
      }),

      this.prisma.users.findUnique({
        where: {
          id: lecturerId,
        },
        select: {
          role: true,
          status: true,
        },
      }),

      this.prisma.semesters.findUnique({
        where: {
          id: semesterId,
        },
      }),
    ]);

    if (!course) {
      throw new BadRequestException('course_id does not match any course');
    }

    if (!semester) {
      throw new BadRequestException('semester_id does not match any semester');
    }

    if (!lecturer || lecturer.role !== 'LECTURER') {
      throw new BadRequestException(
        'lecturer_id must refer to a user with role LECTURER',
      );
    }

    if (lecturer.status !== 'ACTIVE') {
      throw new BadRequestException(
        'lecturer_id must refer to an ACTIVE lecturer',
      );
    }
  }

  private async checkNotDuplicate(
    courseId: bigint,
    lecturerId: bigint,
    semesterId: bigint,
    sectionCode: string | null,
    yearLevel: number | null,
    classType: class_type | null,
    excludeId?: bigint,
  ) {
    const duplicate = await this.prisma.course_offerings.findFirst({
      where: {
        course_id: courseId,
        lecturer_id: lecturerId,
        semester_id: semesterId,
        year_level: yearLevel,
        class_type: classType,

        id:
          excludeId !== undefined
            ? {
                not: excludeId,
              }
            : undefined,
      },
    });

    if (duplicate) {
      throw new ConflictException({
        code: 'ASSIGNMENT_EXISTS',
        message: DUPLICATE_MESSAGE,
        existing_assignment_id: duplicate.id.toString(),
      });
    }
  }

  private handleWriteError(e: any): never {
    if (e.code === 'P2002') {
      throw new ConflictException(DUPLICATE_MESSAGE);
    }

    if (e.code === 'P2003') {
      throw new BadRequestException(
        'Invalid course offering group scope or course, lecturer, semester reference',
      );
    }

    throw e;
  }
}
