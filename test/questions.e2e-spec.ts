import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Questions (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let tempSurveyId: string;
  let draftVersionId: string;
  let archivedVersionId: string | undefined;
  let ratingQuestionId: string;
  let textQuestionId: string;

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const questionsUrl = () => `/api/survey-versions/${draftVersionId}/questions`;

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

    // A temporary survey with one DRAFT version, not used by any evaluation
    const survey = await request(app.getHttpServer())
      .post('/api/surveys')
      .set(auth())
      .send({ title: `E2E Questions ${Date.now()}` });
    tempSurveyId = survey.body.id;

    const version = await request(app.getHttpServer())
      .post(`/api/surveys/${tempSurveyId}/versions`)
      .set(auth())
      .send({});
    draftVersionId = version.body.id;
  }, 30000);

  afterAll(async () => {
    // Deleting a version also deletes its questions
    for (const id of [draftVersionId, archivedVersionId]) {
      if (id) {
        await request(app.getHttpServer())
          .delete(`/api/surveys/${tempSurveyId}/versions/${id}`)
          .set(auth());
      }
    }
    await request(app.getHttpServer()).delete(`/api/surveys/${tempSurveyId}`).set(auth());
    await app.close();
  });

  describe('access control', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get(questionsUrl())
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ question_text: 'Nope', question_type: 'TEXT' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/survey-versions/:versionId/questions', () => {
    it('RATING question gets range 1–5, order 1, required by default -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'The lecturer explains clearly.', question_type: 'RATING' });

      expect(res.status).toBe(201);
      expect(res.body.min_rating).toBe(1);
      expect(res.body.max_rating).toBe(5);
      expect(res.body.display_order).toBe(1);
      expect(res.body.is_required).toBe(true);
      ratingQuestionId = res.body.id;
    });

    it('TEXT question has no range and goes to the end -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Any comments?', question_type: 'TEXT', is_required: false });

      expect(res.status).toBe(201);
      expect(res.body.min_rating).toBeNull();
      expect(res.body.max_rating).toBeNull();
      expect(res.body.display_order).toBe(2);
      textQuestionId = res.body.id;
    });

    it('rejects a TEXT question with a rating range -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Bad', question_type: 'TEXT', min_rating: 1 });
      expect(res.status).toBe(400);
    });

    it('rejects min_rating not less than max_rating -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Bad', question_type: 'RATING', min_rating: 4, max_rating: 2 });
      expect(res.status).toBe(400);
    });

    it('rejects max_rating above 5 -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Bad', question_type: 'RATING', max_rating: 6 });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown question_type -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Bad', question_type: 'CHOICE' });
      expect(res.status).toBe(400);
    });

    it('rejects empty question_text -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: '', question_type: 'TEXT' });
      expect(res.status).toBe(400);
    });

    it('rejects a display_order already in use -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(questionsUrl())
        .set(auth())
        .send({ question_text: 'Clash', question_type: 'TEXT', display_order: 1 });
      expect(res.status).toBe(409);
    });

    it('survey version that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/survey-versions/999999/questions')
        .set(auth())
        .send({ question_text: 'Nope', question_type: 'TEXT' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/survey-versions/:versionId/questions', () => {
    it('lists questions in display order -> 200', async () => {
      const res = await request(app.getHttpServer()).get(questionsUrl()).set(auth());

      expect(res.status).toBe(200);
      expect(res.body.map((q: any) => q.display_order)).toEqual([1, 2]);
    });
  });

  describe('PUT /api/questions/:questionId', () => {
    it('ADMIN can edit the text -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/questions/${ratingQuestionId}`)
        .set(auth())
        .send({ question_text: 'The lecturer explains concepts clearly.' });

      expect(res.status).toBe(200);
      expect(res.body.question_text).toBe('The lecturer explains concepts clearly.');
    });

    it('changing RATING to TEXT clears the range -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/questions/${ratingQuestionId}`)
        .set(auth())
        .send({ question_type: 'TEXT' });

      expect(res.status).toBe(200);
      expect(res.body.question_type).toBe('TEXT');
      expect(res.body.min_rating).toBeNull();
      expect(res.body.max_rating).toBeNull();
    });

    it('question that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/questions/999999')
        .set(auth())
        .send({ question_text: 'Nope' });
      expect(res.status).toBe(404);
    });
  });

  describe('lock rule', () => {
    it('cannot add a question to a version used by an OPEN evaluation (seeded version 1) -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/survey-versions/1/questions')
        .set(auth())
        .send({ question_text: 'Sneaky', question_type: 'TEXT' });
      expect(res.status).toBe(409);
    });

    it('cannot edit a question in that version (seeded question 1) -> 409', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/questions/1')
        .set(auth())
        .send({ question_text: 'Changed after students answered' });
      expect(res.status).toBe(409);
    });

    it('cannot delete a question in that version (seeded question 1) -> 409', async () => {
      const res = await request(app.getHttpServer()).delete('/api/questions/1').set(auth());
      expect(res.status).toBe(409);
    });

    it('cannot add a question to an ARCHIVED version -> 409', async () => {
      const version = await request(app.getHttpServer())
        .post(`/api/surveys/${tempSurveyId}/versions`)
        .set(auth())
        .send({});
      archivedVersionId = version.body.id;

      await request(app.getHttpServer())
        .post(`/api/surveys/${tempSurveyId}/versions/${archivedVersionId}/archive`)
        .set(auth());

      const res = await request(app.getHttpServer())
        .post(`/api/survey-versions/${archivedVersionId}/questions`)
        .set(auth())
        .send({ question_text: 'Too late', question_type: 'TEXT' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/questions/:questionId', () => {
    it('ADMIN can delete a question in a DRAFT version -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/questions/${textQuestionId}`)
        .set(auth());
      expect(res.status).toBe(204);
    });

    it('deleting it again -> 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/questions/${textQuestionId}`)
        .set(auth());
      expect(res.status).toBe(404);
    });
  });
});