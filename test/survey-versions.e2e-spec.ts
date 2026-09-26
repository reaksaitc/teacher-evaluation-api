import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Survey Versions (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let adminId: string;
  let tempSurveyId: string;
  let v1Id: string;
  let v2Id: string;

  const base = () => `/api/surveys/${tempSurveyId}/versions`;

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

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    adminId = me.body.id;

    // A temporary survey just for these tests
    const survey = await request(app.getHttpServer())
      .post('/api/surveys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: `E2E Versions ${Date.now()}` });
    tempSurveyId = survey.body.id;
  }, 30000);

  afterAll(async () => {
    // v1 is deleted by a test; remove v2 and then the temporary survey
    if (v2Id) {
      await request(app.getHttpServer())
        .delete(`${base()}/${v2Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    await request(app.getHttpServer())
      .delete(`/api/surveys/${tempSurveyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    await app.close();
  });

  describe('access control', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get(base())
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/surveys/:surveyId/versions', () => {
    it('first version is numbered 1 and is a DRAFT -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.version_no).toBe(1);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.created_by).toBe(adminId);
      v1Id = res.body.id;
    });

    it('next version is numbered 2 automatically -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.version_no).toBe(2);
      v2Id = res.body.id;
    });

    it('rejects a non-boolean copy_questions -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copy_questions: 'yes' });
      expect(res.status).toBe(400);
    });

    it('survey that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys/999999/versions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('copy_questions copies the latest version\'s questions (seeded survey 1) -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys/1/versions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copy_questions: true });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.questions.length).toBeGreaterThan(0);
      expect(res.body.questions[0].display_order).toBe(1);

      // Clean up the copied version straight away (removes its questions too)
      const cleanup = await request(app.getHttpServer())
        .delete(`/api/surveys/1/versions/${res.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(cleanup.status).toBe(204);
    });
  });

  describe('GET', () => {
    it('lists versions in order -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get(base())
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.map((v: any) => v.version_no)).toEqual([1, 2]);
    });

    it('gets one version with its questions -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base()}/${v1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.questions)).toBe(true);
    });

    it('version requested under the wrong survey -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/surveys/1/versions/${v1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST .../:versionId/archive', () => {
    it('ADMIN can archive a version -> 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base()}/${v2Id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ARCHIVED');
    });

    it('archiving twice -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base()}/${v2Id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE .../:versionId', () => {
    it('cannot delete a version used by evaluations (seeded version 1) -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/surveys/1/versions/1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('ADMIN can delete an unused DRAFT version -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${base()}/${v1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('deleted version is gone -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base()}/${v1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });
});