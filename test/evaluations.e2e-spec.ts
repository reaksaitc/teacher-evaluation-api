import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Evaluations (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let adminId: string;

  // Temporary data created for these tests
  let tempSurveyId: string;
  let versionWithQuestionsId: string;
  let emptyVersionId: string;
  let emptyOfferingId: string;
  let evalId: string; // the main evaluation, opened and closed during the tests
  const createdEvalIds: string[] = [];

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  const createEval = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/evaluations').set(auth()).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const login = (email: string) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Password123' })
        .then((res) => res.body.access_token);

    adminToken = await login('admin@itc.edu.kh');
    studentToken = await login('student1@itc.edu.kh');
    lecturerToken = await login('sokdara@itc.edu.kh');

    const me = await request(app.getHttpServer()).get('/api/auth/me').set(auth());
    adminId = me.body.id;

    // Survey with two versions: one with a question, one empty
    const survey = await request(app.getHttpServer())
      .post('/api/surveys')
      .set(auth())
      .send({ title: `E2E Evaluations ${stamp}` });
    tempSurveyId = survey.body.id;

    const v1 = await request(app.getHttpServer())
      .post(`/api/surveys/${tempSurveyId}/versions`)
      .set(auth())
      .send({});
    versionWithQuestionsId = v1.body.id;

    await request(app.getHttpServer())
      .post(`/api/survey-versions/${versionWithQuestionsId}/questions`)
      .set(auth())
      .send({ question_text: 'The lecturer explains clearly.', question_type: 'RATING' });

    const v2 = await request(app.getHttpServer())
      .post(`/api/surveys/${tempSurveyId}/versions`)
      .set(auth())
      .send({});
    emptyVersionId = v2.body.id;

    // An offering with no students enrolled
    const offering = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set(auth())
      .send({ course_id: '2', lecturer_id: '2', semester_id: '1', section_code: `E2E-EVAL-${stamp}` });
    emptyOfferingId = offering.body.id;
  }, 30000);

  afterAll(async () => {
    // Opened/closed evaluations can't be deleted through the API, so clean up directly
    const prisma = app.get(PrismaService);
    const evalIds = createdEvalIds.map((id) => BigInt(id));
    const versionIds = [versionWithQuestionsId, emptyVersionId].filter(Boolean).map((id) => BigInt(id));

    await prisma.evaluation_participants.deleteMany({ where: { evaluation_id: { in: evalIds } } });
    await prisma.evaluations.deleteMany({ where: { id: { in: evalIds } } });
    await prisma.questions.deleteMany({ where: { survey_version_id: { in: versionIds } } });
    await prisma.survey_versions.deleteMany({ where: { id: { in: versionIds } } });
    if (tempSurveyId) await prisma.surveys.delete({ where: { id: BigInt(tempSurveyId) } });
    if (emptyOfferingId) await prisma.course_offerings.delete({ where: { id: BigInt(emptyOfferingId) } });

    await app.close();
  });

  describe('access control', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/evaluations')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/evaluations')
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ course_offering_id: '1', survey_version_id: versionWithQuestionsId });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/evaluations', () => {
    it('ADMIN creates a DRAFT evaluation -> 201', async () => {
      const res = await createEval({ course_offering_id: '1', survey_version_id: versionWithQuestionsId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.created_by).toBe(adminId);
      evalId = res.body.id;
      createdEvalIds.push(evalId);
    });

    it('same offering + version again -> 409', async () => {
      const res = await createEval({ course_offering_id: '1', survey_version_id: versionWithQuestionsId });
      expect(res.status).toBe(409);
    });

    it('course offering that does not exist -> 400', async () => {
      const res = await createEval({ course_offering_id: '999999', survey_version_id: versionWithQuestionsId });
      expect(res.status).toBe(400);
    });

    it('survey version that does not exist -> 400', async () => {
      const res = await createEval({ course_offering_id: '1', survey_version_id: '999999' });
      expect(res.status).toBe(400);
    });

    it('end_at before start_at -> 400', async () => {
      const res = await createEval({
        course_offering_id: '1',
        survey_version_id: emptyVersionId,
        start_at: nextWeek,
        end_at: hourAgo,
      });
      expect(res.status).toBe(400);
    });

    it('invalid date string -> 400', async () => {
      const res = await createEval({
        course_offering_id: '1',
        survey_version_id: emptyVersionId,
        start_at: 'tomorrow',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/evaluations', () => {
    it('filter by status=DRAFT returns only drafts, including ours -> 200', async () => {
      const res = await request(app.getHttpServer()).get('/api/evaluations?status=DRAFT').set(auth());

      expect(res.status).toBe(200);
      expect(res.body.every((e: any) => e.status === 'DRAFT')).toBe(true);
      expect(res.body.some((e: any) => e.id === evalId)).toBe(true);
    });

    it('get one shows course, lecturer, and counts -> 200', async () => {
      const res = await request(app.getHttpServer()).get(`/api/evaluations/${evalId}`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.course_offerings.courses.course_code).toBe('CS301');
      expect(res.body.course_offerings.users.password_hash).toBeUndefined();
      expect(res.body._count.evaluation_participants).toBe(0);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer()).get('/api/evaluations/999999').set(auth());
      expect(res.status).toBe(404);
    });
  });

  describe('schedule and open', () => {
    it('cannot open without dates -> 400', async () => {
      const res = await request(app.getHttpServer()).post(`/api/evaluations/${evalId}/open`).set(auth());
      expect(res.status).toBe(400);
    });

    it('schedule with end before start -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ start_at: nextWeek, end_at: hourAgo });
      expect(res.status).toBe(400);
    });

    it('set a valid schedule -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ start_at: hourAgo, end_at: nextWeek });

      expect(res.status).toBe(200);
      expect(res.body.end_at).toBe(nextWeek);
    });

    it('cannot open when the version has no questions -> 400 (and a DRAFT can be deleted -> 204)', async () => {
      const created = await createEval({
        course_offering_id: '1',
        survey_version_id: emptyVersionId,
        start_at: hourAgo,
        end_at: nextWeek,
      });
      createdEvalIds.push(created.body.id);

      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${created.body.id}/open`)
        .set(auth());
      expect(res.status).toBe(400);

      const del = await request(app.getHttpServer())
        .delete(`/api/evaluations/${created.body.id}`)
        .set(auth());
      expect(del.status).toBe(204);
    });

    it('cannot open when no students are enrolled -> 400', async () => {
      const created = await createEval({
        course_offering_id: emptyOfferingId,
        survey_version_id: versionWithQuestionsId,
        start_at: hourAgo,
        end_at: nextWeek,
      });
      createdEvalIds.push(created.body.id);

      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${created.body.id}/open`)
        .set(auth());
      expect(res.status).toBe(400);
    });

    it('opening registers every enrolled student as a participant -> 200', async () => {
      const enrolled = await request(app.getHttpServer())
        .get('/api/course-offerings/1/enrollments')
        .set(auth());

      const res = await request(app.getHttpServer()).post(`/api/evaluations/${evalId}/open`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OPEN');
      expect(res.body._count.evaluation_participants).toBe(enrolled.body.length);
    });

    it('opening locks the survey version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/surveys/${tempSurveyId}/versions/${versionWithQuestionsId}`)
        .set(auth());

      expect(res.body.status).toBe('LOCKED');
      expect(res.body.locked_at).not.toBeNull();
    });

    it('questions in the locked version can no longer be added -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/survey-versions/${versionWithQuestionsId}/questions`)
        .set(auth())
        .send({ question_text: 'Too late', question_type: 'TEXT' });
      expect(res.status).toBe(409);
    });
  });

  describe('while OPEN', () => {
    it('opening again -> 409', async () => {
      const res = await request(app.getHttpServer()).post(`/api/evaluations/${evalId}/open`).set(auth());
      expect(res.status).toBe(409);
    });

    it('schedule can no longer change -> 409', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ end_at: nextWeek });
      expect(res.status).toBe(409);
    });

    it('cannot be deleted -> 409', async () => {
      const res = await request(app.getHttpServer()).delete(`/api/evaluations/${evalId}`).set(auth());
      expect(res.status).toBe(409);
    });
  });

  describe('close', () => {
    it('ADMIN closes an OPEN evaluation -> 200', async () => {
      const res = await request(app.getHttpServer()).post(`/api/evaluations/${evalId}/close`).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLOSED');
    });

    it('closing again -> 409', async () => {
      const res = await request(app.getHttpServer()).post(`/api/evaluations/${evalId}/close`).set(auth());
      expect(res.status).toBe(409);
    });
  });
});