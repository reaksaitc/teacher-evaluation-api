import { PrismaService } from '../prisma/prisma.service';
import { reviewJson } from '../reviewed-workflows/reviewed-operation.store';

export type ActivityAction =
  'CREATED' | 'SCHEDULED' | 'DEADLINE_EXTENDED' | 'CLOSED' | 'SCHEDULE_UPDATED';
export async function recordEvaluationActivity(
  db: PrismaService,
  evaluationId: bigint,
  action: ActivityAction,
  actorId: bigint | undefined,
  before: unknown,
  after: unknown,
) {
  const actor =
    actorId === undefined
      ? null
      : await db.users.findUnique({
          where: { id: actorId },
          select: { full_name: true },
        });
  return db.evaluation_activity.create({
    data: {
      evaluation_id: evaluationId,
      action,
      occurred_at: new Date(),
      actor_id: actorId ?? null,
      actor_name: actor?.full_name ?? null,
      ...(before == null ? {} : { before_json: reviewJson(before) }),
      ...(after == null ? {} : { after_json: reviewJson(after) }),
    },
  });
}
export const activityState = (row: {
  start_at: Date | null;
  end_at: Date | null;
  status: string;
}) => ({
  start_at: row.start_at?.toISOString() ?? null,
  end_at: row.end_at?.toISOString() ?? null,
  status: row.status,
});
