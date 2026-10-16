import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AcademicYearSetupService } from '../src/academic-years/academic-year-setup.service';
import { AssignmentCreationService } from '../src/reviewed-workflows/assignment-creation.service';
import { BulkEvaluationsService } from '../src/reviewed-workflows/bulk-evaluations.service';
import { failAfterWrite } from './utils/fail-after-write';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Backend alignment contracts and atomicity', () => {
  let app: INestApplication,
    db: PrismaService,
    token: string,
    studentToken: string;
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ids: Record<string, string> = {};
  let rows: any[], preview: any, bulk: any, bulkInput: any;
  const now = () => new Date(Date.now() - 60_000).toISOString();
  const later = () => new Date(Date.now() + 3600_000).toISOString();
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body: object) =>
    api().post(`/api/${path}`).set(auth()).send(body);
  const scope = (major: string, generation: string, group: string) => ({
    academic_year_id: ids.year,
    generation_id: generation,
    major_id: major,
    year_level: 2,
    class_groups: [group],
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    db = app.get(PrismaService);
    const password_hash = await bcrypt.hash('Password123', 10);
    const admin = await db.users.create({
      data: {
        email: `alignment-${stamp}@example.edu`,
        full_name: 'Alignment administrator',
        password_hash,
        role: 'ADMIN',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    ids.admin = String(admin.id);
    const login = await api()
      .post('/api/auth/login')
      .send({ identifier: admin.email, password: 'Password123' });
    expect(login.status).toBe(200);
    token = login.body.access_token;
    const lecturer = await db.users.create({
      data: {
        email: `alignment-lecturer-${stamp}@example.edu`,
        full_name: 'Alignment lecturer',
        password_hash,
        role: 'LECTURER',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    ids.lecturer = String(lecturer.id);
    const department = await db.departments.create({
      data: { code: `AX${stamp}`.slice(0, 30), name: `Alignment ${stamp}` },
    });
    ids.department = String(department.id);
    for (const code of ['DS', 'FE']) {
      const major = await db.majors.create({
        data: {
          code: `${code}${stamp}`.slice(0, 30),
          name: code,
          department_id: department.id,
        },
      });
      ids[code] = String(major.id);
    }
    // Chronology unique to this rehearsal, independent of seeded active-year data.
    const used = new Set(
      (await db.academic_years.findMany({ select: { start_year: true } })).map(
        (y) => y.start_year,
      ),
    );
    const start = Array.from({ length: 98 }, (_, i) => 2100 + i).find(
      (y) => ![y - 1, y, y + 1].some((n) => used.has(n)),
    )!;
    ids.start = String(start);
    const year = await post('academic-years/setup', {
      name: `AX-${stamp}`.slice(0, 20),
      start_year: start,
      is_active: true,
      create_semesters: true,
      idempotency_key: `year-${stamp}`,
    });
    expect(year.status).toBe(201);
    expect(year.body.semesters).toHaveLength(2);
    ids.year = year.body.id;
    ids.semester = year.body.semesters.find(
      (s: any) => s.semester_number === 1,
    ).id;
    for (const code of ['DS', 'FE']) {
      const cohort = await post('student-generations', {
        major_id: ids[code],
        generation_number: 1,
        entry_academic_year_id: ids.year,
        starting_year_level: 2,
      });
      expect(cohort.status).toBe(201);
      expect(cohort.body.generation_number).toBe(1);
      ids[`${code}Generation`] = cohort.body.id;
      const student = await post('students', {
        student_code: `${code}-${stamp}`,
        full_name: `${code} student`,
        password: 'Password123',
        generation_id: cohort.body.id,
        academic_year_id: ids.year,
        major_id: ids[code],
        year_level: 2,
        class_group: code === 'DS' ? 'A' : 'C',
      });
      expect(student.status).toBe(201);
      ids[`${code}Student`] = String(student.body.id);
      ids[`${code}User`] = String(student.body.user_id);
    }
    const loginStudent = await api()
      .post('/api/auth/login')
      .send({ identifier: `DS-${stamp}`, password: 'Password123' });
    expect(loginStudent.status).toBe(200);
    studentToken = loginStudent.body.access_token;
    const course = await post('courses', {
      department_id: Number(ids.department),
      course_name: `Alignment course ${stamp}`,
      idempotency_key: `course-${stamp}`,
    });
    expect(course.status).toBe(201);
    ids.course = course.body.id;
    for (const code of ['DS', 'FE']) {
      const rule = await post('course-year-rules', {
        course_id: ids.course,
        major_id: ids[code],
        year_level: 2,
        effective_academic_year_id: ids.year,
      });
      expect(rule.status).toBe(201);
    }
    const survey = await db.surveys.create({
      data: {
        title: `Alignment questions ${stamp}`,
        created_by: admin.id,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    ids.survey = String(survey.id);
    const version = await db.survey_versions.create({
      data: {
        survey_id: survey.id,
        version_no: 1,
        created_by: admin.id,
        created_at: new Date(),
        questions: {
          create: [
            {
              question_text: 'Rating',
              question_type: 'RATING',
              display_order: 1,
              min_rating: 1,
              max_rating: 5,
              created_at: new Date(),
              updated_at: new Date(),
            },
            {
              question_text: 'Comment',
              question_type: 'TEXT',
              display_order: 2,
              created_at: new Date(),
              updated_at: new Date(),
            },
            {
              question_text: 'Choice',
              question_type: 'MULTIPLE_CHOICE',
              display_order: 3,
              created_at: new Date(),
              updated_at: new Date(),
              question_options: {
                create: [
                  { option_text: 'Clear', display_order: 1 },
                  { option_text: 'Unclear', display_order: 2 },
                ],
              },
            },
          ],
        },
      },
    });
    ids.version = String(version.id);
    rows = [
      {
        course_id: ids.course,
        lecturer_id: ids.lecturer,
        semester_id: ids.semester,
        year_level: 2,
        class_type: 'COURSE',
        section_code: 'Shared class',
        group_scopes: [
          scope(ids.DS, ids.DSGeneration, 'A'),
          scope(ids.FE, ids.FEGeneration, 'C'),
        ],
      },
      {
        course_id: ids.course,
        lecturer_id: ids.lecturer,
        semester_id: ids.semester,
        year_level: 2,
        class_type: 'TD',
        group_scopes: [scope(ids.DS, ids.DSGeneration, 'A')],
      },
    ];
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
  });

  it('keeps DS Gen 1 and FE Gen 1 distinct, rejects duplicate/invalid/global cohort writes', async () => {
    expect(ids.DSGeneration).not.toBe(ids.FEGeneration);
    expect(
      (
        await post('student-generations', {
          major_id: ids.DS,
          name: '05',
          generation_number: 5,
          entry_academic_year_id: ids.year,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('student-generations', {
          major_id: ids.DS,
          name: 'Gen 1',
          entry_academic_year_id: ids.year,
        })
      ).status,
    ).toBe(409);
    for (const number of [0, -1, 1.5, 2147483648, 'arbitrary'])
      expect(
        (
          await post('student-generations', {
            major_id: ids.DS,
            generation_number: number,
            entry_academic_year_id: ids.year,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await post('student-generations', {
          name: 'Gen 1',
          entry_academic_year_id: ids.year,
        })
      ).status,
    ).toBe(400);
  });
  it('rejects cross-major cohort assignment and mixed-major imports before writes', async () => {
    const before = await db.students.count();
    expect(
      (
        await post('students', {
          student_code: `bad-${stamp}`,
          full_name: 'Wrong major',
          password: 'Password123',
          generation_id: ids.DSGeneration,
          academic_year_id: ids.year,
          major_id: ids.FE,
          year_level: 2,
          class_group: 'A',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('students/import', {
          major_id: ids.DS,
          generation_number: 1,
          academic_year_id: ids.year,
          year_level: 2,
          students: [
            {
              student_code: `bad-import-${stamp}`,
              major: `FE${stamp}`.slice(0, 30),
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect(await db.students.count()).toBe(before);
  });
  it('keeps course allocation and year setup retry receipts stable', async () => {
    const dto = {
      department_id: Number(ids.department),
      course_name: 'Retry course',
      idempotency_key: `retry-course-${stamp}`,
    };
    const first = await post('courses', dto),
      retry = await post('courses', dto);
    expect(first.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.course_code).toBe(first.body.course_code);
    expect(
      (await post('courses', { ...dto, course_name: 'Changed input' })).status,
    ).toBe(409);
    const codes = await Promise.all(
      [0, 1].map((i) =>
        post('courses', {
          department_id: Number(ids.department),
          course_name: `Concurrent ${i}`,
          idempotency_key: `concurrent-${stamp}-${i}`,
        }),
      ),
    );
    expect(codes.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(
      new Set(
        codes.filter((r) => r.status === 201).map((r) => r.body.course_code),
      ).size,
    ).toBe(codes.filter((r) => r.status === 201).length);
  });
  it('rejects unscoped curriculum bypass and label-only duplicate rows without writes', async () => {
    const before = await db.course_offerings.count();
    expect(
      (
        await post('course-offerings', {
          ...rows[0],
          year_level: undefined,
          group_scopes: undefined,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('course-offerings/create-preview', {
          rows: [rows[0], { ...rows[0], section_code: 'Different label' }],
        })
      ).status,
    ).toBe(400);
    expect(await db.course_offerings.count()).toBe(before);
  });
  it('previews complete shared-major rosters without creating assignments, then creates/enrolls atomically', async () => {
    const before = await db.course_offerings.count();
    const response = await post('course-offerings/create-preview', { rows });
    expect(response.status).toBe(200);
    preview = response.body;
    expect(preview.items.map((i: any) => i.eligible_count)).toEqual([2, 1]);
    expect(await db.course_offerings.count()).toBe(before);
    const body = {
      rows,
      review_id: preview.review_id,
      confirmations: preview.items.map((i: any) => ({
        row_index: i.row_index,
        confirmed_student_ids: i.confirmed_student_ids,
      })),
    };
    const created = await post('course-offerings/create-confirm', body);
    expect(created.status).toBe(201);
    ids.offering = created.body.items[0].course_offering_id;
    ids.td = created.body.items[1].course_offering_id;
    expect(
      created.body.items.map((i: any) => i.created_enrollment_count),
    ).toEqual([2, 1]);
    const retry = await post('course-offerings/create-confirm', body);
    expect(retry.body.items).toEqual(created.body.items);
    expect(retry.body.already_applied).toBe(true);
    expect(
      (
        await post('course-offerings', {
          ...rows[0],
          section_code: 'Other label',
        })
      ).status,
    ).toBe(409);
  });
  it('previews a deduplicated union and independent major restriction, rejecting conflicting/empty scopes', async () => {
    const base = {
      course_offering_id: ids.offering,
      participant_scope: 'ALL_ENROLLED',
    };
    const union = await post('evaluations/participants/preview', {
      ...base,
      group_scopes: [...rows[0].group_scopes, rows[0].group_scopes[0]],
    });
    expect(union.status).toBe(200);
    expect(union.body.eligible_count).toBe(2);
    expect(
      union.body.audience_breakdown.reduce(
        (n: number, r: any) => n + r.count,
        0,
      ),
    ).toBe(2);
    const ds = await post('evaluations/participants/preview', {
      ...base,
      major_ids: [ids.DS],
    });
    expect(ds.body.confirmed_student_ids).toEqual([ids.DSUser]);
    for (const extra of [
      { major_ids: [] },
      { group_scopes: [] },
      {
        group_scope: rows[0].group_scopes[0],
        group_scopes: rows[0].group_scopes,
      },
      { major_ids: [ids.FE], group_scopes: [rows[0].group_scopes[0]] },
    ])
      expect(
        (await post('evaluations/participants/preview', { ...base, ...extra }))
          .status,
      ).toBe(400);
  });
  it('atomically creates/publishes one reviewed evaluation with frozen audience and two audit events', async () => {
    const input = {
      course_offering_id: ids.offering,
      survey_id: ids.survey,
      survey_version_id: ids.version,
      start_at: now(),
      end_at: later(),
      publish: true,
      group_scopes: rows[0].group_scopes,
      participant_scope: 'ALL_ENROLLED',
    };
    const review = await post('evaluations/create-preview', input);
    expect(review.status).toBe(200);
    const body = {
      ...input,
      review_id: review.body.review_id,
      confirmed_student_ids: review.body.confirmed_student_ids,
    };
    const saved = await post('evaluations', body);
    expect(saved.status).toBe(201);
    expect(saved.body.status).toBe('OPEN');
    ids.evaluation = saved.body.id;
    expect(saved.body.filter_metadata.audience_pairs).toHaveLength(2);
    expect(saved.body.filter_metadata.audience_status).toBe('COMPLETE');
    const retry = await post('evaluations', body);
    expect(retry.body.id).toBe(saved.body.id);
    const events = await api()
      .get(`/api/evaluations/${ids.evaluation}/activity`)
      .set(auth());
    expect(events.status).toBe(200);
    expect(events.body.items.map((i: any) => i.action)).toEqual([
      'SCHEDULED',
      'CREATED',
    ]);
    expect(events.body.items.every((i: any) => i.actor.id === ids.admin)).toBe(
      true,
    );
  });
  it('extends only active deadlines and preserves participants, snapshots and results', async () => {
    const before = await db.evaluation_participants.findMany({
      where: { evaluation_id: BigInt(ids.evaluation) },
    });
    const end = new Date(Date.now() + 7200_000).toISOString();
    expect(
      (
        await api()
          .put(`/api/evaluations/${ids.evaluation}/schedule`)
          .set(auth())
          .send({ end_at: end })
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .put(`/api/evaluations/${ids.evaluation}/schedule`)
          .set(auth())
          .send({ end_at: end })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .put(`/api/evaluations/${ids.evaluation}/schedule`)
          .set(auth())
          .send({ start_at: now(), end_at: later() })
      ).status,
    ).toBe(400);
    expect(
      await db.evaluation_participants.findMany({
        where: { evaluation_id: BigInt(ids.evaluation) },
      }),
    ).toEqual(before);
    const first = await api()
      .get(`/api/evaluations/${ids.evaluation}/activity?limit=1`)
      .set(auth());
    const second = await api()
      .get(
        `/api/evaluations/${ids.evaluation}/activity?limit=1&cursor=${first.body.next_cursor}`,
      )
      .set(auth());
    expect(first.body.items[0].action).toBe('DEADLINE_EXTENDED');
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
    expect(
      (
        await api()
          .get(`/api/evaluations/${ids.evaluation}/activity?cursor=bad`)
          .set(auth())
      ).status,
    ).toBe(400);
  });
  it('rejects evaluation duplicates across question versions and exposes no audit history to students', async () => {
    const duplicate = await post('evaluations/create-preview', {
      course_offering_id: ids.offering,
      survey_id: ids.survey,
      survey_version_id: ids.version,
      start_at: now(),
      end_at: later(),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('EVALUATION_EXISTS');
    expect(
      (
        await api()
          .get(`/api/evaluations/${ids.evaluation}/activity`)
          .set({ Authorization: `Bearer ${studentToken}` })
      ).status,
    ).toBe(403);
  });
  it('previews bulk READY/SKIPPED rows and keeps an idempotent all-or-nothing publication receipt', async () => {
    bulkInput = {
      evaluations: [ids.offering, ids.td].map((id) => ({
        course_offering_id: id,
        survey_id: ids.survey,
        survey_version_id: ids.version,
        start_at: now(),
        end_at: later(),
        participant_scope: 'ALL_ENROLLED',
      })),
    };
    const review = await post('evaluations/bulk-create-preview', bulkInput);
    expect(review.status).toBe(200);
    bulk = review.body;
    expect(bulk.items.map((i: any) => i.outcome)).toEqual(['SKIPPED', 'READY']);
    expect(bulk.can_confirm).toBe(true);
    const body = {
      ...bulkInput,
      review_id: bulk.review_id,
      confirmations: bulk.items
        .filter((i: any) => i.outcome === 'READY')
        .map((i: any) => ({
          course_offering_id: i.course_offering_id,
          confirmed_student_ids: i.confirmed_student_ids,
        })),
    };
    const saved = await post('evaluations/bulk-create', body);
    expect(saved.status).toBe(201);
    expect(saved.body.items.map((i: any) => i.outcome)).toEqual([
      'SKIPPED',
      'SCHEDULED',
    ]);
    await db.reviewed_operations.update({
      where: { id: bulk.review_id },
      data: { expires_at: new Date(0) },
    });
    const retry = await post('evaluations/bulk-create', body);
    expect(retry.body.items).toEqual(saved.body.items);
    expect(retry.body.already_applied).toBe(true);
    expect(
      await db.evaluations.count({
        where: { course_offering_id: BigInt(ids.td) },
      }),
    ).toBe(1);
  });
  it('initializes independent next-year groups, preserves existing records, and safely retries setup', async () => {
    const input = {
      name: `NX-${stamp}`.slice(0, 20),
      start_year: Number(ids.start) + 1,
      create_semesters: true,
      idempotency_key: `next-${stamp}`,
    };
    const saved = await post('academic-years/setup', input);
    expect(saved.status).toBe(201);
    expect(saved.body.rollover.groups.copied).toBe(2);
    const placements = await db.student_academic_records.findMany({
      where: { academic_year_id: BigInt(saved.body.id) },
    });
    expect(placements.map((p) => p.year_level)).toEqual([3, 3]);
    const retry = await post('academic-years/setup', input);
    expect(retry.body.id).toBe(saved.body.id);
    expect(retry.body.rollover).toEqual(saved.body.rollover);
    await db.student_academic_records.update({
      where: { id: placements[0].id },
      data: { class_group: null },
    });
    const recovery = await post(`academic-years/${saved.body.id}/setup`, {
      ...input,
      idempotency_key: `recover-${stamp}`,
    });
    expect(recovery.status).toBe(200);
    expect(recovery.body.rollover.groups.preserved).toBe(2);
    expect(
      (
        await db.student_academic_records.findUniqueOrThrow({
          where: { id: placements[0].id },
        })
      ).class_group,
    ).toBeNull();
    expect(
      (
        await db.student_academic_records.findFirstOrThrow({
          where: {
            student_id: BigInt(ids.DSStudent),
            academic_year_id: BigInt(ids.year),
          },
        })
      ).class_group,
    ).toBe('A');
  });
  it('rejects invalid setup dates without changing active year or creating partial years', async () => {
    const before = await db.academic_years.findMany({
        where: { is_active: true },
      }),
      count = await db.academic_years.count();
    const saved = await post('academic-years/setup', {
      name: `BAD-${stamp}`.slice(0, 20),
      start_year: Number(ids.start) + 2,
      is_active: true,
      idempotency_key: `invalid-${stamp}`,
      semesters: [{ start_date: '2100-01-02', end_date: '2100-01-01' }],
    });
    expect(saved.status).toBe(400);
    expect(await db.academic_years.count()).toBe(count);
    expect(
      await db.academic_years.findMany({ where: { is_active: true } }),
    ).toEqual(before);
  });
  it('rolls back year creation, activation and Semester 1 when Semester 2 fails after its write', async () => {
    const count = await db.academic_years.count(),
      active = await db.academic_years.findMany({ where: { is_active: true } });
    const service = new AcademicYearSetupService(
      failAfterWrite(db, 'semesters', 'create', 2),
    );
    await expect(
      service.setup(
        {
          name: `RB-${stamp}`.slice(0, 20),
          start_year: Number(ids.start) + 2,
          is_active: true,
          create_semesters: true,
          idempotency_key: `rollback-${stamp}`,
        },
        BigInt(ids.admin),
      ),
    ).rejects.toThrow('INJECTED_LATE_WRITE_FAILURE');
    expect(await db.academic_years.count()).toBe(count);
    expect(
      await db.academic_years.findMany({ where: { is_active: true } }),
    ).toEqual(active);
    expect(
      await db.operation_receipts.count({
        where: { idempotency_key: `rollback-${stamp}` },
      }),
    ).toBe(0);
  });
  it('rolls back an entire assignment/enrollment confirmation and safely reuses its pending review', async () => {
    const lecturer = await db.users.create({
      data: {
        email: `rollback-${stamp}@example.edu`,
        full_name: 'Second lecturer',
        password_hash: await bcrypt.hash('Password123', 10),
        role: 'LECTURER',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    const faultRows = [
      { ...rows[0], class_type: 'TP' as const },
      {
        ...rows[0],
        class_type: 'TP' as const,
        lecturer_id: String(lecturer.id),
      },
    ];
    const review = await new AssignmentCreationService(db).preview(
      { rows: faultRows },
      BigInt(ids.admin),
    );
    const body = {
      rows: faultRows,
      review_id: review.review_id,
      confirmations: review.items.map((i) => ({
        row_index: i.row_index,
        confirmed_student_ids: i.confirmed_student_ids,
      })),
    };
    const before = await db.course_offerings.count(),
      enrolled = await db.enrollments.count();
    await expect(
      new AssignmentCreationService(
        failAfterWrite(db, 'enrollments', 'create', 2),
      ).confirm(body, BigInt(ids.admin)),
    ).rejects.toThrow('INJECTED_LATE_WRITE_FAILURE');
    expect(await db.course_offerings.count()).toBe(before);
    expect(await db.enrollments.count()).toBe(enrolled);
    expect(
      (
        await db.reviewed_operations.findUniqueOrThrow({
          where: { id: review.review_id },
        })
      ).completed_at,
    ).toBeNull();
    const retry = await new AssignmentCreationService(db).confirm(
      body,
      BigInt(ids.admin),
    );
    const items = retry.items as { course_offering_id: string }[];
    ids.rollbackOffering1 = items[0].course_offering_id;
    ids.rollbackOffering2 = items[1].course_offering_id;
    expect(await db.course_offerings.count()).toBe(before + 2);
  });
  it('rolls back every evaluation, publication, snapshot and event when the last bulk event fails', async () => {
    const evaluations = [ids.rollbackOffering1, ids.rollbackOffering2].map(
      (id) => ({
        course_offering_id: id,
        survey_id: ids.survey,
        survey_version_id: ids.version,
        start_at: now(),
        end_at: later(),
        participant_scope: 'ALL_ENROLLED' as const,
      }),
    );
    const review = await new BulkEvaluationsService(db).preview(
      { evaluations },
      BigInt(ids.admin),
    );
    expect(review.can_confirm).toBe(true);
    const body = {
      evaluations,
      review_id: review.review_id,
      confirmations: review.items
        .filter((i) => i.outcome === 'READY')
        .map((i) => ({
          course_offering_id: i.course_offering_id,
          confirmed_student_ids: i.confirmed_student_ids!,
        })),
    };
    const count = await db.evaluations.count(),
      events = await db.evaluation_activity.count(),
      participants = await db.evaluation_participants.count();
    await expect(
      new BulkEvaluationsService(
        failAfterWrite(db, 'evaluation_activity', 'create', 4),
      ).confirm(body, BigInt(ids.admin)),
    ).rejects.toThrow('INJECTED_LATE_WRITE_FAILURE');
    expect(await db.evaluations.count()).toBe(count);
    expect(await db.evaluation_activity.count()).toBe(events);
    expect(await db.evaluation_participants.count()).toBe(participants);
    expect(
      (
        await db.reviewed_operations.findUniqueOrThrow({
          where: { id: review.review_id },
        })
      ).completed_at,
    ).toBeNull();
    await db.users.update({
      where: { id: BigInt(ids.FEUser) },
      data: { status: 'INACTIVE' },
    });
    try {
      const drift = await post('evaluations/bulk-create', body);
      expect(drift.status).toBe(409);
      expect(drift.body.code).toBe('REVIEW_INVALIDATED');
      expect(await db.evaluations.count()).toBe(count);
      expect(await db.evaluation_activity.count()).toBe(events);
    } finally {
      await db.users.update({
        where: { id: BigInt(ids.FEUser) },
        data: { status: 'ACTIVE' },
      });
    }
    await db.reviewed_operations.update({
      where: { id: review.review_id },
      data: { expires_at: new Date(0) },
    });
    const expired = await post('evaluations/bulk-create', body);
    expect(expired.status).toBe(409);
    expect(expired.body.code).toBe('REVIEW_EXPIRED');
    expect(await db.evaluations.count()).toBe(count);
    await db.reviewed_operations.update({
      where: { id: review.review_id },
      data: { expires_at: new Date(Date.now() + 15 * 60_000) },
    });
    const retry = await new BulkEvaluationsService(db).confirm(
      body,
      BigInt(ids.admin),
    );
    expect((retry.items as unknown[]).length).toBe(2);
  });
  it('returns complete self-profile groups and keeps class labels separate from academic groups', async () => {
    const response = await api()
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${studentToken}` });
    expect(response.status).toBe(200);
    expect(
      response.body.student.academic_context.academic_record.class_group,
    ).toBe('A');
    expect(response.body.student.academic_context.placement_eligible).toBe(
      true,
    );
    const history = await api()
      .get('/api/student/evaluations/history')
      .set({ Authorization: `Bearer ${studentToken}` });
    const evaluation = history.body.find((e: any) => e.id === ids.evaluation);
    expect(evaluation.section_code).toBe('Shared class');
    expect(evaluation.class_type).toBe('COURSE');
    expect(evaluation.semester.semester_number).toBe(1);
    expect(evaluation.semester.is_active).toBe(true);
  });
  it('filters rating/text results using captured majors without exposing answer identity, including export', async () => {
    const questionnaire = await api()
      .get(`/api/student/evaluations/${ids.evaluation}/survey`)
      .set({ Authorization: `Bearer ${studentToken}` });
    expect(questionnaire.status).toBe(200);
    const questions = questionnaire.body.questions;
    const submitted = await api()
      .post(`/api/student/evaluations/${ids.evaluation}/responses`)
      .set({ Authorization: `Bearer ${studentToken}` })
      .send({
        answers: questions.map((q: any) =>
          q.question_type === 'TEXT'
            ? { question_id: q.id, text_value: 'Useful course' }
            : q.question_type === 'MULTIPLE_CHOICE'
              ? {
                  question_id: q.id,
                  selected_option_ids: [q.question_options[0].id],
                }
              : { question_id: q.id, rating_value: 5 },
        ),
      });
    expect(submitted.status).toBe(201);
    const ds = await api()
      .get(`/api/admin/results/${ids.lecturer}?major_id=${ids.DS}`)
      .set(auth());
    expect(ds.status).toBe(200);
    const result = ds.body.evaluations.find(
      (r: any) => r.evaluation.id === ids.evaluation,
    );
    expect(result.participant_count).toBe(1);
    expect(result.submission_count).toBe(1);
    expect(
      result.version_results[0].questions.find(
        (q: any) => q.question_type === 'MULTIPLE_CHOICE',
      ).options[0].count,
    ).toBe(1);
    const fe = await api()
      .get(`/api/admin/results/${ids.lecturer}?major_id=${ids.FE}`)
      .set(auth());
    expect(fe.status).toBe(200);
    expect(
      fe.body.evaluations.find((r: any) => r.evaluation.id === ids.evaluation)
        .submission_count,
    ).toBe(0);
    const exported = await api()
      .get(`/api/admin/results/${ids.lecturer}/export?major_id=${ids.DS}`)
      .set(auth());
    expect(exported.body).toEqual(ds.body);
    expect(JSON.stringify(ds.body)).not.toMatch(
      /student_id|student_code|participant_id|response_id|DS student/,
    );
  });
  it('initializes assignment copies with independent IDs, destination cohorts and no copied enrollments', async () => {
    const used = new Set(
      (await db.academic_years.findMany({ select: { start_year: true } })).map(
        (y) => y.start_year,
      ),
    );
    const start = Array.from({ length: 145 }, (_, i) => 2050 + i).find(
      (y) => ![y - 1, y, y + 1].some((n) => used.has(n)),
    )!;
    const source = await post('academic-years/setup', {
      name: `IS-${stamp}`.slice(0, 20),
      start_year: start,
      idempotency_key: `i-source-${stamp}`,
    });
    expect(source.status).toBe(201);
    const semester = source.body.semesters.find(
      (s: any) => s.semester_number === 1,
    );
    const course = await post('courses', {
      department_id: Number(ids.department),
      course_name: 'Independent rollover course',
      idempotency_key: `i-course-${stamp}`,
    });
    expect(course.status).toBe(201);
    const old: string[] = [],
      incoming: string[] = [];
    for (const [index, major] of [ids.DS, ids.FE].entries()) {
      await post('course-year-rules', {
        course_id: course.body.id,
        major_id: major,
        year_level: 2,
        effective_academic_year_id: source.body.id,
      }).expect(201);
      for (const level of [2, 1]) {
        const generation = await post('student-generations', {
          major_id: major,
          generation_number: 1000 + Number(source.body.id) * 2 + level,
          entry_academic_year_id: source.body.id,
          starting_year_level: level,
        });
        expect(generation.status).toBe(201);
        (level === 2 ? old : incoming).push(generation.body.id);
        await post('students', {
          student_code: `roll-${stamp}-${index}-${level}`,
          full_name: 'Rollover student',
          password: 'Password123',
          generation_id: generation.body.id,
          academic_year_id: source.body.id,
          major_id: major,
          year_level: level,
          class_group: index === 0 ? 'A' : 'C',
        }).expect(201);
      }
    }
    const row = {
      course_id: course.body.id,
      lecturer_id: ids.lecturer,
      semester_id: semester.id,
      year_level: 2,
      class_type: 'COURSE',
      section_code: 'Independent class',
      group_scopes: [ids.DS, ids.FE].map((major, index) => ({
        academic_year_id: source.body.id,
        generation_id: old[index],
        major_id: major,
        year_level: 2,
        class_groups: [index === 0 ? 'A' : 'C'],
      })),
    };
    const preview = await post('course-offerings/create-preview', {
      rows: [row],
    });
    expect(preview.status).toBe(200);
    const saved = await post('course-offerings/create-confirm', {
      rows: [row],
      review_id: preview.body.review_id,
      confirmations: preview.body.items.map((i: any) => ({
        row_index: i.row_index,
        confirmed_student_ids: i.confirmed_student_ids,
      })),
    });
    expect(saved.status).toBe(201);
    const original = await db.course_offerings.findUniqueOrThrow({
      where: { id: BigInt(saved.body.items[0].course_offering_id) },
      include: { group_scopes: true },
    });
    const input = {
      name: `ID-${stamp}`.slice(0, 20),
      start_year: start + 1,
      idempotency_key: `i-destination-${stamp}`,
    };
    const destination = await post('academic-years/setup', input);
    expect(destination.status).toBe(201);
    expect(destination.body.rollover.assignments.copied).toBe(1);
    const copy = await db.course_offerings.findFirstOrThrow({
      where: { source_offering_id: original.id },
      include: {
        group_scopes: true,
        _count: { select: { enrollments: true } },
      },
    });
    expect(copy.id).not.toBe(original.id);
    expect(copy.semester_id).not.toBe(original.semester_id);
    expect(copy.year_level).toBe(2);
    expect(
      copy.group_scopes.map((s) => String(s.generation_id)).sort(),
    ).toEqual(incoming.sort());
    expect(copy._count.enrollments).toBe(0);
    expect(
      await db.course_offerings.findUniqueOrThrow({
        where: { id: original.id },
        include: { group_scopes: true },
      }),
    ).toEqual(original);
    const retry = await post('academic-years/setup', input);
    expect(retry.body.rollover).toEqual(destination.body.rollover);
    const blocked = await post('evaluations/bulk-create-preview', {
      evaluations: [
        {
          course_offering_id: String(copy.id),
          survey_id: ids.survey,
          survey_version_id: ids.version,
          start_at: now(),
          end_at: later(),
          participant_scope: 'ALL_ENROLLED',
        },
      ],
    });
    expect(blocked.status).toBe(200);
    expect(blocked.body.items[0].outcome).toBe('BLOCKED');
    expect(blocked.body.can_confirm).toBe(false);
  });
  it('enforces department scope for audience previews, assignment counts and result readers', async () => {
    const department = await db.departments.create({
      data: { code: `OTHER${stamp}`.slice(0, 30), name: `Other ${stamp}` },
    });
    const actor = await db.users.create({
      data: {
        email: `scoped-${stamp}@example.edu`,
        full_name: 'Scoped admin',
        password_hash: await bcrypt.hash('Password123', 10),
        role: 'ADMIN',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
        user_departments: {
          create: { department_id: department.id, is_primary: true },
        },
      },
    });
    const login = await api()
      .post('/api/auth/login')
      .send({ identifier: actor.email, password: 'Password123' });
    expect(login.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.access_token}` };
    expect(
      (
        await api().post('/api/evaluations/create-preview').set(headers).send({
          course_offering_id: ids.offering,
          survey_id: ids.survey,
          survey_version_id: ids.version,
          start_at: now(),
          end_at: later(),
        })
      ).status,
    ).toBe(403);
    const offerings = await api().get('/api/course-offerings').set(headers);
    expect(offerings.status).toBe(200);
    expect(offerings.body).toEqual([]);
    const results = await api().get('/api/admin/results').set(headers);
    expect(results.status).toBe(200);
    expect(results.body).toEqual([]);
  });

  it('blocks completed receipt replay after administrator department access changes', async () => {
    const body = {
      ...bulkInput,
      review_id: bulk.review_id,
      confirmations: bulk.items
        .filter((i: any) => i.outcome === 'READY')
        .map((i: any) => ({
          course_offering_id: i.course_offering_id,
          confirmed_student_ids: i.confirmed_student_ids,
        })),
    };
    const department = await db.departments.create({
      data: {
        code: `REVOKE${stamp}`.slice(0, 30),
        name: `Receipt scope ${stamp}`,
      },
    });
    const membership = await db.user_departments.create({
      data: {
        user_id: BigInt(ids.admin),
        department_id: department.id,
        is_primary: true,
      },
    });
    try {
      const response = await post('evaluations/bulk-create', body);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('REVIEW_SCOPE_CHANGED');
      expect(response.body.items).toBeUndefined();
      const course = await post('courses', {
        department_id: Number(ids.department),
        course_name: 'Retry course',
        idempotency_key: `retry-course-${stamp}`,
      });
      expect(course.status).toBe(409);
      expect(course.body.code).toBe('IDEMPOTENCY_INPUT_MISMATCH');
      expect(course.body.id).toBeUndefined();
    } finally {
      await db.user_departments.delete({
        where: {
          user_id_department_id: {
            user_id: membership.user_id,
            department_id: membership.department_id,
          },
        },
      });
    }
    const recovered = await post('evaluations/bulk-create', body);
    expect(recovered.status).toBe(201);
    expect(recovered.body.already_applied).toBe(true);
  });
});
