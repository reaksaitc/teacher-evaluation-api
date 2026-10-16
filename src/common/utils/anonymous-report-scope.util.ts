import { BadRequestException } from '@nestjs/common';

/** Responses have no student/participant ownership to support arbitrary slices. */
export function assertWholeAnonymousAggregate(
  query: Record<string, unknown> = {},
) {
  if (Object.keys(query).length)
    throw new BadRequestException({
      code: 'UNSUPPORTED_ANONYMOUS_SCOPE',
      message:
        'This report contains whole evaluation aggregates. Generation/group query slicing is not supported; use the saved target context without attributing answers to students.',
    });
}

/** Only the captured anonymous major tag is sliceable; arbitrary identity/group queries remain rejected. */
export function anonymousMajorFilter(
  query: Record<string, unknown> = {},
): bigint | undefined {
  if (Object.keys(query).some((key) => key !== 'major_id')) {
    assertWholeAnonymousAggregate(query);
  }
  if (query.major_id === undefined) return undefined;
  if (
    typeof query.major_id !== 'string' ||
    !/^[1-9]\d*$/.test(query.major_id) ||
    query.major_id.length > 19
  )
    throw new BadRequestException('major_id must be a positive integer ID');
  return BigInt(query.major_id);
}
