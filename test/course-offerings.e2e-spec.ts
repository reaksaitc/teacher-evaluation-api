import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Course Offerings (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let createdOfferingId: string;

  // Seeded data: course 2 = CS402, lecturer 2 = Sok Dara, semester 1, student 4 = student1
  // Unique section per run, so re-running never collides with a leftover row
  const testSection = `E2E-${Date.now()}`;
  const validBody = { course_id: '2', lecturer_id: '2', semester_id: '1', section_code: testSection };

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

  describe('POST /api/course-offerings', () => {
    it('ADMIN can create an offering -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.section_code).toBe(testSection);
      expect(res.body.courses.course_code).toBe('CS402');
      createdOfferingId = res.body.id;
    });

    it('STUDENT is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ ...validBody, section_code: 'NOPE' });

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({ ...validBody, section_code: 'NOPE' });

      expect(res.status).toBe(403);
    });

    it('rejects a non-numeric id -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validBody, course_id: 'abc' });

      expect(res.status).toBe(400);
    });

    it('rejects a STUDENT as lecturer_id -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validBody, lecturer_id: '4', section_code: 'X' });

      expect(res.status).toBe(400);
    });

    it('rejects a course_id that does not exist -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validBody, course_id: '999999' });

      expect(res.status).toBe(400);
    });

    it('rejects a semester_id that does not exist -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validBody, semester_id: '999999' });

      expect(res.status).toBe(400);
    });

    it('rejects a duplicate offering -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody);

      expect(res.status).toBe(409);
    });
  });

  describe('Duplicate check when section_code is empty', () => {
    let noSectionId: string;
    const noSectionBody = { course_id: '1', lecturer_id: '3', semester_id: '1' };

    it('first offering without a section -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noSectionBody);

      expect(res.status).toBe(201);
      expect(res.body.section_code).toBeNull();
      noSectionId = res.body.id;
    });

    it('same offering without a section again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noSectionBody);

      expect(res.status).toBe(409);
    });

    it('clean up the offering without a section -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/course-offerings/${noSectionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/course-offerings', () => {
    it('STUDENT can list offerings, and no password_hash is exposed -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const offering of res.body) {
        expect(offering.users.password_hash).toBeUndefined();
      }
    });

    it('nonexistent offering id -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/course-offerings/:id', () => {
    it('STUDENT is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ section_code: 'HACKED' });

      expect(res.status).toBe(403);
    });

    it('rejects changing lecturer_id to a STUDENT -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lecturer_id: '4' });

      expect(res.status).toBe(400);
    });

    it('ADMIN can update -> 200', async () => {
      const newSection = `${testSection}-U`;
      const res = await request(app.getHttpServer())
        .put(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ section_code: newSection });

      expect(res.status).toBe(200);
      expect(res.body.section_code).toBe(newSection);
    });
  });

  describe('DELETE /api/course-offerings/:id', () => {
    it('cannot delete an offering that has enrollments or evaluations -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/course-offerings/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
    });

    it('STUDENT is blocked from deleting -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can delete an unused offering -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });
  });
});