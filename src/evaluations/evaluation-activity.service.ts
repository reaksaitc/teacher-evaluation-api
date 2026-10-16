import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertDepartmentScope } from '../common/utils/department-scope.util';
import { EvaluationActivityQueryDto } from '../reviewed-workflows/dto/alignment-workflows.dto';

export class EvaluationActivityService {
  constructor(private readonly prisma: PrismaService) {}
  async list(id: bigint, query: EvaluationActivityQueryDto, actor: bigint) {
    const evaluation = await this.prisma.evaluations.findUnique({
      where: { id },
      include: { course_offerings: { include: { courses: true } } },
    });
    // Tombstoned history remains visible only to installation-wide administrators.
    if (evaluation)
      await assertDepartmentScope(
        this.prisma,
        actor,
        evaluation.course_offerings.courses.department_id,
      );
    else {
      const scope = await assertDepartmentScope(this.prisma, actor);
      if (
        scope.length ||
        !(await this.prisma.evaluation_activity.findFirst({
          where: { evaluation_id: id },
        }))
      )
        throw new NotFoundException('Evaluation not found');
    }
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('limit must be 1–100');
    let cursor: { at: string; id: string } | undefined;
    if (query.cursor !== undefined) {
      try {
        if (query.cursor.length > 512 || !/^[\w-]+$/.test(query.cursor))
          throw new Error();
        cursor = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString('utf8'),
        );
        if (
          !cursor ||
          !/^[1-9]\d{0,18}$/.test(cursor.id) ||
          BigInt(cursor.id) > 9223372036854775807n ||
          !Number.isFinite(Date.parse(cursor.at)) ||
          new Date(cursor.at).toISOString() !== cursor.at
        )
          throw new Error();
        const anchor = await this.prisma.evaluation_activity.findUnique({
          where: { id: BigInt(cursor.id) },
        });
        if (
          !anchor ||
          anchor.evaluation_id !== id ||
          anchor.occurred_at.toISOString() !== cursor.at
        )
          throw new Error();
      } catch {
        throw new BadRequestException('Invalid activity cursor');
      }
    }
    const rows = await this.prisma.evaluation_activity.findMany({
      where: {
        evaluation_id: id,
        ...(cursor
          ? {
              OR: [
                { occurred_at: { lt: new Date(cursor.at) } },
                {
                  occurred_at: new Date(cursor.at),
                  id: { lt: BigInt(cursor.id) },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasCreation = await this.prisma.evaluation_activity.findFirst({
      where: { evaluation_id: id, action: 'CREATED' },
      select: { id: true },
    });
    const selected = rows.slice(0, limit),
      last = selected.at(-1);
    return {
      items: selected.map((row) => ({
        id: String(row.id),
        action: row.action,
        occurred_at: row.occurred_at.toISOString(),
        actor: {
          type: row.actor_id === null ? 'SYSTEM' : 'ADMIN',
          id: row.actor_id?.toString() ?? null,
          full_name: row.actor_name,
        },
        before: row.before_json ?? null,
        after: row.after_json ?? null,
      })),
      next_cursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                at: last.occurred_at.toISOString(),
                id: String(last.id),
              }),
            ).toString('base64url')
          : null,
      history_status: hasCreation ? 'COMPLETE' : 'LEGACY_ACTIONS_UNAVAILABLE',
      retained_tombstone: !evaluation,
      prior_history_available: !!hasCreation,
    };
  }
}
