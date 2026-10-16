import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { calendarDate } from '../common/utils/calendar-date.util';
import { resolveStudentPlacement } from '../common/utils/student-placement.util';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { idempotentOperation } from '../common/utils/idempotent-operation.util';
import { reviewJson } from '../reviewed-workflows/reviewed-operation.store';
import { CourseOfferingsService } from '../course-offerings/course-offerings.service';
import { requireCurriculumApproval } from '../course-offerings/curriculum-approval.util';

export class AcademicYearSetupService {
  constructor(private readonly prisma: PrismaService) {}
  async setup(
    dto: CreateAcademicYearDto,
    actorId: bigint,
    existingId?: bigint,
  ) {
    const dates = [dto, ...(dto.semesters ?? [])].map((value) => {
      const start = calendarDate(value.start_date),
        end = calendarDate(value.end_date);
      if (start && end && end <= start)
        throw new BadRequestException('end_date must be after start_date');
      return { start_date: start, end_date: end };
    });
    if (dto.semesters?.length && !dto.create_semesters)
      throw new BadRequestException(
        'Semester dates require create_semesters=true',
      );
    return idempotentOperation(
      this.prisma,
      actorId,
      existingId ? 'FINISH_YEAR_SETUP' : 'CREATE_YEAR',
      dto.idempotency_key,
      { ...dto, existing_id: existingId?.toString() ?? null },
      async (db) => {
        const permitted = actorId
          ? await assertDepartmentScope(db, actorId)
          : [];
        if (
          !existingId &&
          (await db.academic_years.findUnique({ where: { name: dto.name } }))
        )
          throw new ConflictException('Academic year already exists');
        const existing = existingId
          ? await db.academic_years.findUnique({ where: { id: existingId } })
          : null;
        if (existingId && !existing)
          throw new NotFoundException('Academic year not found');
        if (
          existing &&
          (existing.name !== dto.name ||
            (dto.start_year !== undefined &&
              existing.start_year !== dto.start_year))
        )
          throw new ConflictException(
            'Setup recovery must preserve the existing academic year identity',
          );
        const startYear = existing?.start_year ?? dto.start_year;
        const predecessors =
          startYear === undefined || startYear === null
            ? []
            : await db.academic_years.findMany({
                where: { start_year: startYear - 1 },
              });
        if (predecessors.length > 1)
          throw new ConflictException({
            code: 'AMBIGUOUS_PREDECESSOR',
            message:
              'Several academic years share the preceding start_year; review chronology before setup',
          });
        if (
          !existing &&
          startYear != null &&
          (await db.academic_years.count({ where: { start_year: startYear } }))
        )
          throw new ConflictException(
            'An academic year already uses this start_year',
          );
        if (!existing && dto.is_active)
          await db.academic_years.updateMany({
            where: { is_active: true },
            data: { is_active: false },
          });
        const year =
          existing ??
          (await db.academic_years.create({
            data: {
              name: dto.name,
              start_year: dto.start_year,
              ...dates[0],
              is_active: dto.is_active ?? false,
            },
          }));
        let semesters = await db.semesters.findMany({
          where: { academic_year_id: year.id },
          orderBy: { semester_number: 'asc' },
        });
        if (dto.create_semesters) {
          for (const number of [1, 2])
            if (!semesters.some((s) => s.semester_number === number))
              await db.semesters.create({
                data: {
                  academic_year_id: year.id,
                  semester_number: number,
                  semester_name: `Semester ${number}`,
                  ...dates[number],
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              });
          semesters = await db.semesters.findMany({
            where: { academic_year_id: year.id },
            orderBy: { semester_number: 'asc' },
          });
        }
        const source = predecessors[0];
        const groups = {
          copied: 0,
          preserved: 0,
          skipped: 0,
          copied_record_ids: [] as string[],
          reasons: [] as { student_id: string; reason: string }[],
        };
        const assignments = {
          copied: 0,
          preserved: 0,
          skipped: 0,
          copied_offering_ids: [] as string[],
          reasons: [] as { source_offering_id: string; reason: string }[],
        };
        if (source) {
          const students = await db.students.findMany({
            where: permitted.length
              ? {
                  student_academic_records: {
                    some: { majors: { department_id: { in: permitted } } },
                  },
                }
              : {},
            include: {
              users: true,
              student_generations: { include: { entry_academic_year: true } },
              student_academic_records: {
                include: { academic_years: true, majors: true },
              },
            },
          });
          for (const student of students) {
            const destination = student.student_academic_records.find(
              (r) => r.academic_year_id === year.id,
            );
            if (destination) {
              groups.preserved++;
              continue;
            }
            const old = student.student_academic_records.find(
              (r) => r.academic_year_id === source.id,
            );
            const placement = resolveStudentPlacement(
              student.student_generations,
              student.student_academic_records,
              year,
            );
            let reason = !old?.class_group?.trim()
              ? 'NO_PREDECESSOR_GROUP'
              : student.users.status !== 'ACTIVE'
                ? 'INACTIVE_ACCOUNT'
                : permitted.length &&
                    !permitted.includes(old.majors.department_id)
                  ? 'OUTSIDE_DEPARTMENT_SCOPE'
                  : placement.progression_status !== 'ACTIVE'
                    ? placement.progression_status
                    : !placement.effective_year_level
                      ? 'BEYOND_PROGRAM_OR_UNRESOLVED'
                      : placement.placement.major_id !== old.major_id
                        ? 'TRANSFER_MAPPING_REQUIRED'
                        : null;
            if (reason) {
              groups.skipped++;
              groups.reasons.push({ student_id: String(student.id), reason });
              continue;
            }
            const created = await db.student_academic_records.create({
              data: {
                student_id: student.id,
                academic_year_id: year.id,
                major_id: old!.major_id,
                year_level: placement.effective_year_level!,
                class_group: old!.class_group,
                progression_action: 'NORMAL',
              },
            });
            groups.copied++;
            groups.copied_record_ids.push(String(created.id));
          }
          const placements = await db.student_academic_records.findMany({
            where: { academic_year_id: year.id },
            include: {
              students: {
                include: {
                  users: true,
                  student_generations: {
                    include: { entry_academic_year: true },
                  },
                  student_academic_records: {
                    include: { academic_years: true },
                  },
                },
              },
            },
          });
          const sources = await db.course_offerings.findMany({
            where: {
              semesters: { academic_year_id: source.id },
              ...(permitted.length
                ? { courses: { department_id: { in: permitted } } }
                : {}),
            },
            include: {
              semesters: true,
              courses: true,
              users: true,
              group_scopes: true,
            },
            orderBy: { id: 'asc' },
          });
          for (const offering of sources) {
            const skip = (reason: string) => {
              assignments.skipped++;
              assignments.reasons.push({
                source_offering_id: String(offering.id),
                reason,
              });
            };
            if (
              permitted.length &&
              !permitted.includes(offering.courses.department_id)
            ) {
              skip('OUTSIDE_DEPARTMENT_SCOPE');
              continue;
            }
            const semester = semesters.find(
              (s) => s.semester_number === offering.semesters.semester_number,
            );
            if (
              !semester ||
              ![1, 2].includes(offering.semesters.semester_number ?? 0) ||
              !offering.year_level ||
              !offering.class_type ||
              offering.users.status !== 'ACTIVE'
            ) {
              skip('INCOMPLETE_OR_UNAVAILABLE_CONTEXT');
              continue;
            }
            const prior = await db.course_offerings.findFirst({
              where: {
                OR: [
                  { source_offering_id: offering.id, semester_id: semester.id },
                  {
                    course_id: offering.course_id,
                    lecturer_id: offering.lecturer_id,
                    semester_id: semester.id,
                    year_level: offering.year_level,
                    class_type: offering.class_type,
                  },
                ],
              },
            });
            if (prior) {
              assignments.preserved++;
              continue;
            }
            const scopes: {
              academic_year_id: string;
              generation_id: string;
              major_id: string;
              year_level: number;
              class_groups: string[];
            }[] = [];
            let unresolved = false;
            for (const scope of offering.group_scopes) {
              const matches = placements.filter(
                (p) =>
                  p.major_id === scope.major_id &&
                  p.year_level === offering.year_level &&
                  p.class_group === scope.class_group &&
                  p.students.users.status === 'ACTIVE' &&
                  resolveStudentPlacement(
                    p.students.student_generations,
                    p.students.student_academic_records,
                    year,
                  ).placement_eligible,
              );
              const cohorts = [
                ...new Set(
                  matches.map((p) => String(p.students.generation_id)),
                ),
              ];
              if (cohorts.length !== 1) {
                unresolved = true;
                break;
              }
              scopes.push({
                academic_year_id: String(year.id),
                generation_id: cohorts[0],
                major_id: String(scope.major_id),
                year_level: offering.year_level,
                class_groups: [scope.class_group],
              });
            }
            if (unresolved) {
              skip('AUDIENCE_MAPPING_UNAVAILABLE_OR_AMBIGUOUS');
              continue;
            }
            try {
              await requireCurriculumApproval(
                db,
                offering.course_id,
                semester.id,
                offering.year_level,
                scopes,
              );
            } catch (error) {
              if (
                error instanceof BadRequestException ||
                error instanceof ConflictException ||
                error instanceof NotFoundException
              ) {
                skip('DESTINATION_CURRICULUM_OR_COHORT_UNAVAILABLE');
                continue;
              }
              throw error;
            }
            const created = await new CourseOfferingsService(db).create({
              course_id: String(offering.course_id),
              lecturer_id: String(offering.lecturer_id),
              semester_id: String(semester.id),
              year_level: offering.year_level,
              class_type: offering.class_type,
              ...(offering.section_code
                ? { section_code: offering.section_code }
                : {}),
              group_scopes: scopes,
            });
            await db.course_offerings.update({
              where: { id: created.id },
              data: { source_offering_id: offering.id },
            });
            assignments.copied++;
            assignments.copied_offering_ids.push(String(created.id));
          }
        }
        const result = {
          ...year,
          academic_year: year,
          semesters,
          rollover: {
            status:
              startYear == null
                ? 'UNAVAILABLE'
                : source
                  ? 'COMPLETE'
                  : 'NO_PREDECESSOR',
            unavailable_reason:
              startYear == null ? 'STRUCTURED_START_YEAR_REQUIRED' : null,
            source_academic_year_id: source ? String(source.id) : null,
            groups,
            assignments,
          },
        };
        await db.setup_audit.create({
          data: {
            destination_year_id: year.id,
            source_year_id: source?.id,
            actor_id: actorId,
            details: reviewJson(result.rollover),
          },
        });
        return result;
      },
    );
  }
}
