import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Comments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let sokDaraToken: string;
  let chanThyToken: string;
  let studentTokens: string[];

  let tempSurveyId: string;
  const versionIds: string[] = [];
  const evalIds: string[] = [];
  let closedEvalId: string;
  let openEvalId: string;
  let ratingQ: string;
  let likedQ: string;
  let improveQ: string;

  const stamp = Date.now();
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const admin = () => as(adminToken);
  const comments = (evalId: string, token: string) =>
    api().get(`/api/lecturer/evaluations/${evalId}/comments`).set(as(token));

  async function newVersion(questions: Record<string, unknown>[]) {
    const id = (await api().post(`/api/surveys/${tempSurveyId}/versions`).set(admin()).send({})).body.id as string;
    versionIds.push(id);
    const qIds: string[] = [];
    for (const q of questions) {
      qIds.push((await api().post(`/api/survey-versions/${id}/questions`).set(admin()).send(q)).body.id);
    }
    return { id, qIds };
  }

  async function newOpenEvaluation(offeringId: string, versionId: string) {
    const id = (
      await api()
        .post('/api/evaluations')
        .set(admin())
        .send({ course_offering_id: offeringId, survey_version_id: versionId, start_at: hourAgo, end_at: nextWeek })
    ).body.id as string;
    evalIds.push(id);
    await api().post(`/api/evaluations/${id}/open`).set(admin());
    return id;
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
    sokDaraToken = await login('sokdara@itc.edu.kh');
    chanThyToken = await login('chanthy@itc.edu.kh');
    studentTokens = [
      await login('student1@itc.edu.kh'),
      await login('student2@itc.edu.kh'),
      await login('student3@itc.edu.kh'),
    ];

    tempSurveyId = (await api().post('/api/surveys').set(admin()).send({ title: `E2E Comments ${stamp}` })).body.id;

    const main = await newVersion([
      { question_text: 'Overall', question_type: 'RATING' },
      { question_text: 'What did you like?', question_type: 'TEXT', is_required: false },
      { question_text: 'What could improve?', question_type: 'TEXT', is_required: false },
    ]);
    [ratingQ, likedQ, improveQ] = main.qIds;
    const other = await newVersion([{ question_text: 'Overall', question_type: 'RATING' }]);

    closedEvalId = await newOpenEvaluation('1', main.id);

    // Submitted in NON-alphabetical order on purpose
    const submissions = [
      [{ question_id: likedQ, text_value: 'Zebra examples' }, { question_id: improveQ, text_value: 'Slower pace' }],
      [{ question_id: likedQ, text_value: 'Apple slides' }, { question_id: improveQ, text_value: '' }],
      [{ question_id: improveQ, text_value: 'More labs' }],
    ];
    for (let i = 0; i < 3; i++) {
      await api()
        .post(`/api/student/evaluations/${closedEvalId}/responses`)
        .set(as(studentTokens[i]))
        .send({ answers: [{ question_id: ratingQ, rating_value: 4 }, ...submissions[i]] });
    }
    await api().post(`/api/evaluations/${closedEvalId}/close`).set(admin());

    openEvalId = await newOpenEvaluation('1', other.id);
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
      expect((await comments(closedEvalId, studentTokens[0])).status).toBe(403);
    });

    it('ADMIN is blocked -> 403', async () => {
      expect((await comments(closedEvalId, adminToken)).status).toBe(403);
    });
  });

  describe('GET /api/lecturer/evaluations/:id/comments', () => {
    it('returns all comments of my closed evaluation -> 200', async () => {
      const res = await comments(closedEvalId, sokDaraToken);

      expect(res.status).toBe(200);
      expect(res.body.course.code).toBe('CS301');
      expect(res.body.comment_count).toBe(4);
    });

    it('comments are grouped by question and sorted alphabetically, not by submission order', async () => {
      const res = await comments(closedEvalId, sokDaraToken);
      const liked = res.body.questions.find((q: any) => q.question_id === likedQ);
      const improve = res.body.questions.find((q: any) => q.question_id === improveQ);

      expect(liked.comments).toEqual(['Apple slides', 'Zebra examples']);
      expect(improve.comments).toEqual(['More labs', 'Slower pace']);
    });

    it('an empty comment never appears', async () => {
      const res = await comments(closedEvalId, sokDaraToken);
      const improve = res.body.questions.find((q: any) => q.question_id === improveQ);
      expect(improve.comment_count).toBe(2);
    });

    it('RATING questions are not included', async () => {
      const res = await comments(closedEvalId, sokDaraToken);
      expect(res.body.questions.some((q: any) => q.question_id === ratingQ)).toBe(false);
    });

    it('comments are plain text with nothing that identifies a student', async () => {
      const res = await comments(closedEvalId, sokDaraToken);
      const body = JSON.stringify(res.body).toLowerCase();

      for (const q of res.body.questions) {
        for (const c of q.comments) expect(typeof c).toBe('string');
      }
      expect(body).not.toContain('student');
      expect(body).not.toContain('participant');
      expect(body).not.toContain('email');
      expect(body).not.toContain('response_id');
      expect(body).not.toContain('submitted');
    });

    it('OPEN evaluation -> 409', async () => {
      expect((await comments(openEvalId, sokDaraToken)).status).toBe(409);
    });

    it("another lecturer's evaluation -> 403", async () => {
      expect((await comments(closedEvalId, chanThyToken)).status).toBe(403);
    });

    it('evaluation that does not exist -> 404', async () => {
      expect((await comments('999999', sokDaraToken)).status).toBe(404);
    });

    it('non-numeric id -> 400', async () => {
      expect((await comments('abc', sokDaraToken)).status).toBe(400);
    });
  });
});