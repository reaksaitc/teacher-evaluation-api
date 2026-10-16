import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Enrollments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;

  let studentId: string;
  let lecturerId: string;
  let testOfferingId: string | undefined;

  let courseId: bigint | undefined;
  let semesterId: bigint | undefined;
  let academicYearId: bigint | undefined;

  const enrollUrl = () => {
    if (!testOfferingId) {
      throw new Error('Test offering was not created.');
    }

    return `/api/course-offerings/${testOfferingId}/enrollments`;
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

      // The auth controller explicitly returns HTTP 200 for successful login.
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
    lecturerId = lecturer.id.toString();

    const stamp = Date.now().toString();
    const now = new Date();

    const academicYear = await prisma.academic_years.create({
      data: {
        name: `E2E-${stamp}`,
        start_year: 2026,
        is_active: false,
      },
    });
    academicYearId = academicYear.id;
    const profile = await prisma.students.findUniqueOrThrow({
      where: { user_id: student.id },
    });
    const placement = await prisma.student_academic_records.findFirstOrThrow({
      where: { student_id: profile.id },
      orderBy: { id: 'desc' },
    });
    await prisma.student_academic_records.create({
      data: {
        student_id: profile.id,
        academic_year_id: academicYear.id,
        year_level: placement.year_level,
        major_id: placement.major_id,
        class_group: 'TEST-A',
      },
    });

    const semester = await prisma.semesters.create({
      data: {
        academic_year_id: academicYear.id,
        semester_name: 'Enrollment E2E',
        created_at: now,
        updated_at: now,
      },
    });
    semesterId = semester.id;

    const course = await prisma.courses.create({
      data: {
        course_code: `E2E-ENR-${stamp}`,
        course_name: 'Enrollment E2E Course',
        department_id: department.id,
        created_at: now,
        updated_at: now,
      },
    });
    courseId = course.id;
    await prisma.course_year_rules.create({
      data: {
        course_id: course.id,
        major_id: placement.major_id,
        year_level: placement.year_level,
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

    const offering = await request(app.getHttpServer())
      .post('/api/course-offerings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        course_id: course.id.toString(),
        lecturer_id: lecturerId,
        semester_id: semester.id.toString(),
        class_type: 'COURSE',
        year_level: placement.year_level,
        section_code: `E2E-ENR-${stamp}`,
      });

    expect(offering.status).toBe(201);
    expect(offering.body.id).toMatch(/^\d+$/);

    testOfferingId = offering.body.id;
  }, 30000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.$transaction(async (tx) => {
          if (testOfferingId) {
            const offeringId = BigInt(testOfferingId);

            await tx.enrollments.deleteMany({
              where: { course_offering_id: offeringId },
            });
            await tx.course_offering_group_scopes.deleteMany({
              where: { course_offering_id: offeringId },
            });
            await tx.course_offerings.deleteMany({
              where: { id: offeringId },
            });
          }

          if (courseId) {
            await tx.curriculum_revisions.deleteMany({
              where: { rule: { course_id: courseId } },
            });
            await tx.course_year_rules.deleteMany({
              where: { course_id: courseId },
            });
          }
          if (courseId !== undefined) {
            await tx.courses.deleteMany({
              where: { id: courseId },
            });
          }

          if (semesterId !== undefined) {
            await tx.semesters.deleteMany({
              where: { id: semesterId },
            });
          }

          if (academicYearId !== undefined) {
            await tx.student_academic_records.deleteMany({
              where: { academic_year_id: academicYearId },
            });
            await tx.academic_years.deleteMany({
              where: { id: academicYearId },
            });
          }
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('GET /api/course-offerings/:offeringId/enrollments', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get(enrollUrl())
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get(enrollUrl())
        .set('Authorization', `Bearer ${lecturerToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can list enrollments, and no password_hash is exposed -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get(enrollUrl())
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
        .send({ student_id: studentId });

      expect(res.status).toBe(201);
      expect(res.body.users.email).toBe('student1@itc.edu.kh');
      expect(res.body.users.password_hash).toBeUndefined();

      const saved = await prisma.enrollments.findFirst({
        where: {
          course_offering_id: BigInt(testOfferingId!),
          student_id: BigInt(studentId),
        },
      });

      expect(saved).not.toBeNull();
    });

    it('same student again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: studentId });

      expect(res.status).toBe(409);
    });

    it('rejects a LECTURER as student_id -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: lecturerId });

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
        .send({ student_id: studentId });

      expect(res.status).toBe(404);
    });

    it('STUDENT is blocked from enrolling -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post(enrollUrl())
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ student_id: studentId });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/course-offerings/:offeringId/enrollments/:studentId', () => {
    it('STUDENT is blocked from removing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/${studentId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('ADMIN can remove a student -> 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('removing the same student again -> 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${enrollUrl()}/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('Saved offering group scopes', () => {
    let scopedOfferingId: bigint;
    let generationId: bigint;
    let majorId: bigint;
    let matchingUserId: bigint;
    let outsideUserId: bigint;
    let missingPlacementUserId: bigint;
    let matchingRecordId: bigint;

    const createdUserIds: bigint[] = [];

    const scopedUrl = () =>
      `/api/course-offerings/${scopedOfferingId}/enrollments`;

    const selection = () => ({
      academic_year_id: academicYearId!.toString(),
      generation_id: generationId.toString(),
      major_id: majorId.toString(),
      year_level: 1,
      class_groups: ['A'],
    });

    beforeAll(async () => {
      const department = await prisma.departments.findUniqueOrThrow({
        where: { code: 'AMS' },
      });

      // All fixtures are committed together or rolled back together.
      const fixtures = await prisma.$transaction(async (tx) => {
        const stamp = Date.now().toString();
        const now = new Date();

        const generation = await tx.student_generations.create({
          data: {
            name: `E2E-SCOPE-${stamp}`,
            entry_academic_year_id: academicYearId!,
            starting_year_level: 1,
          },
        });

        const major = await tx.majors.create({
          data: {
            code: `E2E-${stamp}`,
            name: `Scope E2E ${stamp}`,
            department_id: department.id,
          },
        });

        const offering = await tx.course_offerings.create({
          data: {
            course_id: courseId!,
            lecturer_id: BigInt(lecturerId),
            semester_id: semesterId!,
            year_level: 1,
            class_type: 'TD',
            section_code: `SCOPE-${stamp}`,
            created_at: now,
            updated_at: now,
          },
        });

        await tx.course_offering_group_scopes.create({
          data: {
            course_offering_id: offering.id,
            academic_year_id: academicYearId!,
            generation_id: generation.id,
            major_id: major.id,
            year_level: 1,
            class_group: 'A',
          },
        });

        // Reuse a valid hash; these users never log in.
        const seedStudent = await tx.users.findUniqueOrThrow({
          where: { id: BigInt(studentId) },
        });

        const userIds: bigint[] = [];
        let recordId: bigint | undefined;

        for (const [index, group] of ['A', 'B', null].entries()) {
          const user = await tx.users.create({
            data: {
              email: `scope-${stamp}-${index}@example.test`,
              full_name: `Scope E2E Student ${index}`,
              password_hash: seedStudent.password_hash,
              role: 'STUDENT',
              status: 'ACTIVE',
              created_at: now,
              updated_at: now,
            },
          });

          userIds.push(user.id);

          const student = await tx.students.create({
            data: {
              user_id: user.id,
              student_code: `E2E-${stamp}-${index}`,
              generation_id: generation.id,
            },
          });

          if (group !== null) {
            const record = await tx.student_academic_records.create({
              data: {
                student_id: student.id,
                academic_year_id: academicYearId!,
                major_id: major.id,
                year_level: 1,
                class_group: group,
              },
            });

            if (index === 0) {
              recordId = record.id;
            }
          }
        }

        return {
          offeringId: offering.id,
          generationId: generation.id,
          majorId: major.id,
          userIds,
          recordId: recordId!,
        };
      });

      scopedOfferingId = fixtures.offeringId;
      generationId = fixtures.generationId;
      majorId = fixtures.majorId;
      createdUserIds.push(...fixtures.userIds);

      [matchingUserId, outsideUserId, missingPlacementUserId] =
        fixtures.userIds;

      matchingRecordId = fixtures.recordId;
    }, 30000);

    beforeEach(async () => {
      await prisma.enrollments.deleteMany({
        where: { course_offering_id: scopedOfferingId },
      });

      await prisma.student_academic_records.update({
        where: { id: matchingRecordId },
        data: { class_group: 'A' },
      });
    });

    afterAll(async () => {
      // No fixture IDs are assigned if the setup transaction fails.
      if (createdUserIds.length === 0) {
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.enrollments.deleteMany({
          where: { course_offering_id: scopedOfferingId },
        });
        await tx.course_offering_group_scopes.deleteMany({
          where: { course_offering_id: scopedOfferingId },
        });
        await tx.course_offerings.delete({
          where: { id: scopedOfferingId },
        });
        await tx.student_academic_records.deleteMany({
          where: {
            students: { user_id: { in: createdUserIds } },
          },
        });
        await tx.students.deleteMany({
          where: { user_id: { in: createdUserIds } },
        });
        await tx.users.deleteMany({
          where: { id: { in: createdUserIds } },
        });
        await tx.student_generations.delete({
          where: { id: generationId },
        });
        await tx.majors.delete({
          where: { id: majorId },
        });
      });
    });

    it('enrolls a student whose placement matches the saved scope', async () => {
      const res = await request(app.getHttpServer())
        .post(scopedUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: matchingUserId.toString() });

      expect(res.status).toBe(201);
      expect(res.body.users.id).toBe(matchingUserId.toString());
      expect(res.body.users.password_hash).toBeUndefined();

      const rows = await prisma.enrollments.findMany({
        where: { course_offering_id: scopedOfferingId },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].student_id).toBe(matchingUserId);
    });

    it('rejects a student outside the saved group without writing', async () => {
      const res = await request(app.getHttpServer())
        .post(scopedUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: outsideUserId.toString() });

      expect(res.status).toBe(400);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: scopedOfferingId },
        }),
      ).toBe(0);
    });

    it('rejects a student without a recorded placement without writing', async () => {
      const res = await request(app.getHttpServer())
        .post(scopedUrl())
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ student_id: missingPlacementUserId.toString() });

      expect(res.status).toBe(400);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: scopedOfferingId },
        }),
      ).toBe(0);
    });

    it('previews only matching students and confirms the enrollment', async () => {
      const preview = await request(app.getHttpServer())
        .post(`${scopedUrl()}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(selection());

      expect(preview.status).toBe(200);
      expect(preview.body.confirmed_student_ids).toEqual([
        matchingUserId.toString(),
      ]);
      expect(preview.body.matched_count).toBe(1);

      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: scopedOfferingId },
        }),
      ).toBe(0);

      const confirmed = await request(app.getHttpServer())
        .post(`${scopedUrl()}/bulk`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...selection(),
          confirmed_student_ids: preview.body.confirmed_student_ids,
        });

      expect(confirmed.status).toBe(201);
      expect(confirmed.body.enrolled_count).toBe(1);

      const rows = await prisma.enrollments.findMany({
        where: { course_offering_id: scopedOfferingId },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].student_id).toBe(matchingUserId);
    });

    it('rejects stale bulk confirmation after placement changes', async () => {
      const preview = await request(app.getHttpServer())
        .post(`${scopedUrl()}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(selection());

      expect(preview.status).toBe(200);
      expect(preview.body.confirmed_student_ids).toEqual([
        matchingUserId.toString(),
      ]);

      await prisma.student_academic_records.update({
        where: { id: matchingRecordId },
        data: { class_group: 'B' },
      });

      const confirmed = await request(app.getHttpServer())
        .post(`${scopedUrl()}/bulk`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...selection(),
          confirmed_student_ids: preview.body.confirmed_student_ids,
        });

      expect(confirmed.status).toBe(409);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: scopedOfferingId },
        }),
      ).toBe(0);
    });

    it('saves one enrollment when two requests enroll the same student', async () => {
      const enroll = () =>
        request(app.getHttpServer())
          .post(scopedUrl())
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ student_id: matchingUserId.toString() });

      const responses = await Promise.all([enroll(), enroll()]);

      expect(responses.map((res) => res.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);

      const rows = await prisma.enrollments.findMany({
        where: { course_offering_id: scopedOfferingId },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].student_id).toBe(matchingUserId);
    });
  });
});
