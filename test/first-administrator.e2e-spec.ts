import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
const requireModule = createRequire(`${process.cwd()}/package.json`);
const { provisionFirstAdministrator } = requireModule(
  './scripts/provision-first-admin.cjs',
);
describe('Empty-installation administrator provisioning (real PostgreSQL)', () => {
  const name = `teacher_evaluation_test_bootstrap_${Date.now()}`;
  let control: PrismaClient,
    db: PrismaClient,
    originalUrl: string,
    app: INestApplication;
  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL!;
    const url = new URL(originalUrl);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/teacher_evaluation_test')
    )
      throw new Error('Isolated test database required');
    control = new PrismaClient();
    await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    const migrated = spawnSync(
      process.execPath,
      [requireModule.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
      },
    );
    if (migrated.status !== 0)
      throw new Error('Disposable bootstrap database migration failed');
    process.env.DATABASE_URL = url.toString();
    db = new PrismaClient();
    // Old migrations insert placeholder year/department rows. Remove only these in this newly-created disposable database to exercise a truly empty installation.
    await db.academic_years.deleteMany();
    await db.departments.deleteMany();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.$disconnect();
    process.env.DATABASE_URL = originalUrl;
    // This exact disposable database was created by this test; it contains only its synthetic account.
    if (control && /^teacher_evaluation_test_bootstrap_\d+$/.test(name)) {
      await control.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      await control.$disconnect();
    }
  }, 30000);
  it('rejects malformed input before writing users or academic records', async () => {
    await expect(
      provisionFirstAdministrator(db, {
        full_name: '',
        email: 'invalid',
        password: 'short',
      }),
    ).rejects.toThrow();
    expect(await db.users.count()).toBe(0);
  });
  it('permits only one concurrent first administrator and allows sign-in/setup without academic prerequisites', async () => {
    const input = {
      full_name: 'Initial operator',
      email: 'operator@example.edu',
      password: 'OperatorPassword123',
    };
    const outcomes = await Promise.allSettled([
      provisionFirstAdministrator(db, input),
      provisionFirstAdministrator(db, { ...input, email: 'other@example.edu' }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.users.count()).toBe(1);
    expect(await db.departments.count()).toBe(0);
    expect(await db.academic_years.count()).toBe(0);
    expect(await db.students.count()).toBe(0);
    const saved = await db.users.findFirstOrThrow();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: saved.email, password: input.password });
    expect(login.status).toBe(200);
    const department = await request(app.getHttpServer())
      .post('/api/departments')
      .set({ Authorization: `Bearer ${login.body.access_token}` })
      .send({ code: 'FIRST', name: 'Initial department' });
    expect(department.status).toBe(201);
    await expect(provisionFirstAdministrator(db, input)).rejects.toThrow(
      'administrator already exists',
    );
    expect((await db.users.findFirstOrThrow()).password_hash).toBe(
      saved.password_hash,
    );
  });
});
