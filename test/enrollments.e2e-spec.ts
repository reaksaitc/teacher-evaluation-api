import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Enrollments (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let testOfferingId: string;

  // Seeded data: student 4 = student1, user 2 = Sok Dara (LECTURER)
  const enrollUrl = () => `/api/course-offerings/${testOfferingId}/enrollments`;

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

    // Create a temporary offering just for these tests, so seed data is never touched
    const offering = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ course_id: '2', lecturer_id: '2', semester_id: '1', section_code: `E2E-ENR-${Date.now()}` });
    testOfferingId = offering.body.id;
  }, 30000);

  afterAll(async () => {
    // Remove the temporary offering (its enrollments are removed by the tests below)
    await request(app.getHttpServer())
      .delete(`/api/course-offerings/${testOfferingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    await app.close();
  });

  describe('GET /api/course-offerings/:offeringId/enrollments', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings/1/enrollments')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings/1/enrollments')
        .set('Authorization', `Bearer ${lecturerToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can list enrollments, and no password_hash is exposed -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings/1/enrollments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const enrollment of res.body) {
        expect(enrollment.users.password_hash).toBeUndefined();
      }
    });

    it('offering that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings/999999/enrollments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/course-offerings/:offeringId/enrollments', () => {
    it('ADMIN can enroll a student -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: '4' });

      expect(res.status).toBe(201);
      expect(res.body.users.email).toBe('student1@itc.edu.kh');
    });

    it('same student again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: '4' });

      expect(res.status).toBe(409);
    });

    it('rejects a LECTURER as student_id -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: '2' });

      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric student_id -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: 'abc' });

      expect(res.status).toBe(400);
    });

    it('rejects a student_id that does not exist -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: '999999' });

      expect(res.status).toBe(400);
    });

    it('offering that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings/999999/enrollments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: '4' });

      expect(res.status).toBe(404);
    });

    it('STUDENT is blocked from enrolling -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ student_id: '5' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/course-offerings/:offeringId/enrollments/:studentId', () => {
    it('STUDENT is blocked from removing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/4`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can remove a student -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/4`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('removing the same student again -> 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/4`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});