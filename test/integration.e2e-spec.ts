import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Full evaluation flow: Admin → Student → Lecturer (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();
  const password = 'Password123';
  const emails = {
    lecturer: `int-lecturer-${stamp}@itc.edu.kh`,
    studentA: `int-student-a-${stamp}@itc.edu.kh`,
    studentB: `int-student-b-${stamp}@itc.edu.kh`,
  };

  // Everything the story creates, shared between steps
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const login = (email: string) => api().post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Remove everything the story created, children before parents
    const big = (key: string) => (ids[key] ? BigInt(ids[key]) : undefined);

    if (big('evaluation')) {
      await prisma.answers.deleteMany({ where: { responses: { evaluation_id: big('evaluation') } } });
      await prisma.responses.deleteMany({ where: { evaluation_id: big('evaluation') } });
      await prisma.evaluation_participants.deleteMany({ where: { evaluation_id: big('evaluation') } });
      await prisma.evaluations.deleteMany({ where: { id: big('evaluation') } });
    }
    if (big('version')) {
      await prisma.questions.deleteMany({ where: { survey_version_id: big('version') } });
      await prisma.survey_versions.deleteMany({ where: { id: big('version') } });
    }
    if (big('survey')) await prisma.surveys.deleteMany({ where: { id: big('survey') } });
    if (big('offering')) {
      await prisma.enrollments.deleteMany({ where: { course_offering_id: big('offering') } });
      await prisma.course_offerings.deleteMany({ where: { id: big('offering') } });
    }
    if (big('semester')) await prisma.semesters.deleteMany({ where: { id: big('semester') } });
    if (big('course')) await prisma.courses.deleteMany({ where: { id: big('course') } });
    await prisma.users.deleteMany({ where: { email: { in: Object.values(emails) } } });

    await app.close();
  });

  // ---------- ADMIN PREPARES ----------

  it('1. Admin logs in', async () => {
    const res = await login('admin@itc.edu.kh');
    expect(res.status).toBe(200);
    tokens.admin = res.body.access_token;
  });

  it('2. Admin creates a lecturer and two students', async () => {
    const create = (email: string, full_name: string, role: string) =>
      api().post('/api/users').set(as('admin')).send({ email, password, full_name, role });

    const lecturer = await create(emails.lecturer, 'Integration Lecturer', 'LECTURER');
    const studentA = await create(emails.studentA, 'Integration Student A', 'STUDENT');
    const studentB = await create(emails.studentB, 'Integration Student B', 'STUDENT');

    expect([lecturer.status, studentA.status, studentB.status]).toEqual([201, 201, 201]);
    ids.lecturer = lecturer.body.id;
    ids.studentA = studentA.body.id;
    ids.studentB = studentB.body.id;
  });

  it('3. Admin creates a course and a semester', async () => {
    const course = await api()
      .post('/api/courses')
      .set(as('admin'))
      .send({ course_code: `INT-${stamp}`, course_name: 'Integration Testing 101' });
    const semester = await api()
      .post('/api/semesters')
      .set(as('admin'))
      .send({ semester_name: `INT-${stamp}`, academic_year: '2026-2027', start_date: '2026-10-01', end_date: '2027-02-28' });

    expect([course.status, semester.status]).toEqual([201, 201]);
    ids.course = course.body.id;
    ids.semester = semester.body.id;
  });

  it('4. Admin assigns the lecturer and enrolls both students', async () => {
    const offering = await api()
      .post('/api/course-offerings')
      .set(as('admin'))
      .send({ course_id: ids.course, lecturer_id: ids.lecturer, semester_id: ids.semester, section_code: 'A' });
    expect(offering.status).toBe(201);
    ids.offering = offering.body.id;

    for (const student of [ids.studentA, ids.studentB]) {
      const res = await api()
        .post(`/api/course-offerings/${ids.offering}/enrollments`)
        .set(as('admin'))
        .send({ student_id: student });
      expect(res.status).toBe(201);
    }
  });

  it('5. Admin creates a survey, a version, and its questions', async () => {
    const survey = await api().post('/api/surveys').set(as('admin')).send({ title: `Integration Survey ${stamp}` });
    ids.survey = survey.body.id;

    const version = await api().post(`/api/surveys/${ids.survey}/versions`).set(as('admin')).send({});
    ids.version = version.body.id;

    const rating = await api()
      .post(`/api/survey-versions/${ids.version}/questions`)
      .set(as('admin'))
      .send({ question_text: 'The lecturer explains clearly.', question_type: 'RATING' });
    const text = await api()
      .post(`/api/survey-versions/${ids.version}/questions`)
      .set(as('admin'))
      .send({ question_text: 'Any comments?', question_type: 'TEXT', is_required: false });

    expect([survey.status, version.status, rating.status, text.status]).toEqual([201, 201, 201, 201]);
    ids.ratingQ = rating.body.id;
    ids.textQ = text.body.id;
  });

  it('6. Admin creates the evaluation and opens it', async () => {
    const created = await api()
      .post('/api/evaluations')
      .set(as('admin'))
      .send({ course_offering_id: ids.offering, survey_version_id: ids.version, start_at: hourAgo, end_at: nextWeek });
    expect(created.status).toBe(201);
    ids.evaluation = created.body.id;

    const opened = await api().post(`/api/evaluations/${ids.evaluation}/open`).set(as('admin'));
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('OPEN');
    expect(opened.body._count.evaluation_participants).toBe(2);
    expect(opened.body.survey_versions.status).toBe('LOCKED');
  });

  // ---------- STUDENTS SUBMIT ----------

  it('7. Student A logs in and sees the evaluation', async () => {
    tokens.studentA = (await login(emails.studentA)).body.access_token;
    const res = await api().get('/api/student/evaluations').set(as('studentA'));

    expect(res.status).toBe(200);
    const mine = res.body.find((e: any) => e.id === ids.evaluation);
    expect(mine.course.code).toBe(`INT-${stamp}`);
    expect(mine.lecturer.full_name).toBe('Integration Lecturer');
  });

  it('8. Student A reads the questions', async () => {
    const res = await api().get(`/api/student/evaluations/${ids.evaluation}/survey`).set(as('studentA'));

    expect(res.status).toBe(200);
    expect(res.body.questions.map((q: any) => q.id)).toEqual([ids.ratingQ, ids.textQ]);
  });

  it('9. Student A submits', async () => {
    const res = await api()
      .post(`/api/student/evaluations/${ids.evaluation}/responses`)
      .set(as('studentA'))
      .send({
        answers: [
          { question_id: ids.ratingQ, rating_value: 5 },
          { question_id: ids.textQ, text_value: 'Very clear explanations.' },
        ],
      });
    expect(res.status).toBe(201);
  });

  it('10. Student A tries to submit again and is rejected', async () => {
    const res = await api()
      .post(`/api/student/evaluations/${ids.evaluation}/responses`)
      .set(as('studentA'))
      .send({ answers: [{ question_id: ids.ratingQ, rating_value: 1 }] });
    expect(res.status).toBe(409);
  });

  it('11. Student B submits', async () => {
    tokens.studentB = (await login(emails.studentB)).body.access_token;
    const res = await api()
      .post(`/api/student/evaluations/${ids.evaluation}/responses`)
      .set(as('studentB'))
      .send({
        answers: [
          { question_id: ids.ratingQ, rating_value: 3 },
          { question_id: ids.textQ, text_value: 'More practice please.' },
        ],
      });
    expect(res.status).toBe(201);
  });

  // ---------- LECTURER VIEWS ----------

  it('12. Lecturer cannot see results while the evaluation is still open', async () => {
    tokens.lecturer = (await login(emails.lecturer)).body.access_token;
    const res = await api().get(`/api/lecturer/evaluations/${ids.evaluation}/dashboard`).set(as('lecturer'));
    expect(res.status).toBe(409);
  });

  it('13. Admin closes the evaluation', async () => {
    const res = await api().post(`/api/evaluations/${ids.evaluation}/close`).set(as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
  });

  it('14. Lecturer sees the evaluation in their list with results available', async () => {
    const res = await api().get('/api/lecturer/evaluations').set(as('lecturer'));
    const mine = res.body.find((e: any) => e.id === ids.evaluation);

    expect(mine.results_available).toBe(true);
    expect(mine.response_count).toBe(2);
    expect(mine.eligible_count).toBe(2);
  });

  it('15. Lecturer views the dashboard with correct numbers', async () => {
    const res = await api().get(`/api/lecturer/evaluations/${ids.evaluation}/dashboard`).set(as('lecturer'));

    expect(res.status).toBe(200);
    expect(res.body.response_rate).toBe(1);
    expect(res.body.overall_average).toBe(4);
    expect(res.body.questions[0].distribution).toEqual({ '1': 0, '2': 0, '3': 1, '4': 0, '5': 1 });
  });

  it('16. Lecturer reads the anonymous comments', async () => {
    const res = await api().get(`/api/lecturer/evaluations/${ids.evaluation}/comments`).set(as('lecturer'));
    const body = JSON.stringify(res.body).toLowerCase();

    expect(res.status).toBe(200);
    expect(res.body.questions[0].comments).toEqual(['More practice please.', 'Very clear explanations.']);
    expect(body).not.toContain('integration student');
    expect(body).not.toContain('int-student');
  });
});