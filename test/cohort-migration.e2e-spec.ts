import { beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
const { preflight, applyReviewedPlan } = createRequire(
  `${process.cwd()}/package.json`,
)('./scripts/cohort-migration.cjs');

describe('Reviewed non-destructive legacy cohort migration (real PostgreSQL)', () => {
  const db = new PrismaClient(),
    stamp = `${Date.now()}`;
  let source: bigint,
    major1: bigint,
    major2: bigint,
    year: bigint,
    students: bigint[],
    historical: any,
    plan: any;
  beforeAll(async () => {
    const department = await db.departments.create({
      data: { code: `CM-${stamp}`, name: `Cohort migration ${stamp}` },
    });
    major1 = (
      await db.majors.create({
        data: {
          code: `CM1-${stamp}`,
          name: 'DS migration',
          department_id: department.id,
        },
      })
    ).id;
    major2 = (
      await db.majors.create({
        data: {
          code: `CM2-${stamp}`,
          name: 'FE migration',
          department_id: department.id,
        },
      })
    ).id;
    year = (
      await db.academic_years.create({
        data: { name: `CM-${stamp}`, start_year: 2030 },
      })
    ).id;
    source = (
      await db.student_generations.create({
        data: { name: 'Gen 01', entry_academic_year_id: year },
      })
    ).id;
    const admin = await db.users.findFirstOrThrow({ where: { role: 'ADMIN' } });
    students = [];
    for (const [index, major] of [major1, major2].entries()) {
      const user = await db.users.create({
        data: {
          email: `cm-${stamp}-${index}@example.edu`,
          full_name: 'Migration fixture',
          password_hash: admin.password_hash,
          role: 'STUDENT',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      const student = await db.students.create({
        data: {
          user_id: user.id,
          student_code: `cm-${stamp}-${index}`,
          generation_id: source,
          student_academic_records: {
            create: {
              academic_year_id: year,
              major_id: major,
              year_level: 1,
              class_group: 'A',
            },
          },
        },
      });
      students.push(student.id);
    }
    historical = {
      placements: await db.student_academic_records.findMany({
        where: { student_id: { in: students } },
        orderBy: { id: 'asc' },
      }),
      response_count: await db.responses.count(),
      answer_count: await db.answers.count(),
      enrollment_count: await db.enrollments.count(),
    };
    const inspected = await preflight(db);
    expect(
      inspected.cohorts.find((c: any) => c.id === String(source))
        .historical_major_ids,
    ).toHaveLength(2);
    plan = {
      approved: true,
      reviewed_by: 'Synthetic migration reviewer',
      rationale:
        'Explicit per-student ownership reviewed against historical placements; retain legacy historical references',
      source_fingerprint: inspected.source_fingerprint,
      mappings: [
        {
          source_generation_id: String(source),
          target_major_id: String(major1),
          generation_number: 1,
          entry_academic_year_id: String(year),
          starting_year_level: 1,
          student_ids: [String(students[0])],
        },
        {
          source_generation_id: String(source),
          target_major_id: String(major2),
          generation_number: 1,
          entry_academic_year_id: String(year),
          starting_year_level: 2,
          student_ids: [String(students[1])],
        },
      ],
    };
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('rejects an unapproved or incomplete mapping without modifying relations', async () => {
    await expect(
      applyReviewedPlan(db, { ...plan, approved: false }),
    ).rejects.toThrow('approved plan');
    await expect(
      applyReviewedPlan(db, { ...plan, mappings: [plan.mappings[0]] }),
    ).rejects.toThrow('every student');
    expect(
      (await db.students.findMany({ where: { id: { in: students } } })).every(
        (s) => s.generation_id === source,
      ),
    ).toBe(true);
  });
  it('refuses to assign a shared global cohort to one major', async () => {
    await expect(
      applyReviewedPlan(db, {
        ...plan,
        mappings: [
          {
            ...plan.mappings[0],
            preserve_source_id: true,
            student_ids: students.map(String),
          },
        ],
      }),
    ).rejects.toThrow('shared legacy cohort');
  });
  it('splits only explicitly mapped links, preserves academic/history records and keeps a durable audit receipt', async () => {
    const saved = await applyReviewedPlan(db, plan);
    expect(saved.mappings).toHaveLength(2);
    expect(saved.mappings[0].target_generation_id).not.toBe(
      saved.mappings[1].target_generation_id,
    );
    const cohorts = await db.student_generations.findMany({
      where: { major_id: { in: [major1, major2] } },
      orderBy: { major_id: 'asc' },
    });
    expect(cohorts.map((c) => c.generation_number)).toEqual([1, 1]);
    expect(cohorts.map((c) => c.starting_year_level)).toEqual([1, 2]);
    expect(
      (
        await db.student_generations.findUniqueOrThrow({
          where: { id: source },
        })
      ).major_id,
    ).toBeNull();
    expect(
      await db.student_academic_records.findMany({
        where: { student_id: { in: students } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(historical.placements);
    expect(await db.responses.count()).toBe(historical.response_count);
    expect(await db.answers.count()).toBe(historical.answer_count);
    expect(await db.enrollments.count()).toBe(historical.enrollment_count);
    const retry = await applyReviewedPlan(db, plan);
    expect(retry).toEqual(saved);
    expect(
      await db.student_generations.count({
        where: { major_id: { in: [major1, major2] } },
      }),
    ).toBe(2);
  });
});
