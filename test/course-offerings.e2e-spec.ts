import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { class_type } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Course Offerings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let createdOfferingId: string;
  let studentId: string;
  let protectedOfferingId: bigint;

  let courseId: bigint | undefined;
  let semesterId: bigint | undefined;
  let academicYearId: bigint | undefined;

  const testSection = `E2E-${Date.now()}`;
  const testCourseCode = `E2E-CO-${Date.now()}`;

  let validBody: {
    year_level: number;
    course_id: string;
    lecturer_id: string;
    semester_id: string;
    class_type: class_type;
    section_code: string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const login = async (identifier: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier, password: 'Password123' });

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.access_token.length).toBeGreaterThan(0);

      return res.body.access_token;
    };

    adminToken = await login('admin@itc.edu.kh');
    studentToken = await login('student1@itc.edu.kh');
    lecturerToken = await login('sokdara@itc.edu.kh');

    const student = await prisma.users.findUniqueOrThrow({
      where: { email: 'student1@itc.edu.kh' },
    });
    const lecturer = await prisma.users.findUniqueOrThrow({
      where: { email: 'sokdara@itc.edu.kh' },
    });
    const department = await prisma.departments.findUniqueOrThrow({
      where: { code: 'AMS' },
    });

    studentId = student.id.toString();

    const fixtures = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const academicYear = await tx.academic_years.create({
        data: {
          name: `CO-${Date.now()}`,
          start_year: 2026,
          is_active: false,
        },
      });

      const semester = await tx.semesters.create({
        data: {
          academic_year_id: academicYear.id,
          semester_name: 'Course Offerings E2E',
          created_at: now,
          updated_at: now,
        },
      });

      const course = await tx.courses.create({
        data: {
          course_code: testCourseCode,
          course_name: 'Course Offerings E2E Course',
          department_id: department.id,
          created_at: now,
          updated_at: now,
        },
      });

      const major = await tx.majors.findFirstOrThrow({
        where: { department_id: department.id },
      });
      for (const level of [1, 2])
        await tx.course_year_rules.create({
          data: {
            course_id: course.id,
            major_id: major.id,
            year_level: level,
            revisions: {
              create: {
                revision_no: 1,
                effective_academic_year_id: academicYear.id,
                effective_start_year: 2026,
                enabled: true,
              },
            },
          },
        });
      const protectedOffering = await tx.course_offerings.create({
        data: {
          course_id: course.id,
          lecturer_id: lecturer.id,
          semester_id: semester.id,
          class_type: class_type.COURSE,
          section_code: `${testSection}-PROTECTED`,
          created_at: now,
          updated_at: now,
        },
      });

      await tx.enrollments.create({
        data: {
          course_offering_id: protectedOffering.id,
          student_id: student.id,
          enrolled_at: now,
        },
      });

      return {
        academicYearId: academicYear.id,
        semesterId: semester.id,
        courseId: course.id,
        protectedOfferingId: protectedOffering.id,
      };
    });

    academicYearId = fixtures.academicYearId;
    semesterId = fixtures.semesterId;
    courseId = fixtures.courseId;
    protectedOfferingId = fixtures.protectedOfferingId;

    validBody = {
      year_level: 1,
      course_id: courseId.toString(),
      lecturer_id: lecturer.id.toString(),
      semester_id: semesterId.toString(),
      class_type: class_type.COURSE,
      section_code: testSection,
    };
  }, 30000);

  afterAll(async () => {
    try {
      if (prisma && courseId !== undefined) {
        await prisma.$transaction(async (tx) => {
          const offerings = await tx.course_offerings.findMany({
            where: { course_id: courseId! },
            select: { id: true },
          });
          const offeringIds = offerings.map((offering) => offering.id);

          await tx.enrollments.deleteMany({
            where: { course_offering_id: { in: offeringIds } },
          });
          await tx.course_offering_group_scopes.deleteMany({
            where: { course_offering_id: { in: offeringIds } },
          });
          await tx.course_offerings.deleteMany({
            where: { id: { in: offeringIds } },
          });
          await tx.curriculum_revisions.deleteMany({
            where: { rule: { course_id: courseId } },
          });
          await tx.course_year_rules.deleteMany({
            where: { course_id: courseId },
          });
          await tx.courses.delete({
            where: { id: courseId! },
          });
          await tx.semesters.delete({
            where: { id: semesterId! },
          });
          await tx.academic_years.delete({
            where: { id: academicYearId! },
          });
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('POST /api/course-offerings', () => {
    it('rejects a new offering without class_type -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          course_id: validBody.course_id,
          lecturer_id: validBody.lecturer_id,
          semester_id: validBody.semester_id,
          section_code: `${testSection}-NO-TYPE`,
        });

      expect(res.status).toBe(400);
    });

    it('ADMIN can create an offering -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.section_code).toBe(testSection);
      expect(res.body.courses.course_code).toBe(testCourseCode);
      expect(res.body.class_type).toBe(class_type.COURSE);
      expect(res.body.users.password_hash).toBeUndefined();
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
        .send({ ...validBody, lecturer_id: studentId, section_code: 'X' });

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
    const noSectionBody = () => ({
      course_id: validBody.course_id,
      lecturer_id: validBody.lecturer_id,
      semester_id: validBody.semester_id,
      class_type: class_type.TD,
      year_level: 1,
    });

    it('first offering without a section -> 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noSectionBody());

      expect(res.status).toBe(201);
      expect(res.body.section_code).toBeNull();
      noSectionId = res.body.id;
    });

    it('same offering without a section again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/course-offerings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noSectionBody());

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
      expect(res.body.map((offering: any) => offering.id)).toContain(
        String(protectedOfferingId),
      );
      expect(res.body.map((offering: any) => offering.id)).not.toContain(
        createdOfferingId,
      );
      for (const offering of res.body) {
        expect(offering.users.password_hash).toBeUndefined();
      }
    });

    it('students can read an enrolled offering but cannot read another offering', async () => {
      const enrolled = await request(app.getHttpServer())
        .get(`/api/course-offerings/${protectedOfferingId}`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(enrolled.status).toBe(200);
      expect(enrolled.body.users.password_hash).toBeUndefined();
      const unrelated = await request(app.getHttpServer())
        .get(`/api/course-offerings/${createdOfferingId}`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(unrelated.status).toBe(403);
    });

    it('lecturer reads remain available for owned offerings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/course-offerings')
        .set('Authorization', `Bearer ${lecturerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.map((offering: any) => offering.id)).toContain(
        createdOfferingId,
      );
      expect(
        res.body.every(
          (offering: any) => offering.lecturer_id === validBody.lecturer_id,
        ),
      ).toBe(true);
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
        .send({ lecturer_id: studentId });

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
    it('cannot delete an offering that has enrollments -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/course-offerings/${protectedOfferingId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);

      expect(
        await prisma.course_offerings.findUnique({
          where: { id: protectedOfferingId },
        }),
      ).not.toBeNull();

      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: protectedOfferingId },
        }),
      ).toBe(1);
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
