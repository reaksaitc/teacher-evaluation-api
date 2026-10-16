export function generatedCoursePrefix(value: string): string {
  return (
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 18)
      .replace(/-+$/g, '') || 'COURSE'
  );
}
export function nextCourseCode(prefix: string, occupied: string[]): string {
  let number = 0n;
  const normalized = new Set(occupied.map((value) => value.toUpperCase()));
  for (const code of normalized) {
    const suffix = code.startsWith(prefix + '-')
      ? code.slice(prefix.length + 1)
      : '';
    if (/^\d+$/.test(suffix) && BigInt(suffix) > number)
      number = BigInt(suffix);
  }
  let code: string;
  do {
    number++;
    code = `${prefix}-${String(number).padStart(3, '0')}`;
  } while (normalized.has(code));
  if (code.length > 30) throw new Error('Course code sequence is exhausted');
  return code;
}
