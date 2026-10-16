import { BadRequestException, ConflictException } from '@nestjs/common';

export function generationNumber(value: unknown): number {
  const normalized =
    typeof value === 'string' ? value.trim().replace(/^gen\s+/i, '') : value;
  if (!(
    typeof normalized === 'number' ||
    (typeof normalized === 'string' && /^\d+$/.test(normalized))
  ))
    throw new BadRequestException(
      'generation_number must be a positive integer',
    );
  const number = Number(normalized);
  if (!Number.isInteger(number) || number < 1 || number > 2147483647)
    throw new BadRequestException(
      'generation_number must be between 1 and 2147483647',
    );
  return number;
}
export function assertCohortMajor(
  generation: { major_id?: bigint | null },
  majorId: bigint,
) {
  if (generation.major_id == null)
    throw new ConflictException({
      code: 'LEGACY_GENERATION_READ_ONLY',
      message:
        'Review and map this legacy cohort before assigning new students or groups',
    });
  if (generation.major_id !== majorId)
    throw new BadRequestException(
      'Generation does not belong to the selected major',
    );
}
export const generationIdentitySelect = {
  major_id: true,
  generation_number: true,
  majors: { select: { id: true, code: true, name: true, department_id: true } },
} as const;
