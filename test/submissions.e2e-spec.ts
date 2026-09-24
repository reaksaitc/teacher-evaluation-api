import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Submission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let lecturerToken: string;
  let student1Token: string; // user 4
  let student2Token: string; // user 5
  let student3Token: string; // user 6

  let tempSurveyId: string;
  let versionAId: string;
  let versionBId: string;
  let tempOfferingId: string;
  let openEvalId: string;
  let closedEvalId: string;
  let otherEvalId: string; // only student2 is enrolled
  let q1: string; // RATING, required
  let q2: string; // RATING, required
  let q3: string; // TEXT, optional

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const api = () => request(app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const submit = (evalId: string, token: string, answers: unknown) =>
    api().post(`/api/student/evaluations/${evalId}/responses`).set(as(token)).send({ answers });

  const validAnswers = () => [
    { question_id: q1, rating_value: 5 },
    { question_id: q2, rating_value: 4 },
    { question_id: q3, text_value: '  Clear explanations.  ' },
  ];

  async function createOpenEvaluation(offeringId: string, versionId: string) {
    const created = await api()
      .post('/api/evaluations')
      .set(admin())
      .send({ course_offering_id: offeringId, survey_version_id: versionId, start_at: hourAgo, end_at: nextWeek });
    await api().post(`/api/evaluations/${created.body.id}/open`).set(admin());
    return created.body.id as string;
  }

  const addQuestion = async (versionId: string, body: Record<string, unknown>) =>
    (await api().post(`/api/survey-versions/${versionId}/questions`).set(admin()).send(body)).body.id as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const login = (email: string) =>
      api().post('/api/auth/login').send({ email, password: 'Password123' }).then((res) => res.body.access_token);

    adminToken = await login('admin@itc.edu.kh');
    lecturerToken = await login('sokdara@itc.edu.kh');
    student1Token = await login('student1@itc.edu.kh');
    student2Token = await login('student2@itc.edu.kh');
    student3Token = await login('student3@itc.edu.kh');

    tempSurveyId = (await api().post('/api/surveys').set(admin()).send({ title: `E2E Submit ${stamp}` })).body.id;

    versionAId = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id;
    q1 = await addQuestion(versionAId, { question_text: 'Explains clearly', question_type: 'RATING' });
    q2 = await addQuestion(versionAId, { question_text: 'Well prepared', question_type: 'RATING' });
    q3 = await addQuestion(versionAId, { question_text: 'Comments', question_type: 'TEXT', is_required: false });

    versionBId = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id;
    await addQuestion(versionBId, { question_text: 'Overall', question_type: 'RATING' });

    openEvalId = await createOpenEvaluation('1', versionAId);
    closedEvalId = await createOpenEvaluation('1', versionBId);
    await api().post(`/api/evaluations/${closedEvalId}/close`).set(admin());

    tempOfferingId = (
      await api()
        .post('/api/course-offerings')
        .set(admin())
        .send({ course_id: '2', lecturer_id: '2', semester_id: '1', section_code: `E2E-SUB-${stamp}` })
    ).body.id;
    await api().post(`/api/course-offerings/${tempOfferingId}/enrollments`).set(admin()).send({ student_id: '5' });
    otherEvalId = await createOpenEvaluation(tempOfferingId, versionBId);
  }, 60000);

  afterAll(async () => {
    const evalIds = [openEvalId, closedEvalId, otherEvalId].filter(Boolean).map((id) => BigInt(id));
    const versionIds = [versionAId, versionBId].filter(Boolean).map((id) => BigInt(id));

    await prisma.answers.deleteMany({ where: { responses: { evaluation_id: { in: evalIds } } } });
    await prisma.responses.deleteMany({ where: { evaluation_id: { in: evalIds } } });
    await prisma.evaluation_participants.deleteMany({ where: { evaluation_id: { in: evalIds } } });
    await prisma.evaluations.deleteMany({ where: { id: { in: evalIds } } });
    if (tempOfferingId) {
      await prisma.enrollments.deleteMany({ where: { course_offering_id: BigInt(tempOfferingId) } });
      await prisma.course_offerings.delete({ where: { id: BigInt(tempOfferingId) } });
    }
    await prisma.questions.deleteMany({ where: { survey_version_id: { in: versionIds } } });
    await prisma.survey_versions.deleteMany({ where: { id: { in: versionIds } } });
    if (tempSurveyId) await prisma.surveys.delete({ where: { id: BigInt(tempSurveyId) } });

    await app.close();
  });

  describe('access control', () => {
    it('ADMIN cannot submit -> 403', async () => {
      const res = await submit(openEvalId, adminToken, validAnswers());
      expect(res.status).toBe(403);
    });

    it('LECTURER cannot submit -> 403', async () => {
      const res = await submit(openEvalId, lecturerToken, validAnswers());
      expect(res.status).toBe(403);
    });
  });

  describe('answer validation (nothing is saved)', () => {
    it('empty answers list -> 400', async () => {
      expect((await submit(openEvalId, student1Token, [])).status).toBe(400);
    });

    it('missing a required question -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [{ question_id: q1, rating_value: 5 }]);
      expect(res.status).toBe(400);
    });

    it('rating above the range -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [
        { question_id: q1, rating_value: 6 },
        { question_id: q2, rating_value: 4 },
      ]);
      expect(res.status).toBe(400);
    });

    it('rating below the range -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [
        { question_id: q1, rating_value: 0 },
        { question_id: q2, rating_value: 4 },
      ]);
      expect(res.status).toBe(400);
    });

    it('rating that is not a whole number -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [
        { question_id: q1, rating_value: 3.5 },
        { question_id: q2, rating_value: 4 },
      ]);
      expect(res.status).toBe(400);
    });

    it('text sent to a RATING question -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [
        { question_id: q1, text_value: 'great' },
        { question_id: q2, rating_value: 4 },
      ]);
      expect(res.status).toBe(400);
    });

    it('rating sent to a TEXT question -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [...validAnswers().slice(0, 2), { question_id: q3, rating_value: 3 }]);
      expect(res.status).toBe(400);
    });

    it('question from another survey (seeded question 1) -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [...validAnswers(), { question_id: '1', rating_value: 5 }]);
      expect(res.status).toBe(400);
    });

    it('same question answered twice -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [...validAnswers(), { question_id: q1, rating_value: 3 }]);
      expect(res.status).toBe(400);
    });

    it('non-numeric question_id -> 400', async () => {
      const res = await submit(openEvalId, student1Token, [{ question_id: 'abc', rating_value: 5 }]);
      expect(res.status).toBe(400);
    });
  });

  describe('evaluation state and eligibility', () => {
    it('CLOSED evaluation -> 409', async () => {
      const res = await submit(closedEvalId, student1Token, validAnswers());
      expect(res.status).toBe(409);
    });

    it('class I am not enrolled in -> 403', async () => {
      const res = await submit(otherEvalId, student1Token, validAnswers());
      expect(res.status).toBe(403);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await submit('999999', student1Token, validAnswers());
      expect(res.status).toBe(404);
    });
  });

  describe('successful submission', () => {
    it('valid answers are accepted -> 201', async () => {
      const res = await submit(openEvalId, student1Token, validAnswers());

      expect(res.status).toBe(201);
      expect(res.body.submitted).toBe(true);

      const status = await api()
        .get(`/api/student/evaluations/${openEvalId}/submission-status`)
        .set(as(student1Token));
      expect(status.body.has_submitted).toBe(true);
    });

    it('submitting a second time -> 409', async () => {
      const res = await submit(openEvalId, student1Token, validAnswers());
      expect(res.status).toBe(409);
    });

    it('the saved response is anonymous and only date-stamped', async () => {
      const responses = await prisma.responses.findMany({
        where: { evaluation_id: BigInt(openEvalId) },
        include: { answers: true },
      });

      // Only the one successful submission was saved — none of the rejected attempts
      expect(responses).toHaveLength(1);
      const response: any = responses[0];
      expect(response).not.toHaveProperty('student_id');
      expect(response).not.toHaveProperty('participant_id');
      expect(response.submitted_at.toISOString()).toMatch(/T00:00:00\.000Z$/);

      expect(response.answers).toHaveLength(3);
      const comment = response.answers.find((a: any) => a.text_value !== null);
      expect(comment.text_value).toBe('Clear explanations.');
    });

    it('an empty optional comment is simply skipped -> 201', async () => {
      const res = await submit(openEvalId, student2Token, [
        { question_id: q1, rating_value: 3 },
        { question_id: q2, rating_value: 3 },
        { question_id: q3, text_value: '   ' },
      ]);
      expect(res.status).toBe(201);

      const latest = await prisma.responses.findMany({
        where: { evaluation_id: BigInt(openEvalId) },
        include: { answers: true },
        orderBy: { id: 'desc' },
        take: 1,
      });
      expect(latest[0].answers).toHaveLength(2);
    });

    it('two submissions at the same moment: exactly one succeeds', async () => {
      const [a, b] = await Promise.all([
        submit(openEvalId, student3Token, validAnswers()),
        submit(openEvalId, student3Token, validAnswers()),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);

      const count = await prisma.responses.count({ where: { evaluation_id: BigInt(openEvalId) } });
      expect(count).toBe(3); // student1 + student2 + student3 once
    });
  });
});