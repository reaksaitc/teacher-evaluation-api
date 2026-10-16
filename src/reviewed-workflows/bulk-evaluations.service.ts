import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { requireCurriculumApproval } from '../course-offerings/curriculum-approval.util';
import { ReviewedOperationStore } from './reviewed-operation.store';
import {
  BulkEvaluationsDto,
  ConfirmBulkEvaluationsDto,
} from './dto/alignment-workflows.dto';

type BulkItem = {
  course_offering_id: string;
  outcome: 'READY' | 'SKIPPED' | 'BLOCKED';
  reason?: string;
  existing_evaluation_id?: string;
  eligible_count?: number;
  confirmed_student_ids?: string[];
  eligible_students?: unknown[];
};
const sorted = (ids: string[]) =>
  [...ids].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
export class BulkEvaluationsService {
  constructor(private readonly prisma: PrismaService) {}
  private async state(
    db: PrismaService,
    dto: BulkEvaluationsDto,
    actor: bigint,
  ) {
    if (!dto.evaluations.length || dto.evaluations.length > 50)
      throw new BadRequestException(
        'Select 1–50 distinct teaching assignments',
      );
    const seen = new Set<string>(),
      items: BulkItem[] = [],
      snapshots = [];
    for (const row of dto.evaluations) {
      const id = BigInt(row.course_offering_id).toString();
      if (seen.has(id))
        throw new BadRequestException(
          'Duplicate teaching assignment in bulk input',
        );
      seen.add(id);
      if (
        row.participant_scope !== 'ALL_ENROLLED' ||
        row.major_ids !== undefined ||
        row.group_scope !== undefined ||
        row.group_scopes !== undefined ||
        row.generation_ids !== undefined ||
        row.confirmed_student_ids !== undefined ||
        row.review_id !== undefined
      )
        throw new BadRequestException(
          'Bulk v1 accepts ALL_ENROLLED without extra audience restrictions',
        );
      const offering = await db.course_offerings.findUnique({
        where: { id: BigInt(id) },
        include: {
          courses: true,
          semesters: { include: { academic_years: true } },
          users: true,
          group_scopes: true,
        },
      });
      if (!offering)
        throw new NotFoundException('Teaching assignment not found');
      await assertDepartmentScope(db, actor, offering.courses.department_id);
      const existing = await db.evaluations.findFirst({
        where: { course_offering_id: offering.id },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (existing) {
        items.push({
          course_offering_id: id,
          outcome: 'SKIPPED',
          reason: 'Evaluation already exists for this teaching assignment',
          existing_evaluation_id: String(existing.id),
        });
        snapshots.push({ id, existing: String(existing.id) });
        continue;
      }
      try {
        if (
          !row.survey_id ||
          !row.survey_version_id ||
          !row.start_at ||
          !row.end_at ||
          Date.parse(row.end_at) <= Date.now() ||
          Date.parse(row.end_at) <= Date.parse(row.start_at)
        )
          throw new BadRequestException(
            'Choose an explicit latest question version and valid schedule with a future deadline',
          );
        if (
          offering.users.role !== 'LECTURER' ||
          offering.users.status !== 'ACTIVE'
        )
          throw new BadRequestException('Lecturer is unavailable');
        const scopes = offering.group_scopes.map((s) => ({
          academic_year_id: String(s.academic_year_id),
          generation_id: String(s.generation_id),
          major_id: String(s.major_id),
          year_level: s.year_level,
          class_groups: [s.class_group],
        }));
        const approval = await requireCurriculumApproval(
          db,
          offering.course_id,
          offering.semester_id,
          offering.year_level,
          scopes,
        );
        const preview = await new EvaluationsService(db).previewReviewedCreate(
          row,
        );
        const version = await db.survey_versions.findUnique({
          where: { id: BigInt(row.survey_version_id) },
          include: {
            questions: {
              include: { question_options: true },
              orderBy: { id: 'asc' },
            },
          },
        });
        items.push({
          course_offering_id: id,
          outcome: 'READY',
          eligible_count: preview.eligible_count,
          confirmed_student_ids: preview.confirmed_student_ids,
          eligible_students: preview.eligible_students,
        });
        snapshots.push({ offering, approval, version, preview });
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        if (!(
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof NotFoundException
        ))
          throw error;
        items.push({
          course_offering_id: id,
          outcome: 'BLOCKED',
          reason: error.message,
        });
        snapshots.push({ id, blocked: error.message });
      }
    }
    const confirmations = items
      .filter((i) => i.outcome === 'READY')
      .map((i) => ({
        course_offering_id: i.course_offering_id,
        confirmed_student_ids: sorted(i.confirmed_student_ids!),
      }));
    return {
      input: { evaluations: dto.evaluations, confirmations },
      snapshot: snapshots,
      output: {
        items,
        can_confirm:
          confirmations.length > 0 &&
          !items.some((i) => i.outcome === 'BLOCKED'),
      },
    };
  }
  preview(dto: BulkEvaluationsDto, actor: bigint) {
    return new ReviewedOperationStore(this.prisma).preview(
      'BULK_EVALUATIONS',
      'bulk-evaluations',
      actor,
      (db) => this.state(db, dto, actor),
    );
  }
  async confirm(dto: ConfirmBulkEvaluationsDto, actor: bigint) {
    try {
      return await new ReviewedOperationStore(this.prisma).confirm(
        'BULK_EVALUATIONS',
        'bulk-evaluations',
        actor,
        dto.review_id,
        {
          evaluations: dto.evaluations,
          confirmations: dto.confirmations.map((c) => ({
            ...c,
            confirmed_student_ids: sorted(c.confirmed_student_ids),
          })),
        },
        (db) => this.state(db, dto, actor),
        async (db) => {
          const state = await this.state(db, dto, actor);
          if (!state.output.can_confirm)
            throw new ConflictException({
              code: 'REVIEW_INVALIDATED',
              message: 'Batch is no longer ready; preview again',
            });
          const items = [];
          for (const item of state.output.items) {
            if (item.outcome === 'SKIPPED') {
              items.push({
                course_offering_id: item.course_offering_id,
                evaluation_id: item.existing_evaluation_id!,
                outcome: 'SKIPPED',
                reason: item.reason,
              });
              continue;
            }
            const row = dto.evaluations.find(
              (row) =>
                BigInt(row.course_offering_id).toString() ===
                item.course_offering_id,
            )!;
            const service = new EvaluationsService(db);
            const created = await service.create(
              { ...row, confirmed_student_ids: item.confirmed_student_ids },
              actor,
            );
            await service.open(created.id, actor);
            items.push({
              course_offering_id: item.course_offering_id,
              evaluation_id: String(created.id),
              outcome: 'SCHEDULED',
            });
          }
          return { items };
        },
      );
    } catch (error) {
      if (
        error instanceof ConflictException &&
        [undefined, 'REVIEW_STALE', 'EVALUATION_EXISTS'].includes(
          (error.getResponse() as { code?: string }).code,
        )
      )
        throw new ConflictException({
          code: 'REVIEW_INVALIDATED',
          message:
            'Reviewed batch changed. Nothing was created; preview again.',
        });
      throw error;
    }
  }
}
