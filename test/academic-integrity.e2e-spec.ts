import {
  INestApplication,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StudentGenerationsService } from '../src/student-generations/student-generations.service';
import { AcademicYearsService } from '../src/academic-years/academic-years.service';
import { SURVEY_TITLE_TRIM_CHARACTERS } from '../src/common/utils/survey-title.util';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Academic integrity safeguards (real PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let token: string;
  let owner: bigint,
    lecturer: bigint,
    department: bigint,
    major: bigint,
    course: bigint;
  let year: bigint,
    semester: bigint,
    generation: bigint,
    profile: bigint,
    student: bigint;
  let placement: bigint,
    offering: bigint,
    scope: bigint,
    rule: bigint,
    evaluation: bigint,
    target: bigint;
  const stamp = `${Date.now()}`;
  const years: bigint[] = [],
    semesters: bigint[] = [],
    generations: bigint[] = [],
    offerings: bigint[] = [],
    surveys: bigint[] = [];
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let previousActive: bigint[] = [];
  const now = new Date();
  const surveyData = (title: string) => ({
    title,
    created_by: owner,
    created_at: now,
    updated_at: now,
  });
  const offeringData = () => ({
    course_id: course,
    lecturer_id: lecturer,
    semester_id: semester,
    year_level: 1,
    class_type: 'COURSE' as const,
    section_code: 'BASE',
    created_at: now,
    updated_at: now,
  });
  async function newYear() {
    const row = await db.academic_years.create({
      data: { name: `AI${years.length}-${stamp}`, start_year: 2026 },
    });
    years.push(row.id);
    return row.id;
  }
  async function createSet(title: string) {
    const response = await api()
      .post('/api/surveys')
      .set(auth())
      .send({ title });
    if (response.status === 201) surveys.push(BigInt(response.body.id));
    return response;
  }
  async function directOffering(
    data: Partial<Prisma.course_offeringsUncheckedCreateInput>,
  ) {
    const row = await db.course_offerings.create({
      data: { ...offeringData(), ...data },
    });
    offerings.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    db = app.get(PrismaService);
    previousActive = (
      await db.academic_years.findMany({ where: { is_active: true } })
    ).map((y) => y.id);
    await db.academic_years.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });
    const admin = await db.users.findUniqueOrThrow({
      where: { email: 'admin@itc.edu.kh' },
    });
    owner = admin.id;
    lecturer = (
      await db.users.findUniqueOrThrow({
        where: { email: 'sokdara@itc.edu.kh' },
      })
    ).id;
    const login = await api()
      .post('/api/auth/login')
      .send({ identifier: admin.email, password: 'Password123' });
    expect(login.status).toBe(200);
    token = login.body.access_token;
    department = (
      await db.departments.create({
        data: { code: `AI-${stamp}`, name: `Integrity ${stamp}` },
      })
    ).id;
    major = (
      await db.majors.create({
        data: {
          code: `AI-${stamp}`,
          name: `Integrity ${stamp}`,
          department_id: department,
        },
      })
    ).id;
    course = (
      await db.courses.create({
        data: {
          course_code: `AI-${stamp}`,
          course_name: 'Integrity fixture',
          department_id: department,
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    year = await newYear();
    semester = (
      await db.semesters.create({
        data: {
          academic_year_id: year,
          semester_name: `Integrity ${stamp}`,
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    semesters.push(semester);
    generation = (
      await db.student_generations.create({
        data: {
          name: `Integrity ${stamp}`,
          entry_academic_year_id: year,
          starting_year_level: 1,
        },
      })
    ).id;
    generations.push(generation);
    student = (
      await db.users.create({
        data: {
          email: `integrity-${stamp}@test.invalid`,
          full_name: 'Integrity student',
          role: 'STUDENT',
          password_hash: admin.password_hash,
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    profile = (
      await db.students.create({
        data: {
          user_id: student,
          student_code: `AI-${stamp}`,
          generation_id: generation,
        },
      })
    ).id;
    placement = (
      await db.student_academic_records.create({
        data: {
          student_id: profile,
          academic_year_id: year,
          major_id: major,
          year_level: 1,
          class_group: 'A',
        },
      })
    ).id;
    offering = (await directOffering({})).id;
    scope = (
      await db.course_offering_group_scopes.create({
        data: {
          course_offering_id: offering,
          academic_year_id: year,
          generation_id: generation,
          major_id: major,
          year_level: 1,
          class_group: 'A',
        },
      })
    ).id;
    rule = (
      await db.course_year_rules.create({
        data: { course_id: course, major_id: major, year_level: 1 },
      })
    ).id;
    const set = await db.surveys.create({
      data: surveyData(`Integrity fixture ${stamp}`),
    });
    surveys.push(set.id);
    const version = await db.survey_versions.create({
      data: {
        survey_id: set.id,
        version_no: 1,
        status: 'DRAFT',
        created_by: owner,
        created_at: now,
      },
    });
    evaluation = (
      await db.evaluations.create({
        data: {
          course_offering_id: offering,
          survey_version_id: version.id,
          created_by: owner,
          status: 'DRAFT',
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    target = (
      await db.evaluation_group_targets.create({
        data: {
          evaluation_id: evaluation,
          academic_year_id: year,
          generation_id: generation,
          major_id: major,
          year_level: 1,
          class_group: 'A',
        },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    if (db) {
      if (evaluation) {
        await db.evaluation_group_targets.deleteMany({
          where: { evaluation_id: evaluation },
        });
        await db.evaluations.delete({ where: { id: evaluation } });
      }
      await db.course_offering_group_scopes.deleteMany({
        where: { course_offering_id: { in: offerings } },
      });
      await db.course_offerings.deleteMany({
        where: { id: { in: offerings } },
      });
      await db.survey_versions.deleteMany({
        where: { survey_id: { in: surveys } },
      });
      await db.surveys.deleteMany({ where: { id: { in: surveys } } });
      if (placement)
        await db.student_academic_records.delete({ where: { id: placement } });
      if (profile) await db.students.delete({ where: { id: profile } });
      if (student) await db.users.delete({ where: { id: student } });
      await db.student_generations.deleteMany({
        where: { id: { in: generations } },
      });
      if (course) {
        await db.curriculum_revisions.deleteMany({
          where: { rule: { course_id: course } },
        });
        await db.course_year_rules.deleteMany({ where: { course_id: course } });
      }
      if (course) await db.courses.delete({ where: { id: course } });
      if (major) await db.majors.delete({ where: { id: major } });
      if (department)
        await db.departments.delete({ where: { id: department } });
      await db.semesters.deleteMany({ where: { id: { in: semesters } } });
      await db.academic_years.deleteMany({ where: { id: { in: years } } });
    }
    await db.academic_years.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });
    if (previousActive.length)
      await db.academic_years.update({
        where: { id: previousActive[0] },
        data: { is_active: true },
      });
    if (app) await app.close();
  }, 30000);

  describe('Active academic years', () => {
    it('allows multiple inactive years and rejects a second direct activation atomically', async () => {
      const first = await newYear(),
        second = await newYear();
      expect(
        await db.academic_years.count({ where: { is_active: true } }),
      ).toBe(0);
      await db.academic_years.update({
        where: { id: first },
        data: { is_active: true },
      });
      try {
        await expect(
          db.academic_years.update({
            where: { id: second },
            data: { is_active: true },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
        expect(
          (await db.academic_years.findUniqueOrThrow({ where: { id: second } }))
            .is_active,
        ).toBe(false);
        expect(
          await db.academic_years.count({ where: { is_active: true } }),
        ).toBe(1);
      } finally {
        await db.academic_years.update({
          where: { id: first },
          data: { is_active: false },
        });
      }
    });
    it('activation races keep at most one active year and can be deliberately retried', async () => {
      const first = await newYear(),
        second = await newYear();
      try {
        const outcomes = await Promise.all(
          [first, second].map((id) =>
            api()
              .put(`/api/academic-years/${id}`)
              .set(auth())
              .send({ is_active: true }),
          ),
        );
        expect(outcomes.some((r) => r.status === 200)).toBe(true);
        expect(outcomes.every((r) => [200, 409].includes(r.status))).toBe(true);
        expect(
          await db.academic_years.count({ where: { is_active: true } }),
        ).toBe(1);
        expect(
          (
            await api()
              .put(`/api/academic-years/${second}`)
              .set(auth())
              .send({ is_active: true })
          ).status,
        ).toBe(200);
        expect(
          (await db.academic_years.findUniqueOrThrow({ where: { id: first } }))
            .is_active,
        ).toBe(false);
        expect(
          (await db.academic_years.findUniqueOrThrow({ where: { id: second } }))
            .is_active,
        ).toBe(true);
      } finally {
        await db.academic_years.updateMany({
          where: { id: { in: [first, second] } },
          data: { is_active: false },
        });
      }
    });
    it('retains ordinary duplicate-name conflicts', async () => {
      const existing = await db.academic_years.findUniqueOrThrow({
        where: { id: year },
      });
      const response = await api()
        .post('/api/academic-years')
        .set(auth())
        .send({ name: existing.name });
      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });
  });

  describe('Literal normalized title identity', () => {
    it.each(['%', '_', '\\'])(
      'keeps %s literal on create and update',
      async (symbol) => {
        const ordinary = await createSet(
          `Symbols A ${stamp}-${symbol.charCodeAt(0)}`,
        );
        expect(ordinary.status).toBe(201);
        const literal = await createSet(
          `Symbols ${symbol} ${stamp}-${symbol.charCodeAt(0)}`,
        );
        expect(literal.status).toBe(201);
        const other = await createSet(
          `Replacement ${stamp}-${symbol.charCodeAt(0)}`,
        );
        expect(other.status).toBe(201);
        const renamed = await api()
          .put(`/api/surveys/${other.body.id}`)
          .set(auth())
          .send({ title: `Changed ${symbol} ${stamp}` });
        expect(renamed.status).toBe(200);
        const duplicate = await api()
          .put(`/api/surveys/${other.body.id}`)
          .set(auth())
          .send({ title: literal.body.title.toUpperCase() });
        expect(duplicate.status).toBe(409);
        expect(
          (
            await db.surveys.findUniqueOrThrow({
              where: { id: BigInt(other.body.id) },
            })
          ).title,
        ).toBe(`Changed ${symbol} ${stamp}`);
      },
    );
    it('preserves Unicode display titles and blocks trimmed/case variants globally', async () => {
      const title = `គ្រូ🙂 Unicode ${stamp}`;
      const created = await createSet(`\u00a0\ufeff${title}\u3000`);
      expect(created.status).toBe(201);
      expect(created.body.title).toBe(title);
      expect((await createSet(`\t${title.toUpperCase()}\n`)).status).toBe(409);
      await expect(
        db.surveys.create({
          data: surveyData(`\u2003${title.toUpperCase()}\u202f`),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
    it('reserves archived titles and prevents a rename into their identity', async () => {
      const archived = await createSet(`Archive ${stamp}`),
        other = await createSet(`Rename ${stamp}`);
      expect(archived.status).toBe(201);
      expect(other.status).toBe(201);
      expect(
        (
          await api()
            .post(`/api/surveys/${archived.body.id}/archive`)
            .set(auth())
            .send({})
        ).status,
      ).toBe(200);
      expect((await createSet(` ARCHIVE ${stamp} `)).status).toBe(409);
      expect(
        (
          await api()
            .put(`/api/surveys/${other.body.id}`)
            .set(auth())
            .send({ title: `archive ${stamp}` })
        ).status,
      ).toBe(409);
      await expect(
        db.surveys.create({ data: surveyData(`ARCHIVE ${stamp}`) }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
    it('matches JavaScript trim for every supported boundary whitespace character', async () => {
      for (const character of SURVEY_TITLE_TRIM_CHARACTERS) {
        const title = `${character}AB${character}`;
        const [row] = await db.$queryRaw<
          { key: string }[]
        >`SELECT public.survey_title_key(${title}) AS key`;
        expect(row.key).toBe(title.trim().toLowerCase());
      }
    });
    it('rejects whitespace-only titles through API and direct writes', async () => {
      expect((await createSet('\u00a0\ufeff\t\u3000')).status).toBe(400);
      await expect(
        db.surveys.create({ data: surveyData('\u00a0\ufeff\t\u3000') }),
      ).rejects.toThrow('surveys_title_nonblank_check');
    });
    it('concurrent case-equivalent creation commits one set and one initial version', async () => {
      const title = `Race ${stamp}`;
      const outcomes = await Promise.all([
        createSet(title),
        createSet(title.toUpperCase()),
      ]);
      expect(outcomes.filter((r) => r.status === 201)).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 409)).toHaveLength(1);
      const id = BigInt(outcomes.find((r) => r.status === 201)!.body.id);
      expect(await db.survey_versions.count({ where: { survey_id: id } })).toBe(
        1,
      );
    });
  });

  describe('Nullable offering identity', () => {
    it.each(Array.from({ length: 8 }, (_, mask) => mask))(
      'rejects duplicate assignment for nullable-key mask %i',
      async (mask) => {
        const maskSemester = await db.semesters.create({
          data: {
            academic_year_id: year,
            semester_name: `Mask ${mask}-${stamp}`,
            created_at: now,
            updated_at: now,
          },
        });
        semesters.push(maskSemester.id);
        const key = {
          semester_id: maskSemester.id,
          year_level: mask & 1 ? null : 2,
          class_type: mask & 2 ? null : ('TP' as const),
          section_code: mask & 4 ? null : `M${mask}`,
        };
        const first = await directOffering(key);
        await expect(
          db.course_offerings.create({ data: { ...offeringData(), ...key } }),
        ).rejects.toMatchObject({ code: 'P2002' });
        expect(
          await db.course_offerings.count({
            where: {
              course_id: course,
              lecturer_id: lecturer,
              ...key,
            },
          }),
        ).toBe(1);
        expect(
          (
            await db.course_offerings.findUniqueOrThrow({
              where: { id: first.id },
            })
          ).year_level,
        ).toBe(key.year_level);
      },
    );
    it('treats changed, blank and unknown class labels as the same assignment identity', async () => {
      await directOffering({
        year_level: 5,
        class_type: 'TD',
        section_code: 'Distinct',
      });
      for (const section_code of ['distinct', '', null])
        await expect(
          db.course_offerings.create({
            data: {
              ...offeringData(),
              year_level: 5,
              class_type: 'TD',
              section_code,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });
    it('API rejects duplicate nullable levels and concurrent creation returns a useful conflict', async () => {
      await db.course_year_rules.create({
        data: {
          course_id: course,
          major_id: major,
          year_level: 4,
          revisions: {
            create: {
              revision_no: 1,
              effective_academic_year_id: year,
              effective_start_year: 2026,
              enabled: true,
            },
          },
        },
      });

      const input = {
        year_level: 4,
        course_id: String(course),
        lecturer_id: String(lecturer),
        semester_id: String(semester),
        class_type: 'COURSE',
        section_code: `API-${stamp}`,
      };
      const outcomes = await Promise.all(
        [0, 1].map(() =>
          api().post('/api/course-offerings').set(auth()).send(input),
        ),
      );
      for (const response of outcomes)
        if (response.status === 201) offerings.push(BigInt(response.body.id));
      expect(outcomes.filter((r) => r.status === 201)).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 409)).toHaveLength(1);
      expect(
        (await api().post('/api/course-offerings').set(auth()).send(input))
          .status,
      ).toBe(409);
    });
  });

  describe('Levels and ranges', () => {
    const columns = [
      ['student_generations', 'starting_year_level', () => generation],
      ['student_academic_records', 'year_level', () => placement],
      ['course_year_rules', 'year_level', () => rule],
      ['course_offering_group_scopes', 'year_level', () => scope],
      ['evaluation_group_targets', 'year_level', () => target],
      ['course_offerings', 'year_level', () => offering],
    ] as const;
    it.each(columns)(
      'direct writes reject both level bounds on %s.%s without changing the row',
      async (table, column, id) => {
        const snapshot = () =>
          db.$queryRawUnsafe(
            `SELECT row_to_json(t)::text AS row FROM "${table}" t WHERE id=$1`,
            id(),
          );
        const before = await snapshot();
        for (const invalid of [0, 6]) {
          // Target identity is immutable on UPDATE; INSERT exercises its level CHECK.
          const sql =
            table === 'evaluation_group_targets'
              ? `INSERT INTO evaluation_group_targets (evaluation_id,academic_year_id,generation_id,major_id,class_group,year_level) SELECT evaluation_id,academic_year_id,generation_id,major_id,'INVALID',$1 FROM evaluation_group_targets WHERE id=$2`
              : `UPDATE "${table}" SET "${column}"=$1 WHERE id=$2`;
          await expect(
            db.$executeRawUnsafe(sql, invalid, id()),
          ).rejects.toThrow('check constraint');
        }
        expect(await snapshot()).toEqual(before);
      },
    );
    it('generation create/update reject level 6, accept level 5 and default to level 1', async () => {
      const input = {
        major_id: String(major),
        generation_number: 101,
        entry_academic_year_id: String(year),
        starting_year_level: 6,
      };
      expect(
        (await api().post('/api/student-generations').set(auth()).send(input))
          .status,
      ).toBe(400);
      expect(
        (
          await api()
            .put(`/api/student-generations/${generation}`)
            .set(auth())
            .send({ starting_year_level: 6 })
        ).status,
      ).toBe(400);
      const accepted = await api()
        .post('/api/student-generations')
        .set(auth())
        .send({ ...input, starting_year_level: 5 });
      expect(accepted.status).toBe(201);
      generations.push(BigInt(accepted.body.id));
      const defaulted = await api()
        .post('/api/student-generations')
        .set(auth())
        .send({
          major_id: String(major),
          generation_number: 102,
          entry_academic_year_id: String(year),
        });
      expect(defaulted.status).toBe(201);
      generations.push(BigInt(defaulted.body.id));
      expect(defaulted.body.starting_year_level).toBe(1);
    });
    it('service-level database violations map to 400 while history errors retain their meaning', async () => {
      const unused = await db.student_generations.create({
        data: {
          name: 'Gen 103',
          major_id: major,
          generation_number: 103,
          entry_academic_year_id: year,
        },
      });
      generations.push(unused.id);
      const unboundYear = await newYear();

      await expect(
        app
          .get(StudentGenerationsService)
          .update(unused.id, { starting_year_level: 6 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        app.get(AcademicYearsService).update(unboundYear, { start_year: 2201 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        (await db.academic_years.findUniqueOrThrow({ where: { id: year } }))
          .start_year,
      ).toBe(2026);
    });
    it('numeric starting-year bounds reject invalid direct writes and preserve NULL', async () => {
      const unboundYear = await newYear();
      const original = await db.academic_years.findUniqueOrThrow({
        where: { id: unboundYear },
      });
      for (const invalid of [1899, 2201])
        await expect(
          db.academic_years.update({
            where: { id: unboundYear },
            data: { start_year: invalid },
          }),
        ).rejects.toThrow('academic_years_start_year_check');
      await db.academic_years.update({
        where: { id: unboundYear },
        data: { start_year: null },
      });
      expect(
        (
          await db.academic_years.findUniqueOrThrow({
            where: { id: unboundYear },
          })
        ).start_year,
      ).toBeNull();
      await db.academic_years.update({
        where: { id: unboundYear },
        data: { start_year: original.start_year },
      });
    });
    it.each(['academic_years', 'semesters', 'evaluations'])(
      'rejects equal/reversed complete ranges and allows unknown/partial endpoints on %s',
      async (table) => {
        const timestamp = table === 'evaluations',
          start = timestamp ? 'start_at' : 'start_date',
          end = timestamp ? 'end_at' : 'end_date';
        const id = timestamp
          ? evaluation
          : table === 'semesters'
            ? semester
            : year;
        const before = await db.$queryRawUnsafe(
          `SELECT "${start}","${end}" FROM "${table}" WHERE id=$1`,
          id,
        );
        for (const ending of ['2026-10-14', '2026-10-13'])
          await expect(
            db.$executeRawUnsafe(
              `UPDATE "${table}" SET "${start}"=$1::${timestamp ? 'timestamp' : 'date'},"${end}"=$2::${timestamp ? 'timestamp' : 'date'} WHERE id=$3`,
              '2026-10-14',
              ending,
              id,
            ),
          ).rejects.toThrow('check constraint');
        expect(
          await db.$queryRawUnsafe(
            `SELECT "${start}","${end}" FROM "${table}" WHERE id=$1`,
            id,
          ),
        ).toEqual(before);
        await db.$executeRawUnsafe(
          `UPDATE "${table}" SET "${start}"='2026-10-14',"${end}"=NULL WHERE id=$1`,
          id,
        );
        await db.$executeRawUnsafe(
          `UPDATE "${table}" SET "${start}"=NULL,"${end}"=NULL WHERE id=$1`,
          id,
        );
      },
    );
    it.each(['academic-years', 'semesters'])(
      '%s create/update compare the stored UTC day and preserve timestamps only on evaluations',
      async (route) => {
        const input =
          route === 'academic-years'
            ? { name: `Day-${stamp}` }
            : {
                academic_year_id: Number(year),
                semester_name: `Day-${stamp}`,
                semester_number: 1,
              };
        const invalid = await api()
          .post(`/api/${route}`)
          .set(auth())
          .send({
            ...input,
            start_date: '2026-10-14T08:00:00Z',
            end_date: '2026-10-14T09:00:00Z',
          });
        expect(invalid.status).toBe(400);
        const valid = await api()
          .post(`/api/${route}`)
          .set(auth())
          .send({
            ...input,
            start_date: '2026-10-14T00:30:00+07:00',
            end_date: '2026-10-14T23:30:00-05:00',
          });
        expect(valid.status).toBe(201);
        (route === 'academic-years' ? years : semesters).push(
          BigInt(valid.body.id),
        );
        expect(valid.body.start_date).toBe('2026-10-13T00:00:00.000Z');
        expect(valid.body.end_date).toBe('2026-10-15T00:00:00.000Z');
        const update = await api()
          .put(`/api/${route}/${valid.body.id}`)
          .set(auth())
          .send({
            start_date: '2026-10-14T08:00:00Z',
            end_date: '2026-10-14T09:00:00Z',
          });
        expect(update.status).toBe(400);
        const cleared = await api()
          .put(`/api/${route}/${valid.body.id}`)
          .set(auth())
          .send({ start_date: null, end_date: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.start_date).toBeNull();
        expect(cleared.body.end_date).toBeNull();
      },
    );
    it('evaluation scheduling keeps valid same-day timestamp precision', async () => {
      const response = await api()
        .put(`/api/evaluations/${evaluation}/schedule`)
        .set(auth())
        .send({
          start_at: '2026-10-14T08:00:00Z',
          end_at: '2026-10-14T09:00:00Z',
        });
      expect(response.status).toBe(200);
      expect(response.body.start_at).toBe('2026-10-14T08:00:00.000Z');
      expect(response.body.end_at).toBe('2026-10-14T09:00:00.000Z');
    });
  });

  describe('Exact migration refusal on isolated temporary records', () => {
    const migration = readFileSync(
      'prisma/migrations/20261014020000_enforce_academic_integrity/migration.sql',
      'utf8',
    );
    const tables: Record<string, string> = {
      academic_years:
        'is_active boolean, start_year int, start_date date, end_date date',
      surveys: 'title text',
      course_offerings:
        'course_id bigint, lecturer_id bigint, semester_id bigint, year_level int, class_type text, section_code text',
      student_generations: 'starting_year_level int',
      student_academic_records: 'year_level int',
      course_year_rules: 'year_level int',
      course_offering_group_scopes: 'year_level int',
      evaluation_group_targets: 'year_level int',
      semesters: 'start_date date, end_date date',
      evaluations: 'start_at timestamp, end_at timestamp',
    };
    const conflicts = [
      [
        'academic_years',
        'INSERT INTO academic_years (is_active) VALUES (TRUE),(TRUE)',
        'multiple active',
      ],
      [
        'surveys',
        "INSERT INTO surveys (title) VALUES ('Title'),(U&'\\00A0TITLE\\3000')",
        'duplicate normalized',
      ],
      [
        'surveys',
        "INSERT INTO surveys (title) VALUES (U&'\\FEFF\\0009')",
        'blank or duplicate',
      ],
      [
        'course_offerings',
        'INSERT INTO course_offerings VALUES (1,1,1,NULL,NULL,NULL),(1,1,1,NULL,NULL,NULL)',
        'duplicate offering',
      ],
      [
        'academic_years',
        'INSERT INTO academic_years (start_year) VALUES (2201)',
        'invalid year level or numeric',
      ],
      ...[
        'student_generations',
        'student_academic_records',
        'course_year_rules',
        'course_offering_group_scopes',
        'evaluation_group_targets',
        'course_offerings',
      ].map((table) => [
        table,
        `INSERT INTO ${table} (${table === 'student_generations' ? 'starting_year_level' : 'year_level'}) VALUES (6)`,
        'invalid year level',
      ]),
      ...['academic_years', 'semesters', 'evaluations'].map((table) => [
        table,
        `INSERT INTO ${table} (${table === 'evaluations' ? 'start_at,end_at' : 'start_date,end_date'}) VALUES ('2026-10-14','2026-10-14')`,
        'invalid date range',
      ]),
    ];
    it.each(conflicts)(
      'refuses conflicting %s records atomically (%s)',
      async (table, insert, reason) => {
        await db.$transaction(
          async (tx) => {
            for (const [name, columns] of Object.entries(tables))
              await tx.$executeRawUnsafe(
                `CREATE TEMP TABLE ${name} (${columns}) ON COMMIT DROP`,
              );
            await tx.$executeRawUnsafe(insert);
            const snapshot = () =>
              tx.$queryRawUnsafe(
                `SELECT row_to_json(t)::text AS row FROM ${table} t ORDER BY row_to_json(t)::text`,
              );
            const before = await snapshot();
            await tx.$executeRawUnsafe('SAVEPOINT constraint_preflight');
            await expect(tx.$executeRawUnsafe(migration)).rejects.toThrow(
              reason,
            );
            await tx.$executeRawUnsafe(
              'ROLLBACK TO SAVEPOINT constraint_preflight',
            );
            expect(await snapshot()).toEqual(before);
            const [indexes] = await tx.$queryRaw<
              { n: number }[]
            >`SELECT COUNT(*)::int AS n FROM pg_index WHERE indrelid=to_regclass('pg_temp.academic_years')`;
            expect(indexes.n).toBe(0);
          },
          { timeout: 20000 },
        );
      },
    );
    it('retains all expected validated database constraints and offering NULL-equality semantics', async () => {
      const [index] = await db.$queryRaw<
        { nulls_equal: boolean }[]
      >`SELECT indnullsnotdistinct AS nulls_equal FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='course_offerings_assignment_unique_idx' AND c.relnamespace='public'::regnamespace`;
      expect(index.nulls_equal).toBe(true);
      const checks = await db.$queryRaw<
        { name: string; valid: boolean }[]
      >`SELECT conname AS name,convalidated AS valid FROM pg_constraint WHERE conname IN ('student_generations_starting_level_check','student_academic_records_level_check','course_year_rules_level_check','course_offering_group_scopes_level_check','evaluation_group_targets_level_check','course_offerings_level_check','academic_years_start_year_check','academic_years_date_order_check','semesters_date_order_check','evaluations_date_order_check','surveys_title_nonblank_check') AND connamespace='public'::regnamespace`;
      expect(checks).toHaveLength(11);
      expect(checks.every((c) => c.valid)).toBe(true);
    });
  });
});
