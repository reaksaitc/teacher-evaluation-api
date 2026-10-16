import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { baseFixtures } from './utils/base-fixtures';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Academic-year curriculum revisions and global titles (PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let admin: string;
  let otherAdmin: string;
  let studentToken: string;
  let ownerId: bigint;
  let departmentId: bigint;
  let courseId: bigint;
  let majorId: bigint;
  let otherMajorId: bigint;
  let generationId: bigint;
  let lecturerId: bigint;
  let ruleId: string;
  let firstRevisionId: string;
  let oldOfferingId: string;
  let legacyOfferingId: string;
  let history: unknown;
  const years: bigint[] = [];
  const semesters: bigint[] = [];
  const setIds: bigint[] = [];
  const stamp = String(Date.now());
  const auth = () => ({ Authorization: `Bearer ${admin}` });
  const revision = (year: bigint, enabled: boolean) => ({
    effective_academic_year_id: String(year),
    enabled,
  });
  const scope = (
    yearIndex: number,
    level = 2,
    major = majorId,
    revisionId?: string,
  ) => ({
    academic_year_id: String(years[yearIndex]),
    generation_id: String(generationId),
    major_id: String(major),
    year_level: level,
    class_groups: ['A'],
    ...(revisionId !== undefined ? { curriculum_revision_id: revisionId } : {}),
  });
  const offering = (index: number, level = 2, revisionId?: string) => ({
    course_id: String(courseId),
    lecturer_id: String(lecturerId),
    semester_id: String(semesters[index]),
    year_level: level,
    class_type: 'COURSE',
    section_code: `CR-${stamp}-${index}-${level}`,
    group_scopes: [scope(index, level, majorId, revisionId)],
  });
  const snapshot = async () =>
    db.course_offerings.findUniqueOrThrow({
      where: { id: BigInt(oldOfferingId) },
      include: {
        group_scopes: true,
        enrollments: true,
        evaluations: {
          include: {
            evaluation_participants: { include: { assessment_drafts: true } },
            responses: { include: { answers: true } },
          },
        },
      },
    });

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
    const login = async (identifier: string) => {
      const result = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier, password: 'Password123' });
      expect(result.status).toBe(200);
      return result.body.access_token as string;
    };
    admin = await login('admin@itc.edu.kh');
    studentToken = await login('student1@itc.edu.kh');
    const seedAdmin = await db.users.findUniqueOrThrow({
      where: { email: 'admin@itc.edu.kh' },
    });
    lecturerId = (
      await db.users.findUniqueOrThrow({
        where: { email: 'sokdara@itc.edu.kh' },
      })
    ).id;
    const now = new Date();
    departmentId = (
      await db.departments.create({
        data: {
          code: `CR-${stamp}`,
          name: `Curriculum ${stamp}`,
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    ownerId = (
      await db.users.create({
        data: {
          email: `curriculum-${stamp}@test.invalid`,
          password_hash: seedAdmin.password_hash,
          full_name: 'Curriculum test admin',
          role: 'ADMIN',
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    await db.user_departments.create({
      data: { user_id: ownerId, department_id: departmentId, is_primary: true },
    });
    otherAdmin = await login(`curriculum-${stamp}@test.invalid`);
    courseId = (
      await db.courses.create({
        data: {
          course_code: `CR-${stamp}`,
          course_name: 'Curriculum test course',
          department_id: departmentId,
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    majorId = (
      await db.majors.create({
        data: {
          code: `CR-${stamp}`,
          name: 'Tracked major',
          department_id: departmentId,
        },
      })
    ).id;
    otherMajorId = (
      await db.majors.create({
        data: {
          code: `CX-${stamp}`,
          name: 'Legacy major',
          department_id: departmentId,
        },
      })
    ).id;
    for (const [index, startYear] of [
      2024,
      2025,
      2026,
      2027,
      null,
      2025,
    ].entries()) {
      const year = await db.academic_years.create({
        data: { name: `C${index}-${stamp}`, start_year: startYear },
      });
      years.push(year.id);
      semesters.push(
        (
          await db.semesters.create({
            data: {
              academic_year_id: year.id,
              semester_name: 'Curriculum test',
              created_at: now,
              updated_at: now,
            },
          })
        ).id,
      );
    }
    generationId = (
      await db.student_generations.create({
        data: {
          name: `Gen 1`,
          major_id: majorId,
          generation_number: 1,
          entry_academic_year_id: years[0],
        },
      })
    ).id;
    // The migration does not invent a past revision for existing assignments.
    const legacy = await db.course_offerings.create({
      data: {
        course_id: courseId,
        lecturer_id: lecturerId,
        semester_id: semesters[0],
        year_level: 2,
        class_type: 'COURSE',
        section_code: `LEGACY-${stamp}`,
        created_at: now,
        updated_at: now,
      },
    });
    legacyOfferingId = String(legacy.id);
    await db.course_offering_group_scopes.create({
      data: {
        course_offering_id: legacy.id,
        academic_year_id: years[0],
        generation_id: generationId,
        major_id: majorId,
        year_level: 2,
        class_group: 'A',
      },
    });

    const created = await request(app.getHttpServer())
      .post('/api/course-year-rules')
      .set(auth())
      .send({
        course_id: String(courseId),
        major_id: String(majorId),
        year_level: 2,
        effective_academic_year_id: String(years[1]),
      });
    expect(created.status).toBe(201);
    ruleId = created.body.id;
    firstRevisionId = created.body.revisions[0].id;
    const assignment = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send(offering(1, 2, firstRevisionId));
    expect(assignment.status).toBe(201);
    oldOfferingId = assignment.body.id;
    const baseline = await baseFixtures(db);
    const student = await db.users.findUniqueOrThrow({
      where: { email: 'student1@itc.edu.kh' },
    });
    const secondStudent = await db.users.findUniqueOrThrow({
      where: { email: 'student2@itc.edu.kh' },
    });
    await db.enrollments.create({
      data: {
        student_id: student.id,
        course_offering_id: BigInt(oldOfferingId),
        enrolled_at: now,
      },
    });
    const evaluation = await db.evaluations.create({
      data: {
        course_offering_id: BigInt(oldOfferingId),
        survey_version_id: BigInt(baseline.version),
        created_by: seedAdmin.id,
        status: 'CLOSED',
        created_at: now,
        updated_at: now,
      },
    });
    const participant = await db.evaluation_participants.create({
      data: {
        evaluation_id: evaluation.id,
        student_id: student.id,
        survey_version_id: BigInt(baseline.version),
        created_at: now,
      },
    });
    await db.assessment_drafts.create({
      data: {
        participant_id: participant.id,
        survey_version_id: BigInt(baseline.version),
        answers_json: [],
        created_at: now,
        updated_at: now,
      },
    });
    await db.evaluation_participants.create({
      data: {
        evaluation_id: evaluation.id,
        student_id: secondStudent.id,
        survey_version_id: BigInt(baseline.version),
        created_at: now,
        has_submitted: true,
        submitted_at: now,
      },
    });
    await db.responses.create({
      data: {
        created_at: now,
        evaluation_id: evaluation.id,
        survey_version_id: BigInt(baseline.version),
        submitted_at: now,
        answers: {
          create: {
            question_id: BigInt(baseline.question),
            rating_value: 4,
            created_at: now,
          },
        },
      },
    });
    history = await snapshot();
  }, 30000);

  afterAll(async () => {
    try {
      if (db && courseId) {
        const offerings = await db.course_offerings.findMany({
          where: { course_id: courseId },
          select: { id: true },
        });
        const offeringIds = offerings.map((row) => row.id);
        const evaluations = await db.evaluations.findMany({
          where: { course_offering_id: { in: offeringIds } },
          select: { id: true },
        });
        const evaluationIds = evaluations.map((row) => row.id);
        await db.$transaction(async (tx) => {
          await tx.answers.deleteMany({
            where: { responses: { evaluation_id: { in: evaluationIds } } },
          });
          await tx.responses.deleteMany({
            where: { evaluation_id: { in: evaluationIds } },
          });
          await tx.assessment_drafts.deleteMany({
            where: {
              evaluation_participants: { evaluation_id: { in: evaluationIds } },
            },
          });
          await tx.evaluation_participants.deleteMany({
            where: { evaluation_id: { in: evaluationIds } },
          });
          await tx.evaluations.deleteMany({
            where: { id: { in: evaluationIds } },
          });
          await tx.enrollments.deleteMany({
            where: { course_offering_id: { in: offeringIds } },
          });
          await tx.course_offering_group_scopes.deleteMany({
            where: { course_offering_id: { in: offeringIds } },
          });
          await tx.course_offerings.deleteMany({
            where: { id: { in: offeringIds } },
          });
          await tx.curriculum_revisions.deleteMany({
            where: { rule: { course_id: courseId } },
          });
          await tx.course_year_rules.deleteMany({
            where: { course_id: courseId },
          });
          await tx.courses.delete({ where: { id: courseId } });
          await tx.student_generations.delete({ where: { id: generationId } });
          await tx.semesters.deleteMany({ where: { id: { in: semesters } } });
          await tx.academic_years.deleteMany({ where: { id: { in: years } } });
          await tx.majors.deleteMany({
            where: { id: { in: [majorId, otherMajorId] } },
          });
          await tx.survey_versions.deleteMany({
            where: { survey_id: { in: setIds } },
          });
          await tx.surveys.deleteMany({ where: { id: { in: setIds } } });
          await tx.user_departments.deleteMany({ where: { user_id: ownerId } });
          await tx.users.delete({ where: { id: ownerId } });
          await tx.departments.delete({ where: { id: departmentId } });
        });
      }
    } finally {
      if (app) await app.close();
    }
  }, 30000);

  it('pins the first applicable approval and leaves earlier legacy scopes unknown', async () => {
    expect((await snapshot()).group_scopes[0].curriculum_revision_id).toBe(
      BigInt(firstRevisionId),
    );
    const legacy = await db.course_offering_group_scopes.findFirstOrThrow({
      where: { course_offering_id: BigInt(legacyOfferingId) },
    });
    expect(legacy.curriculum_revision_id).toBeNull();
  });

  it('rejects direct edits and deletion of revisioned rule identities', async () => {
    await request(app.getHttpServer())
      .put(`/api/course-year-rules/${ruleId}`)
      .set(auth())
      .send({ year_level: 3 })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/course-year-rules/${ruleId}`)
      .set(auth())
      .expect(409);
  });

  it('rejects missing, null or unstructured effective-year inputs without creating revisions', async () => {
    for (const body of [
      { enabled: true },
      { enabled: true, effective_academic_year_id: null },
      revision(years[4], true),
    ]) {
      await request(app.getHttpServer())
        .post(`/api/course-year-rules/${ruleId}/revisions`)
        .set(auth())
        .send(body)
        .expect(400);
    }
    expect(
      await db.curriculum_revisions.count({
        where: { rule_id: BigInt(ruleId) },
      }),
    ).toBe(1);
  });

  it('rejects same calendar year aliases and backdating using numeric chronology', async () => {
    for (const year of [years[1], years[5], years[0]])
      await request(app.getHttpServer())
        .post(`/api/course-year-rules/${ruleId}/revisions`)
        .set(auth())
        .send(revision(year, false))
        .expect(409);
  });

  it('keeps revision endpoints admin-only', async () => {
    await request(app.getHttpServer())
      .get(`/api/course-year-rules/${ruleId}/revisions`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/course-year-rules/${ruleId}/revisions`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send(revision(years[2], false))
      .expect(403);
  });

  it('rejects unsupported level, pre-effective year, missing year chronology and wrong explicit revision', async () => {
    for (const body of [
      offering(0),
      offering(4),
      offering(1, 3),
      { ...offering(2, 2, '999999999'), section_code: `WRONG-${stamp}` },
    ])
      await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set(auth())
        .send(body)
        .expect(body.semester_id === String(semesters[4]) ? 400 : 409);
  });

  it('returns an explicit applicable revision for frontend selection without guessing past rules', async () => {
    const prior = await request(app.getHttpServer())
      .get(
        `/api/course-year-rules/${ruleId}/applicable?academic_year_id=${years[0]}`,
      )
      .set(auth())
      .expect(200);
    expect(prior.body).toMatchObject({
      policy: 'REVISIONED',
      revision: null,
      enabled: false,
    });
    const current = await request(app.getHttpServer())
      .get(
        `/api/course-year-rules/${ruleId}/applicable?academic_year_id=${years[1]}`,
      )
      .set(auth())
      .expect(200);
    expect(current.body).toMatchObject({
      enabled: true,
      revision: { id: firstRevisionId },
    });
    await request(app.getHttpServer())
      .get(
        `/api/course-year-rules/${ruleId}/applicable?academic_year_id=invalid`,
      )
      .set(auth())
      .expect(400);
  });

  it('rolls back initial rule creation when its effective academic year is unstructured', async () => {
    const before = await db.course_year_rules.count({
      where: { course_id: courseId },
    });
    await request(app.getHttpServer())
      .post('/api/course-year-rules')
      .set(auth())
      .send({
        course_id: String(courseId),
        major_id: String(majorId),
        year_level: 5,
        effective_academic_year_id: String(years[4]),
      })
      .expect(400);
    expect(
      await db.course_year_rules.count({ where: { course_id: courseId } }),
    ).toBe(before);
  });

  it('resolves an omitted revision automatically for new tracked assignments', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send(offering(2))
      .expect(201);
    expect(result.body.group_scopes[0].curriculum_revision_id).toBe(
      firstRevisionId,
    );
    expect(result.body.group_scopes[0].curriculum_revision.enabled).toBe(true);
  });

  it('allows concurrent withdrawal attempts to commit at most one next revision', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/api/course-year-rules/${ruleId}/revisions`)
          .set(auth())
          .send(revision(years[2], false)),
      ),
    );
    expect(results.map((row) => row.status).sort()).toEqual([201, 409]);
    expect(
      await db.curriculum_revisions.count({
        where: { rule_id: BigInt(ruleId) },
      }),
    ).toBe(2);
    expect(
      (
        await db.curriculum_revisions.findMany({
          where: { rule_id: BigInt(ruleId) },
          orderBy: { revision_no: 'asc' },
        })
      ).map((row) => row.revision_no),
    ).toEqual([1, 2]);
  });

  it('rejects new assignments after withdrawal without partial offering or scope writes', async () => {
    const section = `WITHDRAWN-${stamp}`;
    await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send({ ...offering(2), section_code: section })
      .expect(409);
    expect(
      await db.course_offerings.count({ where: { section_code: section } }),
    ).toBe(0);
  });

  it('preserves enrollments, frozen participants, drafts, responses and answers after withdrawal', async () => {
    expect(await snapshot()).toEqual(history);
  });

  it('preserves the pinned revision when same scopes are resent or labels are edited', async () => {
    const result = await request(app.getHttpServer())
      .put(`/api/course-offerings/${oldOfferingId}`)
      .set(auth())
      .send({ section_code: `RENAMED-${stamp}`, group_scopes: [scope(1)] })
      .expect(200);
    expect(result.body.group_scopes[0].curriculum_revision_id).toBe(
      firstRevisionId,
    );
    expect(result.body.group_scopes[0].curriculum_revision.revision_no).toBe(1);
    expect((await snapshot()).group_scopes).toEqual(
      (history as any).group_scopes,
    );
    const same = scope(1, 2, majorId, firstRevisionId);
    same.academic_year_id = `0${same.academic_year_id}`;
    same.generation_id = `0${same.generation_id}`;
    same.major_id = `0${same.major_id}`;
    await request(app.getHttpServer())
      .put(`/api/course-offerings/${oldOfferingId}`)
      .set(auth())
      .send({ group_scopes: [same] })
      .expect(200);
    expect((await snapshot()).group_scopes).toEqual(
      (history as any).group_scopes,
    );
  });

  it('rejects replacement bindings, removed groups and changed semester for pinned offerings', async () => {
    const latest = await db.curriculum_revisions.findFirstOrThrow({
      where: { rule_id: BigInt(ruleId), revision_no: 2 },
    });
    for (const body of [
      { group_scopes: [scope(1, 2, majorId, String(latest.id))] },
      { group_scopes: [] },
      { semester_id: String(semesters[5]), group_scopes: [scope(5)] },
    ])
      await request(app.getHttpServer())
        .put(`/api/course-offerings/${oldOfferingId}`)
        .set(auth())
        .send(body)
        .expect(409);
  });

  it('retains all earlier revisions when a subsequent year explicitly resumes approval', async () => {
    await request(app.getHttpServer())
      .post(`/api/course-year-rules/${ruleId}/revisions`)
      .set(auth())
      .send({
        ...revision(years[3], true),
        reason: 'Approved for the next academic year',
      })
      .expect(201);
    const result = await request(app.getHttpServer())
      .get(`/api/course-year-rules/${ruleId}/revisions`)
      .set(auth())
      .expect(200);
    expect(
      result.body.map((row: any) => [row.effective_start_year, row.enabled]),
    ).toEqual([
      [2025, true],
      [2026, false],
      [2027, true],
    ]);
    const resumed = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send(offering(3))
      .expect(201);
    expect(resumed.body.group_scopes[0].curriculum_revision_id).toBe(
      result.body[2].id,
    );
  });

  it('rejects explicit obsolete revisions in a resumed academic year', async () => {
    await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send({
        ...offering(3, 2, firstRevisionId),
        section_code: `STALE-${stamp}`,
      })
      .expect(409);
  });

  it('protects referenced calendar chronology but permits display-name updates', async () => {
    await request(app.getHttpServer())
      .put(`/api/academic-years/${years[1]}`)
      .set(auth())
      .send({ start_year: 2030 })
      .expect(409);
    await request(app.getHttpServer())
      .put(`/api/academic-years/${years[1]}`)
      .set(auth())
      .send({ name: `REN-${stamp}` })
      .expect(200);
    expect(
      (
        await db.curriculum_revisions.findUniqueOrThrow({
          where: { id: BigInt(firstRevisionId) },
        })
      ).effective_start_year,
    ).toBe(2025);
  });

  it('rejects SQL rewrites of saved revision content and rule identities', async () => {
    await expect(
      db.curriculum_revisions.update({
        where: { id: BigInt(firstRevisionId) },
        data: { enabled: false },
      }),
    ).rejects.toThrow();
    await expect(
      db.course_year_rules.update({
        where: { id: BigInt(ruleId) },
        data: { year_level: 5 },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.curriculum_revisions.findUniqueOrThrow({
          where: { id: BigInt(firstRevisionId) },
        })
      ).enabled,
    ).toBe(true);
  });

  it('rejects new assignments for an untracked major instead of inventing approval', async () => {
    await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send({
        ...offering(2),
        section_code: `UNTRACKED-${stamp}`,
        group_scopes: [scope(2, 2, otherMajorId)],
      })
      .expect(409);
    expect(
      await db.course_offerings.count({
        where: {
          course_id: courseId,
          semester_id: semesters[2],
          section_code: `UNTRACKED-${stamp}`,
        },
      }),
    ).toBe(0);
  });

  it('requires a new rule identity when moving a course to another year level', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/course-year-rules')
      .set(auth())
      .send({
        course_id: String(courseId),
        major_id: String(majorId),
        year_level: 3,
        effective_academic_year_id: String(years[2]),
      })
      .expect(201);
    const assignment = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send(offering(2, 3))
      .expect(201);
    expect(assignment.body.group_scopes[0].curriculum_revision_id).toBe(
      created.body.revisions[0].id,
    );
    expect(
      (
        await db.course_year_rules.findUniqueOrThrow({
          where: { id: BigInt(ruleId) },
        })
      ).year_level,
    ).toBe(2);
  });

  it('retains global case-insensitive title ownership across admins and departments', async () => {
    const title = `Curriculum Title ${stamp}`;
    const created = await request(app.getHttpServer())
      .post('/api/surveys')
      .set(auth())
      .send({ title })
      .expect(201);
    setIds.push(BigInt(created.body.id));
    await request(app.getHttpServer())
      .post('/api/surveys')
      .set('Authorization', `Bearer ${otherAdmin}`)
      .send({ title: `  ${title.toUpperCase()}  ` })
      .expect(409);
  });

  it('rejects rename collisions and keeps archived titles reserved without merging history', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/surveys')
      .set('Authorization', `Bearer ${otherAdmin}`)
      .send({ title: `Other Curriculum ${stamp}` })
      .expect(201);
    setIds.push(BigInt(created.body.id));
    await request(app.getHttpServer())
      .put(`/api/surveys/${created.body.id}`)
      .set(auth())
      .send({ title: `curriculum title ${stamp}` })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/surveys/${setIds[0]}/archive`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/surveys')
      .set('Authorization', `Bearer ${otherAdmin}`)
      .send({ title: `Curriculum Title ${stamp}` })
      .expect(409);
    expect(await db.surveys.count({ where: { id: { in: setIds } } })).toBe(2);
    expect(
      await db.survey_versions.count({ where: { survey_id: { in: setIds } } }),
    ).toBe(2);
  });

  it('serializes concurrent case-insensitive title creation across different admins', async () => {
    const title = `Concurrent Curriculum ${stamp}`;
    const results = await Promise.all([
      request(app.getHttpServer())
        .post('/api/surveys')
        .set(auth())
        .send({ title }),
      request(app.getHttpServer())
        .post('/api/surveys')
        .set('Authorization', `Bearer ${otherAdmin}`)
        .send({ title: title.toUpperCase() }),
    ]);
    for (const result of results)
      if (result.status === 201) setIds.push(BigInt(result.body.id));
    expect(results.map((row) => row.status).sort()).toEqual([201, 409]);
    expect(
      await db.surveys.count({
        where: { title: { equals: title, mode: 'insensitive' } },
      }),
    ).toBe(1);
  });
});
