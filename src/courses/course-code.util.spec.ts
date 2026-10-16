import { describe, expect, it } from '@jest/globals';
import { generatedCoursePrefix, nextCourseCode } from './course-code.util';
describe('Course code allocation', () => {
  it('starts an empty catalog at 001', () =>
    expect(nextCourseCode('GIC', [])).toBe('GIC-001'));
  it('includes manual and case-insensitive occupied codes', () =>
    expect(nextCourseCode('GIC', ['GIC-001', 'gic-010', 'official'])).toBe(
      'GIC-011',
    ));
  it('continues beyond three digits', () =>
    expect(nextCourseCode('GIC', ['GIC-999'])).toBe('GIC-1000'));
  it('sanitizes consistently and bounds prefix length', () => {
    expect(generatedCoursePrefix(' gic / ds ')).toBe('GIC-DS');
    expect(generatedCoursePrefix('A'.repeat(40)).length).toBe(18);
  });
  it('uses a deterministic fallback for a prefix with no ASCII letters/digits', () =>
    expect(generatedCoursePrefix('៛ /')).toBe('COURSE'));
});
