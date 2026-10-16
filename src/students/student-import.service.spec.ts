import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { StudentImportService } from './student-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImportStudentsDto } from './dto/import-students.dto';

const mock = () => jest.fn<(...args: any[]) => Promise<any>>();
describe('StudentImportService — major-owned cohorts and safe row retries', () => {
  let db: any, service: StudentImportService;
  const cohort = {
    id: 10n,
    name: 'Gen 5',
    major_id: 2n,
    generation_number: 5,
    entry_academic_year_id: 1n,
    starting_year_level: 1,
  };
  const major = {
    id: 2n,
    code: 'DS',
    name: 'Data Science',
    department_id: 3n,
    departments: { status: 'ACTIVE' },
  };
  const dto = (extra: Partial<ImportStudentsDto> = {}): ImportStudentsDto => ({
    major_id: '2',
    generation_number: 5,
    academic_year_id: '1',
    year_level: 1,
    initial_password: 'Password123',
    class_group: 'A',
    students: [{ student_code: 'S001', full_name: 'Student One', major: 'DS' }],
    ...extra,
  });
  beforeEach(() => {
    db = {
      academic_years: {
        findUnique: mock().mockResolvedValue({
          id: 1n,
          name: '2026',
          start_year: 2026,
        }),
      },
      student_generations: {
        findUnique: mock().mockResolvedValue(cohort),
        create: mock().mockResolvedValue(cohort),
      },
      majors: {
        findMany: mock().mockResolvedValue([major]),
        findUnique: mock().mockResolvedValue(major),
      },
      students: {
        findMany: mock().mockResolvedValue([]),
        create: mock().mockResolvedValue({ id: 20n }),
      },
      users: { create: mock().mockResolvedValue({ id: 30n }) },
      student_academic_records: {
        create: mock().mockResolvedValue({ id: 40n }),
      },
      $transaction: mock(),
    };
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    service = new StudentImportService(db as PrismaService);
  });
  it('imports an owned cohort, normalizes identifiers, and hashes the supplied password', async () => {
    const result = await service.importStudents(dto());
    expect(result.summary).toEqual({
      total: 1,
      created: 1,
      skipped: 0,
      failed: 0,
    });
    expect(result.generation).toEqual(
      expect.objectContaining({
        id: '10',
        major_id: '2',
        generation_number: 5,
      }),
    );
    expect(db.student_generations.findUnique).toHaveBeenCalledWith({
      where: {
        major_id_generation_number: { major_id: 2n, generation_number: 5 },
      },
    });
    const data = db.users.create.mock.calls[0][0].data;
    expect(await bcrypt.compare('Password123', data.password_hash)).toBe(true);
    expect(data.password).toBeUndefined();
    expect(db.students.create.mock.calls[0][0].data.student_code).toBe('s001');
  });
  it('accepts a legacy numeric alias only within an explicit major', async () => {
    expect(
      (
        await service.importStudents(
          dto({ generation_number: undefined, generation: 'Gen 05' }),
        )
      ).summary.created,
    ).toBe(1);
  });
  it('rejects an ambiguous global import without any writes', async () => {
    await expect(
      service.importStudents(dto({ major_id: undefined as any })),
    ).rejects.toThrow('major_id');
    expect(db.student_generations.create).not.toHaveBeenCalled();
    expect(db.users.create).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 2147483648])(
    'rejects invalid generation number %s before writes',
    async (number) => {
      await expect(
        service.importStudents(dto({ generation_number: number })),
      ).rejects.toThrow('generation_number');
      expect(db.users.create).not.toHaveBeenCalled();
    },
  );
  it('validates duplicate normalized file identifiers before cohort creation', async () => {
    await expect(
      service.importStudents(
        dto({
          students: [
            { student_code: 'S1', major: 'DS' },
            { student_code: 's1', major: 'DS' },
          ],
        }),
      ),
    ).rejects.toThrow('Duplicate');
    expect(db.student_generations.create).not.toHaveBeenCalled();
  });
  it('rejects unknown majors before creating a cohort or student', async () => {
    db.majors.findMany.mockResolvedValue([]);
    await expect(service.importStudents(dto())).rejects.toThrow();
    expect(db.student_generations.create).not.toHaveBeenCalled();
    expect(db.users.create).not.toHaveBeenCalled();
  });
  it('rejects ambiguous major labels before any writes', async () => {
    db.majors.findMany.mockResolvedValue([major, { ...major, id: 4n }]);
    await expect(service.importStudents(dto())).rejects.toThrow();
    expect(db.users.create).not.toHaveBeenCalled();
  });
  it('rejects a row resolving to a different major before any writes', async () => {
    db.majors.findMany.mockResolvedValue([{ ...major, id: 4n }]);
    await expect(service.importStudents(dto())).rejects.toThrow(
      'request major',
    );
    expect(db.users.create).not.toHaveBeenCalled();
  });
  it('skips existing students without changing accounts, placements or cohort metadata', async () => {
    db.students.findMany.mockResolvedValue([{ id: 20n, student_code: 's001' }]);
    const result = await service.importStudents(dto());
    expect(result.summary.skipped).toBe(1);
    expect(db.users.create).not.toHaveBeenCalled();
    expect(db.student_academic_records.create).not.toHaveBeenCalled();
  });
  it('creates a new cohort with this major and its own entry metadata', async () => {
    db.student_generations.findUnique.mockResolvedValue(null);
    const result = await service.importStudents(
      dto({ entry_academic_year_id: '1', starting_year_level: 2 }),
    );
    expect(result.summary.created).toBe(1);
    expect(db.student_generations.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        major_id: 2n,
        generation_number: 5,
        entry_academic_year_id: 1n,
        starting_year_level: 2,
      }),
    );
  });
  it('requires entry metadata for a new cohort', async () => {
    db.student_generations.findUnique.mockResolvedValue(null);
    await expect(service.importStudents(dto())).rejects.toThrow(
      'entry_academic_year_id',
    );
    expect(db.users.create).not.toHaveBeenCalled();
  });
  it('reuses the existing major cohort without rewriting its entry metadata', async () => {
    await service.importStudents(
      dto({ entry_academic_year_id: '999', starting_year_level: 4 }),
    );
    expect(db.student_generations.create).not.toHaveBeenCalled();
  });
  it('uses independent bcrypt salts for students with the same initial password', async () => {
    await service.importStudents(
      dto({
        students: [
          { student_code: 's1', major: 'DS' },
          { student_code: 's2', major: 'DS' },
        ],
      }),
    );
    expect(db.users.create.mock.calls[0][0].data.password_hash).not.toBe(
      db.users.create.mock.calls[1][0].data.password_hash,
    );
  });
  it.each(['short', 'é'.repeat(37)])(
    'rejects an unsafe password before writes',
    async (password) => {
      await expect(
        service.importStudents(dto({ initial_password: password })),
      ).rejects.toThrow('password');
      expect(db.users.create).not.toHaveBeenCalled();
    },
  );
});
