import { describe, expect, it } from '@jest/globals';
import {
  generationNumber,
  assertCohortMajor,
} from './generation-identity.util';
describe('Major-scoped integer cohort identities', () => {
  it.each([5, '5', '05', 'Gen 5', 'gen 005'])(
    'normalizes numeric compatibility alias %s',
    (value) => expect(generationNumber(value)).toBe(5),
  );
  it.each([
    0,
    -1,
    1.5,
    2147483648,
    'DS 1',
    '1.0',
    '1e2',
    '',
    null,
    undefined,
    {},
    true,
  ])('rejects invalid identity %s', (value) =>
    expect(() => generationNumber(value)).toThrow(),
  );
  it('accepts the PostgreSQL INTEGER upper bound', () =>
    expect(generationNumber(2147483647)).toBe(2147483647));
  it('rejects a cohort owned by another major', () =>
    expect(() => assertCohortMajor({ major_id: 2n }, 3n)).toThrow(
      'selected major',
    ));
  it('keeps legacy cohort references read-only for new assignments', () =>
    expect(() => assertCohortMajor({ major_id: null }, 3n)).toThrow(
      'legacy cohort',
    ));
});
