import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Surveys (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let adminId: string;
  let createdSurveyId: string;

  const testTitle = `E2E Survey ${Date.now()}`;

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
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('access control', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/surveys')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/surveys')
        .set('Authorization', `Bearer ${lecturerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/surveys', () => {
    it('ADMIN can create a survey; creator is the logged-in admin -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: testTitle, description: 'Created by e2e test' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe(testTitle);
      expect(res.body.created_by).toBe(adminId);
      expect(res.body.users.full_name).toBe('System Admin');
      expect(res.body.survey_versions).toEqual([]);
      createdSurveyId = res.body.id;
    });

    it('created_by sent in the body is ignored -> creator is still the admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `${testTitle} spoof`, created_by: '4' });

      expect(res.status).toBe(201);
      expect(res.body.created_by).toBe(adminId);

      // Clean up this extra survey straight away
      await request(app.getHttpServer())
        .delete(`/api/surveys/${res.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('rejects an empty title -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a title longer than 200 characters -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/surveys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'x'.repeat(201) });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/surveys', () => {
    it('ADMIN can list surveys -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/surveys')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('ADMIN can get one survey with its versions -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.survey_versions)).toBe(true);
    });

    it('nonexistent survey id -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/surveys/999999')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/surveys/:id', () => {
    it('ADMIN can update -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `${testTitle} updated` });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe(`${testTitle} updated`);
    });

    it('rejects an empty title on update -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: '' });
      expect(res.status).toBe(400);
    });

    it('STUDENT is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ title: 'Hacked' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/surveys/:id', () => {
    it('cannot delete a survey that has versions (seeded survey 1) -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/surveys/1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('STUDENT is blocked from deleting -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('ADMIN can delete a survey with no versions -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('deleted survey is gone -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/surveys/${createdSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });
});