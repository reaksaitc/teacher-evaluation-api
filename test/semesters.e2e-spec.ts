import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Semesters (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let createdSemesterId: string;

  // Unique name per test run, so re-running never collides with a leftover row
  const testSemesterName = `E2E-${Date.now()}`;
  const testYear = '2025-2026';

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
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/semesters', () => {
    it('ADMIN can create a semester -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          semester_name: testSemesterName,
          academic_year: testYear,
          start_date: '2026-03-01',
          end_date: '2026-07-31',
        });

      expect(res.status).toBe(201);
      expect(res.body.semester_name).toBe(testSemesterName);
      createdSemesterId = res.body.id;
    });

    it('STUDENT is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ semester_name: 'Nope', academic_year: testYear });

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ semester_name: 'Nope', academic_year: testYear });

      expect(res.status).toBe(403);
    });

    it('rejects an empty semester_name -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ semester_name: '', academic_year: testYear });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid date string -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ semester_name: 'Bad Date', academic_year: testYear, start_date: 'not-a-date' });

      expect(res.status).toBe(400);
    });

    it('rejects end_date before start_date -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          semester_name: 'Backwards',
          academic_year: testYear,
          start_date: '2026-07-31',
          end_date: '2026-03-01',
        });

      expect(res.status).toBe(400);
    });

    it('rejects a duplicate semester_name + academic_year -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/semesters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ semester_name: testSemesterName, academic_year: testYear });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/semesters', () => {
    it('STUDENT can list semesters -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/semesters')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('nonexistent semester id -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/semesters/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/semesters/:id', () => {
    it('STUDENT is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/semesters/${createdSemesterId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ semester_name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('rejects an end_date earlier than the saved start_date -> 400', async () => {
      // Only end_date is sent; the service must compare it to the start_date already stored (2026-03-01)
      const res = await request(app.getHttpServer())
        .put(`/api/semesters/${createdSemesterId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ end_date: '2026-01-01' });

      expect(res.status).toBe(400);
    });

    it('ADMIN can update -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/semesters/${createdSemesterId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ end_date: '2026-08-15' });

      expect(res.status).toBe(200);
      expect(res.body.end_date).toBe('2026-08-15T00:00:00.000Z');
    });
  });

  describe('DELETE /api/semesters/:id', () => {
    it('cannot delete a semester used by course offerings -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/semesters/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
    });

    it('STUDENT is blocked from deleting -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/semesters/${createdSemesterId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can delete an unused semester -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/semesters/${createdSemesterId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });
  });
});