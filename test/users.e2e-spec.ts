import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Users (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let adminId: string;
  let createdUserId: string | undefined;

  // Unique email per run; typed with capitals to test lowercase normalization
  const stamp = Date.now();
  const mixedCaseEmail = `E2E-User-${stamp}@ITC.edu.kh`;
  const expectedEmail = mixedCaseEmail.toLowerCase();

  const login = (email: string, password = 'Password123') =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    adminToken = (await login('admin@itc.edu.kh')).body.access_token;
    studentToken = (await login('student1@itc.edu.kh')).body.access_token;
    lecturerToken = (await login('sokdara@itc.edu.kh')).body.access_token;

    // Ask the API who the admin is, instead of assuming the id is 1
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    adminId = me.body.id;
  }, 30000);

  afterAll(async () => {
    // There is no DELETE route for users, so clean up directly in the database
    if (createdUserId) {
      const prisma = app.get(PrismaService);
      await prisma.users.delete({ where: { id: BigInt(createdUserId) } });
    }
    await app.close();
  });

  describe('GET /api/users', () => {
    it('STUDENT is blocked -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${lecturerToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can list users, and no password_hash is exposed -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const user of res.body) {
        expect(user.password_hash).toBeUndefined();
      }
    });

    it('filter by role returns only that role -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users?role=LECTURER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const user of res.body) {
        expect(user.role).toBe('LECTURER');
      }
    });

    it('rejects an invalid role filter -> 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users?role=TEACHER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('nonexistent user id -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/users', () => {
    it('ADMIN can create a user; email is lowercased and no password_hash is returned -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: mixedCaseEmail, password: 'Password123', full_name: 'E2E User', role: 'LECTURER' });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe(expectedEmail);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.password_hash).toBeUndefined();
      createdUserId = res.body.id;
    });

    it('same email in different letter case -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: expectedEmail, password: 'Password123', full_name: 'Duplicate', role: 'STUDENT' });

      expect(res.status).toBe(409);
    });

    it('rejects an invalid email -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'not-an-email', password: 'Password123', full_name: 'Bad', role: 'STUDENT' });

      expect(res.status).toBe(400);
    });

    it('rejects a password shorter than 6 characters -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: `short-${stamp}@itc.edu.kh`, password: '123', full_name: 'Bad', role: 'STUDENT' });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid role -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: `role-${stamp}@itc.edu.kh`, password: 'Password123', full_name: 'Bad', role: 'TEACHER' });

      expect(res.status).toBe(400);
    });

    it('the new account can log in -> 200', async () => {
      const res = await login(expectedEmail);

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('LECTURER');
    });
  });

  describe('PUT /api/users/:id', () => {
    it('STUDENT is blocked from updating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/users/${createdUserId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ full_name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('role cannot be changed, other fields can -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/users/${createdUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ADMIN', full_name: 'E2E User Updated' });

      expect(res.status).toBe(200);
      expect(res.body.full_name).toBe('E2E User Updated');
      expect(res.body.role).toBe('LECTURER');
    });

    it('ADMIN can change a password -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/users/${createdUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'NewPassword456' });

      expect(res.status).toBe(200);
    });

    it('new password works, old password no longer does', async () => {
      const withNew = await login(expectedEmail, 'NewPassword456');
      const withOld = await login(expectedEmail, 'Password123');

      expect(withNew.status).toBe(200);
      expect(withOld.status).toBe(401);
    });

    it('ADMIN can deactivate a user -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/users/${createdUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('deactivated user cannot log in -> 403', async () => {
      const res = await login(expectedEmail, 'NewPassword456');

      expect(res.status).toBe(403);
    });

    it('ADMIN cannot deactivate their own account -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(400);
    });
  });
});