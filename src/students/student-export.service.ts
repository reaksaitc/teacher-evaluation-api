import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveStudentPlacement } from '../common/utils/student-placement.util';

import { normalizeClassGroup } from '../common/utils/class-group.util';
import { PrismaService } from '../prisma/prisma.service';
import { StudentExportQueryDto } from './dto/student-export-query.dto';

type ProgressCount = {
  completed: number;
  assigned: number;
};

type StudentProgress = {
  active: ProgressCount;
  total: ProgressCount;
};

type ExportScope = {
  generation_id: string | null;
  generation_name: string | null;

  academic_year_id: string | null;
  academic_year_name: string | null;

  major_id: string | null;
  class_group: string | null;

  semester_id: string | null;
  semester_number: number | null;
  semester_name: string | null;
};

const exportStudentSelect = {
  id: true,
  user_id: true,
  student_code: true,
  generation_id: true,

  users: {
    select: {
      full_name: true,
      gender: true,
      status: true,
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
      starting_year_level: true,
      entry_academic_year: { select: { start_year: true } },
    },
  },

  student_academic_records: {
    select: {
      id: true,
      academic_year_id: true,
      major_id: true,
      year_level: true,
      class_group: true,
      progression_action: true,

      academic_years: {
        select: {
          id: true,
          name: true,
          start_year: true,
        },
      },

      majors: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },

    orderBy: {
      academic_year_id: 'desc' as const,
    },
  },
} satisfies Prisma.studentsSelect;

type ExportStudent = Prisma.studentsGetPayload<{
  select: typeof exportStudentSelect;
}>;

@Injectable()
export class StudentExportService {
  constructor(private readonly prisma: PrismaService) {}

  async getExportData(query: StudentExportQueryDto) {
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

    const classGroup = normalizeClassGroup(query.class_group);

    if (query.class_group !== undefined && classGroup === null) {
      throw new BadRequestException('class_group must not be empty');
    }

    if (
      classGroup !== null &&
      (academicYearId === undefined ||
        generationId === undefined ||
        majorId === undefined)
    ) {
      throw new BadRequestException(
        'academic_year_id, generation_id, and major_id are required when class_group is provided',
      );
    }

    /*
     * Semester numbers are scoped to academic years.
     * Never interpret Semester 1 or Semester 2 without
     * an academic-year context.
     */
    if (query.semester_number !== undefined && academicYearId === undefined) {
      throw new BadRequestException(
        'academic_year_id is required when semester_number is provided',
      );
    }

    const [generation, academicYear] = await Promise.all([
      generationId !== undefined
        ? this.prisma.student_generations.findUnique({
            where: {
              id: generationId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve(null),

      academicYearId !== undefined
        ? this.prisma.academic_years.findUnique({
            where: {
              id: academicYearId,
            },
            select: {
              id: true,
              name: true,
              start_year: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (generationId !== undefined && !generation) {
      throw new NotFoundException('Student generation not found');
    }

    if (academicYearId !== undefined && !academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    /*
     * Resolve the stable semester row using the
     * compound unique key:
     *
     * academic_year_id + semester_number
     *
     * We never infer semester number from database IDs
     * or free-text semester names.
     */
    let semester: {
      id: bigint;
      semester_name: string;
      semester_number: number | null;
      academic_year_id: bigint;
    } | null = null;

    if (academicYearId !== undefined && query.semester_number !== undefined) {
      semester = await this.prisma.semesters.findUnique({
        where: {
          academic_year_id_semester_number: {
            academic_year_id: academicYearId,

            semester_number: query.semester_number,
          },
        },

        select: {
          id: true,
          semester_name: true,
          semester_number: true,
          academic_year_id: true,
        },
      });

      if (!semester) {
        throw new NotFoundException(
          `Semester ${query.semester_number} was not found for the selected academic year`,
        );
      }

      if (semester.semester_number !== 1 && semester.semester_number !== 2) {
        throw new BadRequestException(
          'Selected semester does not have a reliable Semester 1 / Semester 2 classification',
        );
      }
    }

    /*
     * Use one server-time snapshot for the entire
     * export so all active counts refer to exactly
     * the same moment.
     */
    const generatedAt = new Date();

    const scope: ExportScope = {
      generation_id: generation?.id.toString() ?? null,

      generation_name: generation?.name ?? null,

      academic_year_id: academicYear?.id.toString() ?? null,

      academic_year_name: academicYear?.name ?? null,

      major_id: majorId?.toString() ?? null,

      class_group: classGroup,

      semester_id: semester?.id.toString() ?? null,

      semester_number: semester?.semester_number ?? null,

      semester_name: semester?.semester_name ?? null,
    };

    /*
     * No academic-year filter:
     * include every matching student profile,
     * including students with no evaluations.
     *
     * Academic-year / semester filter:
     * include students who have at least one
     * explicitly assigned published evaluation
     * in the selected period.
     */
    const students = await this.findStudentsForScope(
      generationId,
      academicYearId,
      semester?.id,
      majorId,
      classGroup,
    );

    const progressByUserId = await this.getScopedProgress(
      students.map((student) => student.user_id),
      generatedAt,
      academicYearId,
      semester?.id,
    );

    const data = students.map((student, index) => {
      const progress =
        progressByUserId.get(student.user_id) ?? this.emptyProgress();

      const academicRecord = this.resolveAcademicRecord(
        student,
        academicYearId,
      );

      const contextYear = academicYear ?? academicRecord?.academic_years;
      const placementContext = contextYear
        ? resolveStudentPlacement(
            student.student_generations,
            student.student_academic_records,
            contextYear,
          )
        : null;

      const activeLeft = Math.max(
        0,
        progress.active.assigned - progress.active.completed,
      );

      const totalNotCompleted = Math.max(
        0,
        progress.total.assigned - progress.total.completed,
      );

      return {
        no: index + 1,
        academic_context: placementContext
          ? {
              academic_year: contextYear,
              calculated_year_level: placementContext.calculated_year_level,
              effective_year_level: placementContext.effective_year_level,
              year_level_source: placementContext.year_level_source,
              progression_status: placementContext.progression_status,
              placement_eligible: placementContext.placement_eligible,
              ineligibility_reason: placementContext.ineligibility_reason,
              placement: placementContext.placement,
            }
          : null,

        student_code: student.student_code,

        full_name: student.users.full_name,

        gender: student.users.gender,

        major: academicRecord
          ? {
              id: academicRecord.majors.id.toString(),

              code: academicRecord.majors.code,

              name: academicRecord.majors.name,
            }
          : null,

        placement: academicRecord
          ? {
              academic_year: {
                id: academicRecord.academic_years.id.toString(),

                name: academicRecord.academic_years.name,

                start_year: academicRecord.academic_years.start_year,
              },

              year_level: academicRecord.year_level,

              major_id: academicRecord.major_id.toString(),

              class_group: normalizeClassGroup(academicRecord.class_group),

              source: 'ACADEMIC_RECORD' as const,
            }
          : null,

        generation: {
          id: student.student_generations.id.toString(),

          name: student.student_generations.name,
          major_id: student.student_generations.major_id?.toString() ?? null,
          generation_number:
            student.student_generations.generation_number ?? null,
          major: student.student_generations.majors ?? null,
        },

        account_status: student.users.status,

        active: {
          completed: progress.active.completed,

          assigned: progress.active.assigned,

          left: activeLeft,
        },

        total: {
          completed: progress.total.completed,

          assigned: progress.total.assigned,

          not_completed: totalNotCompleted,
        },

        /*
         * Counts are calculated directly from
         * evaluation_participants, so zero here is
         * a real zero rather than a guessed value.
         */
        availability_status: 'AVAILABLE' as const,
      };
    });

    return {
      report: {
        generated_at: generatedAt.toISOString(),

        scope,

        identifiable_participation_data: true,

        privacy_notice:
          'This export contains identifiable student participation data. Share it only with authorized staff.',
      },

      preview: {
        student_count: data.length,

        complete: true,
      },

      data,
    };
  }

  private async findStudentsForScope(
    generationId: bigint | undefined,
    academicYearId: bigint | undefined,
    semesterId: bigint | undefined,
    majorId: bigint | undefined,
    classGroup: string | null,
  ): Promise<ExportStudent[]> {
    const where: Prisma.studentsWhereInput = {
      ...(generationId !== undefined && {
        generation_id: generationId,
      }),

      ...(academicYearId !== undefined &&
        majorId !== undefined && {
          student_academic_records: {
            some: {
              academic_year_id: academicYearId,

              major_id: majorId,
            },
          },
        }),

      /*
       * When a period is selected, the export group
       * contains students with at least one explicitly
       * assigned OPEN or CLOSED evaluation in that
       * period.
       *
       * evaluation_participants.student_id references
       * users.id, so this relationship is traversed
       * through the student's user account.
       */
      ...(academicYearId !== undefined && {
        users: {
          is: {
            evaluation_participants: {
              some: {
                evaluations: {
                  is: {
                    status: {
                      in: ['OPEN', 'CLOSED'],
                    },

                    course_offerings: {
                      is: {
                        semesters: {
                          is: {
                            academic_year_id: academicYearId,

                            ...(semesterId !== undefined && {
                              id: semesterId,
                            }),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    };

    const students = await this.prisma.students.findMany({
      where,

      select: exportStudentSelect,

      orderBy: {
        student_code: 'asc',
      },
    });

    if (
      classGroup === null ||
      academicYearId === undefined ||
      majorId === undefined
    ) {
      return students;
    }

    /*
     * Historical class-group values may contain different
     * casing or whitespace. Compare using the shared
     * normalization policy without rewriting history.
     */
    return students.filter((student) => {
      const placement = student.student_academic_records.find(
        (record) =>
          record.academic_year_id === academicYearId &&
          record.major_id === majorId,
      );

      return normalizeClassGroup(placement?.class_group) === classGroup;
    });
  }

  private async getScopedProgress(
    userIds: bigint[],
    now: Date,
    academicYearId: bigint | undefined,
    semesterId: bigint | undefined,
  ): Promise<Map<bigint, StudentProgress>> {
    const uniqueUserIds = [...new Set(userIds.map((id) => id.toString()))].map(
      (id) => BigInt(id),
    );

    const progressByUserId = new Map<bigint, StudentProgress>();

    for (const userId of uniqueUserIds) {
      progressByUserId.set(userId, this.emptyProgress());
    }

    if (uniqueUserIds.length === 0) {
      return progressByUserId;
    }

    const participants = await this.prisma.evaluation_participants.findMany({
      where: {
        student_id: {
          in: uniqueUserIds,
        },

        evaluations: {
          is: {
            status: {
              in: ['OPEN', 'CLOSED'],
            },

            ...(academicYearId !== undefined && {
              course_offerings: {
                is: {
                  semesters: {
                    is: {
                      academic_year_id: academicYearId,

                      ...(semesterId !== undefined && {
                        id: semesterId,
                      }),
                    },
                  },
                },
              },
            }),
          },
        },
      },

      select: {
        student_id: true,

        evaluation_id: true,

        has_submitted: true,

        evaluations: {
          select: {
            status: true,

            start_at: true,

            end_at: true,
          },
        },
      },
    });

    /*
     * Defensively deduplicate by:
     *
     * student user ID + evaluation ID
     *
     * The database already prevents duplicate
     * participant assignments, but this also protects
     * the aggregate from accidental duplication if
     * future queries introduce joins.
     */
    const seen = new Set<string>();

    for (const participant of participants) {
      const dedupeKey =
        `${participant.student_id.toString()}:` +
        participant.evaluation_id.toString();

      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);

      const progress = progressByUserId.get(participant.student_id);

      if (!progress) {
        continue;
      }

      /*
       * Every published OPEN or CLOSED assignment
       * contributes to the total denominator.
       */
      progress.total.assigned += 1;

      if (participant.has_submitted) {
        progress.total.completed += 1;
      }

      /*
       * Active:
       *
       * status = OPEN
       * start_at <= now
       * now < end_at
       *
       * An OPEN evaluation without complete schedule
       * boundaries remains in total, but it is not
       * treated as active.
       */
      const evaluation = participant.evaluations;

      const isActive =
        evaluation.status === 'OPEN' &&
        evaluation.start_at !== null &&
        evaluation.end_at !== null &&
        evaluation.start_at <= now &&
        now < evaluation.end_at;

      if (!isActive) {
        continue;
      }

      progress.active.assigned += 1;

      if (participant.has_submitted) {
        progress.active.completed += 1;
      }
    }

    return progressByUserId;
  }

  private resolveAcademicRecord(
    student: ExportStudent,
    academicYearId: bigint | undefined,
  ) {
    /*
     * When an academic year is selected, major comes
     * from that year's explicit historical placement.
     */
    if (academicYearId !== undefined) {
      return (
        student.student_academic_records.find(
          (record) => record.academic_year_id === academicYearId,
        ) ?? null
      );
    }

    /*
     * Without an academic-year scope there is no
     * specific historical year to display.
     *
     * Records are loaded newest first, therefore the
     * latest explicit placement is used when present.
     * If no record exists, major remains unavailable.
     */
    return (
      [...student.student_academic_records].sort(
        (a, b) =>
          (b.academic_years.start_year ?? -1) -
          (a.academic_years.start_year ?? -1),
      )[0] ?? null
    );
  }

  private emptyProgress(): StudentProgress {
    return {
      active: {
        completed: 0,
        assigned: 0,
      },

      total: {
        completed: 0,
        assigned: 0,
      },
    };
  }
}
