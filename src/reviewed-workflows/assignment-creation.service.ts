import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireCurriculumApproval } from '../course-offerings/curriculum-approval.util';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { resolveStudentPlacement } from '../common/utils/student-placement.util';
import { normalizeClassGroups } from '../common/utils/class-group.util';
import { CourseOfferingsService } from '../course-offerings/course-offerings.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { StudentsService } from '../students/students.service';
import { StudentEvaluationProgressService } from '../students/student-evaluation-progress.service';
import { ReviewedOperationStore } from './reviewed-operation.store';
import {
  AssignmentRowsDto,
  ConfirmAssignmentsDto,
} from './dto/alignment-workflows.dto';

const sortedIds = (ids: string[]) =>
  [...ids].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
export class AssignmentCreationService {
  constructor(private readonly prisma: PrismaService) {}
  private async state(
    db: PrismaService,
    dto: AssignmentRowsDto,
    actor: bigint,
  ) {
    if (!dto.rows.length || dto.rows.length > 50)
      throw new BadRequestException('Choose 1–50 assignment rows');
    const seen = new Set<string>();
    const items = [],
      snapshot = [];
    for (const [index, row] of dto.rows.entries()) {
      const identity = JSON.stringify([
        String(BigInt(row.course_id)),
        String(BigInt(row.lecturer_id)),
        String(BigInt(row.semester_id)),
        row.year_level,
        row.class_type,
      ]);
      if (seen.has(identity))
        throw new BadRequestException(
          'Duplicate teaching assignment rows, regardless of class label',
        );
      seen.add(identity);
      if (
        !row.group_scopes?.length ||
        row.group_scopes.some(
          (s) => !normalizeClassGroups(s.class_groups).length,
        )
      )
        throw new BadRequestException(
          'Select explicit nonempty groups for every teaching assignment',
        );
      const approval = await requireCurriculumApproval(
        db,
        BigInt(row.course_id),
        BigInt(row.semester_id),
        row.year_level,
        row.group_scopes,
      );
      await assertDepartmentScope(db, actor, approval.course.department_id);
      const lecturer = await db.users.findUnique({
        where: { id: BigInt(row.lecturer_id) },
      });
      if (
        !lecturer ||
        lecturer.role !== 'LECTURER' ||
        lecturer.status !== 'ACTIVE'
      )
        throw new BadRequestException('Choose an active lecturer');
      const duplicate = await db.course_offerings.findFirst({
        where: {
          course_id: BigInt(row.course_id),
          lecturer_id: lecturer.id,
          semester_id: BigInt(row.semester_id),
          year_level: row.year_level,
          class_type: row.class_type,
        },
      });
      if (duplicate)
        throw new ConflictException({
          code: 'ASSIGNMENT_EXISTS',
          message:
            'This teaching assignment already exists regardless of class label',
          existing_assignment_id: String(duplicate.id),
        });
      const candidates = await db.students.findMany({
        where: {
          generation_id: {
            in: row.group_scopes.map((s) => BigInt(s.generation_id)),
          },
        },
        include: {
          users: {
            select: { id: true, full_name: true, role: true, status: true },
          },
          student_generations: { include: { entry_academic_year: true } },
          student_academic_records: {
            include: { academic_years: true, majors: true },
          },
        },
        orderBy: { user_id: 'asc' },
      });
      const selected = new Map<
        string,
        {
          user_id: string;
          student_code: string;
          full_name: string;
          placement_major_id: string;
          class_group: string;
          year_level: number;
        }
      >();
      for (const scope of row.group_scopes) {
        const labels = normalizeClassGroups(scope.class_groups);
        for (const group of labels) {
          let count = 0;
          for (const student of candidates) {
            const placement = resolveStudentPlacement(
              student.student_generations,
              student.student_academic_records,
              approval.semester.academic_years,
            );
            if (
              student.users.role !== 'STUDENT' ||
              student.users.status !== 'ACTIVE' ||
              !placement.placement_eligible ||
              student.generation_id !== BigInt(scope.generation_id) ||
              placement.placement.major_id !== BigInt(scope.major_id) ||
              placement.effective_year_level !== scope.year_level ||
              placement.placement.class_group !== group
            )
              continue;
            count++;
            selected.set(String(student.user_id), {
              user_id: String(student.user_id),
              student_code: student.student_code,
              full_name: student.users.full_name,
              placement_major_id: scope.major_id,
              class_group: group,
              year_level: scope.year_level,
            });
          }
          if (!count)
            throw new BadRequestException(
              `Selected group ${group} has no eligible students; review the audience`,
            );
        }
      }
      const students = [...selected.values()];
      items.push({
        row_index: index,
        eligible_count: students.length,
        confirmed_student_ids: sortedIds([...selected.keys()]),
        eligible_students: students,
      });
      snapshot.push({
        approval,
        lecturer: {
          id: lecturer.id,
          full_name: lecturer.full_name,
          status: lecturer.status,
        },
        candidates,
        selected: students,
      });
    }
    return {
      input: {
        rows: dto.rows,
        confirmations: items.map((i) => ({
          row_index: i.row_index,
          confirmed_student_ids: i.confirmed_student_ids,
        })),
      },
      snapshot,
      output: { items, can_confirm: true },
    };
  }
  preview(dto: AssignmentRowsDto, actor: bigint) {
    return new ReviewedOperationStore(this.prisma).preview(
      'CREATE_ASSIGNMENTS',
      'assignments',
      actor,
      (db) => this.state(db, dto, actor),
    );
  }
  confirm(dto: ConfirmAssignmentsDto, actor: bigint) {
    return new ReviewedOperationStore(this.prisma).confirm(
      'CREATE_ASSIGNMENTS',
      'assignments',
      actor,
      dto.review_id,
      {
        rows: dto.rows,
        confirmations: dto.confirmations.map((c) => ({
          ...c,
          confirmed_student_ids: sortedIds(c.confirmed_student_ids),
        })),
      },
      (db) => this.state(db, dto, actor),
      async (db) => {
        const items = [];
        for (const [index, row] of dto.rows.entries()) {
          const offering = await new CourseOfferingsService(db).create(row);
          const confirmation = dto.confirmations.find(
            (c) => c.row_index === index,
          );
          if (!confirmation)
            throw new BadRequestException(
              'Every assignment requires exact reviewed confirmation',
            );
          const enrollmentService = new EnrollmentsService(
            db,
            new StudentsService(db, new StudentEvaluationProgressService(db)),
          );
          for (const id of confirmation.confirmed_student_ids)
            await enrollmentService.create(offering.id, { student_id: id });
          items.push({
            row_index: index,
            course_offering_id: String(offering.id),
            created_enrollment_count: confirmation.confirmed_student_ids.length,
            already_enrolled_count: 0,
            complete: true,
          });
        }
        return { items, complete: true };
      },
    );
  }
}
