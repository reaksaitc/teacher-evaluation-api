import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Student Access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string; // student1, user id 4
  let lecturerToken: string;

  let tempSurveyId: string;
  let versionAId: string;
  let versionBId: string;
  let tempOfferingId: string;
  let openEvalId: string; // OPEN, student1 is a participant
  let closedEvalId: string; // CLOSED, student1 is a participant
  let otherEvalId: string; // OPEN, only student2 is a participant

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const student = () => ({ Authorization: `Bearer ${studentToken}` });
  const api = () => request(app.getHttpServer());

  async function createOpenEvaluation(offeringId: string, versionId: string) {
    const created = await api()
      .post('/api/evaluations')
      .set(admin())
      .send({ course_offering_id: offeringId, survey_version_id: versionId, start_at: hourAgo, end_at: nextWeek });
    await api().post(`/api/evaluations/${created.body.id}/open`).set(admin());
    return created.body.id as string;
  }

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
    studentToken = await login('student1@itc.edu.kh');
    lecturerToken = await login('sokdara@itc.edu.kh');

    // Survey with two versions, each with questions
    const survey = await api().post('/api/surveys').set(admin()).send({ title: `E2E Student ${stamp}` });
    tempSurveyId = survey.body.id;

    versionAId = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id;
    await api()
      .post(`/api/survey-versions/${versionAId}/questions`)
      .set(admin())
      .send({ question_text: 'The lecturer explains clearly.', question_type: 'RATING' });
    await api()
      .post(`/api/survey-versions/${versionAId}/questions`)
      .set(admin())
      .send({ question_text: 'Any comments?', question_type: 'TEXT', is_required: false });

    versionBId = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id;
    await api()
      .post(`/api/survey-versions/${versionBId}/questions`)
      .set(admin())
      .send({ question_text: 'Overall rating', question_type: 'RATING' });

    // Offering 1 has all five seeded students enrolled
    openEvalId = await createOpenEvaluation('1', versionAId);
    closedEvalId = await createOpenEvaluation('1', versionBId);
    await api().post(`/api/evaluations/${closedEvalId}/close`).set(admin());

    // A separate offering where only student2 (user 5) is enrolled
    const offering = await api()
      .post('/api/course-offerings')
      .set(admin())
      .send({ course_id: '2', lecturer_id: '2', semester_id: '1', section_code: `E2E-STU-${stamp}` });
    tempOfferingId = offering.body.id;
    await api()
      .post(`/api/course-offerings/${tempOfferingId}/enrollments`)
      .set(admin())
      .send({ student_id: '5' });
    otherEvalId = await createOpenEvaluation(tempOfferingId, versionBId);
  }, 60000);

  afterAll(async () => {
    const evalIds = [openEvalId, closedEvalId, otherEvalId].filter(Boolean).map((id) => BigInt(id));
    const versionIds = [versionAId, versionBId].filter(Boolean).map((id) => BigInt(id));

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
    it('ADMIN is blocked from student routes -> 403', async () => {
      const res = await api().get('/api/student/evaluations').set(admin());
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from student routes -> 403', async () => {
      const res = await api().get('/api/student/evaluations').set('Authorization', `Bearer ${lecturerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/student/evaluations', () => {
    it('shows an open evaluation I am part of, without internal ids -> 200', async () => {
      const res = await api().get('/api/student/evaluations').set(student());
      const mine = res.body.find((e: any) => e.id === openEvalId);

      expect(res.status).toBe(200);
      expect(mine).toBeDefined();
      expect(mine.course.code).toBe('CS301');
      expect(mine.lecturer.full_name).toBe('Sok Dara');
      expect(mine).not.toHaveProperty('course_offering_id');
      expect(mine).not.toHaveProperty('survey_version_id');
    });

    it('does not show a CLOSED evaluation', async () => {
      const res = await api().get('/api/student/evaluations').set(student());
      expect(res.body.some((e: any) => e.id === closedEvalId)).toBe(false);
    });

    it('does not show an evaluation for a class I am not in', async () => {
      const res = await api().get('/api/student/evaluations').set(student());
      expect(res.body.some((e: any) => e.id === otherEvalId)).toBe(false);
    });
  });

  describe('GET /api/student/evaluations/:id/survey', () => {
    it('returns the questions in order, with only student-facing fields -> 200', async () => {
      const res = await api().get(`/api/student/evaluations/${openEvalId}/survey`).set(student());

      expect(res.status).toBe(200);
      expect(res.body.evaluation.course.code).toBe('CS301');
      expect(res.body.questions.map((q: any) => q.display_order)).toEqual([1, 2]);
      expect(res.body.questions[0]).not.toHaveProperty('created_at');
    });

    it('CLOSED evaluation -> 409', async () => {
      const res = await api().get(`/api/student/evaluations/${closedEvalId}/survey`).set(student());
      expect(res.status).toBe(409);
    });

    it('evaluation for a class I am not in -> 403', async () => {
      const res = await api().get(`/api/student/evaluations/${otherEvalId}/survey`).set(student());
      expect(res.status).toBe(403);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await api().get('/api/student/evaluations/999999/survey').set(student());
      expect(res.status).toBe(404);
    });

    it('non-numeric id -> 400', async () => {
      const res = await api().get('/api/student/evaluations/abc/survey').set(student());
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/student/evaluations/:id/submission-status', () => {
    it('not submitted yet -> 200', async () => {
      const res = await api().get(`/api/student/evaluations/${openEvalId}/submission-status`).set(student());

      expect(res.status).toBe(200);
      expect(res.body.has_submitted).toBe(false);
    });

    it('evaluation I am not part of -> 403', async () => {
      const res = await api().get(`/api/student/evaluations/${otherEvalId}/submission-status`).set(student());
      expect(res.status).toBe(403);
    });
  });

  describe('after submitting', () => {
    beforeAll(async () => {
      // Simulate a submission (Feature 11 will do this for real)
      await prisma.evaluation_participants.updateMany({
        where: { evaluation_id: BigInt(openEvalId), student_id: BigInt(4) },
        data: { has_submitted: true, submitted_at: new Date() },
      });
    });

    it('status shows submitted -> 200', async () => {
      const res = await api().get(`/api/student/evaluations/${openEvalId}/submission-status`).set(student());

      expect(res.body.has_submitted).toBe(true);
      expect(res.body.submitted_at).not.toBeNull();
    });

    it('survey can no longer be opened -> 409', async () => {
      const res = await api().get(`/api/student/evaluations/${openEvalId}/survey`).set(student());
      expect(res.status).toBe(409);
    });

    it('it disappears from my available list', async () => {
      const res = await api().get('/api/student/evaluations').set(student());
      expect(res.body.some((e: any) => e.id === openEvalId)).toBe(false);
    });
  });
});