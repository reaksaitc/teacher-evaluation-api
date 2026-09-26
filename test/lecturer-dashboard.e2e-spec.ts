import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Lecturer Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let sokDaraToken: string; // lecturer of offering 1
  let chanThyToken: string; // lecturer of offering 2
  let studentTokens: string[];

  let tempSurveyId: string;
  const versionIds: string[] = [];
  const evalIds: string[] = [];
  let closedEvalId: string; // Sok Dara, CLOSED, with 3 responses
  let openEvalId: string; // Sok Dara, OPEN
  let draftEvalId: string; // Sok Dara, DRAFT
  let chanThyEvalId: string; // Chan Thy, OPEN
  let q1: string;
  let q2: string;
  let q3: string;

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admin = () => as(adminToken);

  async function newVersion(questions: Record<string, unknown>[]) {
    const id = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id as string;
    versionIds.push(id);
    const qIds: string[] = [];
    for (const q of questions) {
      qIds.push((await api().post(`/api/survey-versions/${id}/questions`).set(admin()).send(q)).body.id);
    }
    return { id, qIds };
  }

  async function newEvaluation(offeringId: string, versionId: string, open: boolean) {
    const id = (
      await api()
        .post('/api/evaluations')
        .set(admin())
        .send({ course_offering_id: offeringId, survey_version_id: versionId, start_at: hourAgo, end_at: nextWeek })
    ).body.id as string;
    evalIds.push(id);
    if (open) await api().post(`/api/evaluations/${id}/open`).set(admin());
    return id;
  }

  const dashboard = (evalId: string, token: string) =>
    api().get(`/api/lecturer/evaluations/${evalId}/dashboard`).set(as(token));

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
    sokDaraToken = await login('sokdara@itc.edu.kh');
    chanThyToken = await login('chanthy@itc.edu.kh');
    studentTokens = [
      await login('student1@itc.edu.kh'),
      await login('student2@itc.edu.kh'),
      await login('student3@itc.edu.kh'),
    ];

    tempSurveyId = (await api().post('/api/surveys').set(admin()).send({ title: `E2E Dashboard ${stamp}` })).body.id;

    const main = await newVersion([
      { question_text: 'Explains clearly', question_type: 'RATING' },
      { question_text: 'Pace', question_type: 'RATING', max_rating: 3 },
      { question_text: 'Comments', question_type: 'TEXT', is_required: false },
    ]);
    [q1, q2, q3] = main.qIds;
    const other = await newVersion([{ question_text: 'Overall', question_type: 'RATING' }]);
    const third = await newVersion([{ question_text: 'Overall', question_type: 'RATING' }]);

    // Sok Dara's closed evaluation with three real submissions
    closedEvalId = await newEvaluation('1', main.id, true);
    const answers = [
      [5, 3, 'Great examples.'],
      [4, 3, ''],
      [5, 2, 'A bit fast.'],
    ] as const;
    for (let i = 0; i < 3; i++) {
      const [r1, r2, text] = answers[i];
      await api()
        .post(`/api/student/evaluations/${closedEvalId}/responses`)
        .set(as(studentTokens[i]))
        .send({
          answers: [
            { question_id: q1, rating_value: r1 },
            { question_id: q2, rating_value: r2 },
            { question_id: q3, text_value: text },
          ],
        });
    }
    await api().post(`/api/evaluations/${closedEvalId}/close`).set(admin());

    openEvalId = await newEvaluation('1', other.id, true);
    draftEvalId = await newEvaluation('1', third.id, false);
    chanThyEvalId = await newEvaluation('2', other.id, true);
  }, 90000);

  afterAll(async () => {
    const eIds = evalIds.map((id) => BigInt(id));
    const vIds = versionIds.map((id) => BigInt(id));

    await prisma.answers.deleteMany({ where: { responses: { evaluation_id: { in: eIds } } } });
    await prisma.responses.deleteMany({ where: { evaluation_id: { in: eIds } } });
    await prisma.evaluation_participants.deleteMany({ where: { evaluation_id: { in: eIds } } });
    await prisma.evaluations.deleteMany({ where: { id: { in: eIds } } });
    await prisma.questions.deleteMany({ where: { survey_version_id: { in: vIds } } });
    await prisma.survey_versions.deleteMany({ where: { id: { in: vIds } } });
    if (tempSurveyId) await prisma.surveys.delete({ where: { id: BigInt(tempSurveyId) } });

    await app.close();
  });

  describe('access control', () => {
    it('STUDENT is blocked -> 403', async () => {
      const res = await api().get('/api/lecturer/evaluations').set(as(studentTokens[0]));
      expect(res.status).toBe(403);
    });

    it('ADMIN is blocked -> 403', async () => {
      const res = await api().get('/api/lecturer/evaluations').set(admin());
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/lecturer/evaluations', () => {
    it('shows my open and closed evaluations with counts, not drafts', async () => {
      const res = await api().get('/api/lecturer/evaluations').set(as(sokDaraToken));
      const closed = res.body.find((e: any) => e.id === closedEvalId);
      const open = res.body.find((e: any) => e.id === openEvalId);

      expect(res.status).toBe(200);
      expect(closed.results_available).toBe(true);
      expect(closed.response_count).toBe(3);
      expect(open.results_available).toBe(false);
      expect(res.body.some((e: any) => e.id === draftEvalId)).toBe(false);
    });

    it("does not show another lecturer's evaluations", async () => {
      const mine = await api().get('/api/lecturer/evaluations').set(as(sokDaraToken));
      const theirs = await api().get('/api/lecturer/evaluations').set(as(chanThyToken));

      expect(mine.body.some((e: any) => e.id === chanThyEvalId)).toBe(false);
      expect(theirs.body.some((e: any) => e.id === closedEvalId)).toBe(false);
      expect(theirs.body.some((e: any) => e.id === chanThyEvalId)).toBe(true);
    });
  });

  describe('GET /api/lecturer/evaluations/:id/dashboard', () => {
    it('counts and response rate are correct -> 200', async () => {
      const res = await dashboard(closedEvalId, sokDaraToken);

      expect(res.status).toBe(200);
      expect(res.body.course.code).toBe('CS301');
      expect(res.body.eligible_count).toBe(5);
      expect(res.body.response_count).toBe(3);
      expect(res.body.response_rate).toBe(0.6);
    });

    it('per-question averages and distributions are exact', async () => {
      const res = await dashboard(closedEvalId, sokDaraToken);
      const question1 = res.body.questions.find((q: any) => q.question_id === q1);
      const question2 = res.body.questions.find((q: any) => q.question_id === q2);

      expect(question1.average).toBe(4.67);
      expect(question1.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 });
      expect(question2.average).toBe(2.67);
      expect(question2.distribution).toEqual({ '1': 0, '2': 1, '3': 2 });
    });

    it('overall average covers all rating answers', async () => {
      const res = await dashboard(closedEvalId, sokDaraToken);
      expect(res.body.overall_average).toBe(3.67);
    });

    it('TEXT questions are not part of the dashboard', async () => {
      const res = await dashboard(closedEvalId, sokDaraToken);
      expect(res.body.questions.some((q: any) => q.question_id === q3)).toBe(false);
    });

    it('contains nothing that identifies a student', async () => {
      const res = await dashboard(closedEvalId, sokDaraToken);
      const body = JSON.stringify(res.body).toLowerCase();

      expect(body).not.toContain('student');
      expect(body).not.toContain('participant');
      expect(body).not.toContain('email');
    });

    it('OPEN evaluation -> 409 (results only after closing)', async () => {
      const res = await dashboard(openEvalId, sokDaraToken);
      expect(res.status).toBe(409);
    });

    it("another lecturer's evaluation -> 403", async () => {
      const res = await dashboard(closedEvalId, chanThyToken);
      expect(res.status).toBe(403);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await dashboard('999999', sokDaraToken);
      expect(res.status).toBe(404);
    });

    it('non-numeric id -> 400', async () => {
      const res = await dashboard('abc', sokDaraToken);
      expect(res.status).toBe(400);
    });
  });
});