import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const targetLabelSelect = {
  historical_labels: true,
  labels_captured_at: true,
} as const;

type GroupScope = {
  academic_year_id: bigint;
  generation_id: bigint;
  major_id: bigint;
  year_level: number;
  class_groups: string[];
};
type LabelClient = Pick<
  Prisma.TransactionClient,
  'student_generations' | 'academic_years' | 'majors'
>;

/** Called on the same serializable snapshot as targeting validation and writes. */
export async function loadTargetLabels(
  db: LabelClient,
  generationIds: bigint[],
  scope: GroupScope | null,
) {
  const ids = [
    ...new Set([...generationIds, ...(scope ? [scope.generation_id] : [])]),
  ];
  const generations = ids.length
    ? await db.student_generations.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          major_id: true,
          generation_number: true,
          starting_year_level: true,
          entry_academic_year: {
            select: { id: true, name: true, start_year: true },
          },
        },
      })
    : [];
  if (generations.length !== ids.length)
    throw new BadRequestException('Target label generation is unavailable');
  const selected = new Set(generationIds.map(String));
  const generationLabels = generations
    .filter((generation) => selected.has(String(generation.id)))
    .map((generation) => ({
      generation_id: String(generation.id),
      historical_labels: {
        schema_version: 1,
        generation: {
          id: String(generation.id),
          name: generation.name,
          major_id: generation.major_id?.toString() ?? null,
          generation_number: generation.generation_number,
        },
        entry_academic_year: {
          id: String(generation.entry_academic_year.id),
          name: generation.entry_academic_year.name,
          start_year: generation.entry_academic_year.start_year,
        },
        starting_year_level: generation.starting_year_level,
      },
    }));
  const groups: {
    historical_labels: Prisma.InputJsonObject;
    class_group: string;
  }[] = [];
  if (scope) {
    const [year, major] = await Promise.all([
      db.academic_years.findUnique({
        where: { id: scope.academic_year_id },
        select: { id: true, name: true, start_year: true },
      }),
      db.majors.findUnique({
        where: { id: scope.major_id },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const generation = generations.find(
      (entry) => entry.id === scope.generation_id,
    );
    if (!year || !major || !generation)
      throw new BadRequestException(
        'Target label academic year, major or generation is unavailable',
      );
    for (const classGroup of [...scope.class_groups].sort())
      groups.push({
        class_group: classGroup,
        historical_labels: {
          schema_version: 1,
          academic_year: {
            id: String(year.id),
            name: year.name,
            start_year: year.start_year,
          },
          generation: {
            id: String(generation.id),
            name: generation.name,
            major_id: generation.major_id?.toString() ?? null,
            generation_number: generation.generation_number,
          },
          major: { id: String(major.id), code: major.code, name: major.name },
          year_level: scope.year_level,
          class_group: classGroup,
        },
      });
  }
  return { generations: generationLabels, groups };
}

/** Never fill missing historical values from current labels on a read. */
export function targetLabelView(
  target: {
    historical_labels?: unknown;
    labels_captured_at?: Date | string | null;
  },
  currentLabels: unknown,
) {
  const captured =
    target.historical_labels != null && target.labels_captured_at != null;
  return {
    historical_labels: captured ? target.historical_labels : null,
    labels_captured_at: captured ? target.labels_captured_at : null,
    historical_labels_status: captured ? 'CAPTURED' : 'UNKNOWN',
    historical_labels_unavailable_reason: captured
      ? null
      : 'LEGACY_LABELS_NOT_CAPTURED',
    current_labels: currentLabels,
  };
}

export function attachTargetLabelViews<
  T extends { generation_targets?: any[]; group_targets?: any[] },
>(evaluation: T): T {
  return {
    ...evaluation,
    ...(evaluation.generation_targets
      ? {
          generation_targets: evaluation.generation_targets.map((target) => ({
            ...target,
            ...targetLabelView(target, {
              generation: target.student_generations,
            }),
          })),
        }
      : {}),
    ...(evaluation.group_targets
      ? {
          group_targets: evaluation.group_targets.map((target) => ({
            ...target,
            ...targetLabelView(target, {
              academic_year: target.academic_years,
              generation: target.student_generations,
              major: target.majors,
              year_level: target.year_level,
              class_group: target.class_group,
            }),
          })),
        }
      : {}),
  };
}
