import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Courses (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let createdCourseId: string;

  // Unique code per test run, so re-running tests never collides with a leftover row
  const testCourseCode = `E2E-${Date.now()}`;

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

  describe('POST /api/courses', () => {
    it('ADMIN can create a course -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ course_code: testCourseCode, course_name: 'E2E Test Course' });

      expect(res.status).toBe(201);
      expect(res.body.course_code).toBe(testCourseCode);
      createdCourseId = res.body.id;
    });

    it('STUDENT is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/courses')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ course_code: 'SHOULD-FAIL', course_name: 'Nope' });

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/courses')
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ course_code: 'SHOULD-FAIL-2', course_name: 'Nope' });

      expect(res.status).toBe(403);
    });

    it('rejects an empty course_code -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ course_code: '', course_name: 'Bad' });

      expect(res.status).toBe(400);
    });

    it('rejects a duplicate course_code -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ course_code: testCourseCode, course_name: 'Duplicate' });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/courses', () => {
    it('STUDENT can list courses -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/courses')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('nonexistent course id -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/courses/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/courses/:id', () => {
    it('STUDENT is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ course_name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ course_name: 'Hacked2' });

      expect(res.status).toBe(403);
    });

    it('rejects an empty course_code on update -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ course_code: '' });

      expect(res.status).toBe(400);
    });

    it('ADMIN can update -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ course_name: 'E2E Updated' });

      expect(res.status).toBe(200);
      expect(res.body.course_name).toBe('E2E Updated');
    });
  });

  describe('DELETE /api/courses/:id', () => {
    it('STUDENT is blocked from deleting -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can delete -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/courses/${createdCourseId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });
  });

  describe('Auth', () => {
    it('wrong password -> 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@itc.edu.kh', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('GET /api/auth/me returns the logged-in user -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('admin@itc.edu.kh');
      expect(res.body.role).toBe('ADMIN');
    });

    it('GET /api/auth/me without a token -> 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');

      expect(res.status).toBe(401);
    });
  });
});