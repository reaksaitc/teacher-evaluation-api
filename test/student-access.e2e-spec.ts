import {
  isolatedEvaluationOffering,
  releaseIsolatedOfferings,
} from './utils/isolated-evaluation-offering';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Student Access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;

  let tempSurveyId: string;
  let secondarySurveyId: string;
  let versionAId: string;
  let versionBId: string;
  let tempOfferingId: string;
  let ownOfferingId: string;
  let openEvalId: string;
  let closedEvalId: string;
  let otherEvalId: string;

  let courseId: bigint | undefined;
  let semesterId: bigint | undefined;
  let academicYearId: bigint | undefined;
  let generationId: bigint | undefined;
  let studentUserId: bigint;
  let lecturerName: string;

  const fixtureUserIds: bigint[] = [];

  const stamp = Date.now();
  const testCourseCode = `E2E-SA-${stamp}`;
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();

  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const admin = () => ({
    Authorization: `Bearer ${adminToken}`,
  });

  const student = () => ({
    Authorization: `Bearer ${studentToken}`,
  });

  const api = () => request(app.getHttpServer());

  const isolatedOfferings: bigint[] = [];
  async function createOpenEvaluation(offeringId: string, versionId: string) {
    offeringId = await isolatedEvaluationOffering(
      prisma,
      offeringId,
      isolatedOfferings,
    );
    const created = await api().post('/api/evaluations').set(admin()).send({
      course_offering_id: offeringId,
      survey_version_id: versionId,
      start_at: hourAgo,
      end_at: nextWeek,
    });

    expect(created.status).toBe(201);

    const opened = await api()
      .post(`/api/evaluations/${created.body.id}/open`)
      .set(admin());

    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('OPEN');
    expect(opened.body._count.evaluation_participants).toBe(1);

    return created.body.id as string;
  }

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
      const res = await api()
        .post('/api/auth/login')
        .send({ identifier, password: 'Password123' });

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.access_token.length).toBeGreaterThan(0);

      return res.body.access_token;
    };

    adminToken = await login('admin@itc.edu.kh');
    lecturerToken = await login('sokdara@itc.edu.kh');

    const adminUser = await prisma.users.findUniqueOrThrow({
      where: { email: 'admin@itc.edu.kh' },
    });
    const lecturer = await prisma.users.findUniqueOrThrow({
      where: { email: 'sokdara@itc.edu.kh' },
    });
    const seedStudent = await prisma.users.findUniqueOrThrow({
      where: { email: 'student1@itc.edu.kh' },
    });
    const department = await prisma.departments.findUniqueOrThrow({
      where: { code: 'AMS' },
    });

    lecturerName = lecturer.full_name;

    const fixtures = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const year = await tx.academic_years.create({
        data: {
          name: `SA-${stamp}`,
          start_year: 2026,
          is_active: false,
        },
      });

      const semester = await tx.semesters.create({
        data: {
          academic_year_id: year.id,
          semester_name: 'Student Access E2E',
          created_at: now,
          updated_at: now,
        },
      });

      const course = await tx.courses.create({
        data: {
          course_code: testCourseCode,
          course_name: 'Student Access E2E Course',
          department_id: department.id,
          created_at: now,
          updated_at: now,
        },
      });

      const generation = await tx.student_generations.create({
        data: {
          name: `E2E-SA-${stamp}`,
          entry_academic_year_id: year.id,
          starting_year_level: 1,
        },
      });

      const userIds: bigint[] = [];
      const offeringIds: string[] = [];

      for (let index = 0; index < 2; index++) {
        const user = await tx.users.create({
          data: {
            email: `access-${stamp}-${index}@example.test`,
            full_name: `Access E2E Student ${index}`,
            password_hash: seedStudent.password_hash,
            role: 'STUDENT',
            status: 'ACTIVE',
            created_at: now,
            updated_at: now,
          },
        });
        userIds.push(user.id);

        await tx.students.create({
          data: {
            user_id: user.id,
            student_code: `E2E-SA-${stamp}-${index}`,
            generation_id: generation.id,
            student_academic_records: {
              create: {
                academic_year_id: year.id,
                year_level: 1,
                major_id: (
                  await tx.majors.findFirstOrThrow({
                    where: { department_id: department.id },
                  })
                ).id,
                class_group: 'TEST-A',
              },
            },
          },
        });

        const offering = await tx.course_offerings.create({
          data: {
            course_id: course.id,
            lecturer_id: lecturer.id,
            semester_id: semester.id,
            class_type: index === 0 ? 'COURSE' : 'TD',
            section_code: `SA-${stamp}-${index}`,
            created_at: now,
            updated_at: now,
          },
        });
        offeringIds.push(offering.id.toString());

        await tx.enrollments.create({
          data: {
            course_offering_id: offering.id,
            student_id: user.id,
            enrolled_at: now,
          },
        });
      }

      const survey = await tx.surveys.create({
        data: {
          title: `E2E Student Access ${stamp}`,
          created_by: adminUser.id,
          created_at: now,
          updated_at: now,
        },
      });

      const versionA = await tx.survey_versions.create({
        data: {
          survey_id: survey.id,
          version_no: 1,
          status: 'DRAFT',
          created_by: adminUser.id,
          created_at: now,
        },
      });

      const secondSet = await tx.surveys.create({
        data: {
          title: `E2E Student Access other ${stamp}`,
          created_by: adminUser.id,
          created_at: now,
          updated_at: now,
        },
      });
      secondarySurveyId = secondSet.id.toString();
      const versionB = await tx.survey_versions.create({
        data: {
          survey_id: secondSet.id,
          version_no: 2,
          status: 'DRAFT',
          created_by: adminUser.id,
          created_at: now,
        },
      });

      await tx.questions.createMany({
        data: [
          {
            survey_version_id: versionA.id,
            question_text: 'The lecturer explains clearly.',
            question_text_km: 'គ្រូបង្រៀនពន្យល់បានច្បាស់លាស់។',
            question_type: 'RATING',
            is_required: true,
            min_rating: 1,
            max_rating: 5,
            display_order: 1,
            created_at: now,
            updated_at: now,
          },
          {
            survey_version_id: versionA.id,
            question_text: 'Any comments?',
            question_text_km: null,
            question_type: 'TEXT',
            is_required: false,
            display_order: 2,
            created_at: now,
            updated_at: now,
          },
          {
            survey_version_id: versionB.id,
            question_text: 'Overall rating',
            question_type: 'RATING',
            is_required: true,
            min_rating: 1,
            max_rating: 5,
            display_order: 1,
            created_at: now,
            updated_at: now,
          },
        ],
      });

      return {
        yearId: year.id,
        semesterId: semester.id,
        courseId: course.id,
        generationId: generation.id,
        userIds,
        offeringIds,
        surveyId: survey.id.toString(),
        versionAId: versionA.id.toString(),
        versionBId: versionB.id.toString(),
      };
    });

    academicYearId = fixtures.yearId;
    semesterId = fixtures.semesterId;
    courseId = fixtures.courseId;
    generationId = fixtures.generationId;
    fixtureUserIds.push(...fixtures.userIds);
    studentUserId = fixtures.userIds[0];
    ownOfferingId = fixtures.offeringIds[0];
    tempOfferingId = fixtures.offeringIds[1];
    tempSurveyId = fixtures.surveyId;
    versionAId = fixtures.versionAId;
    versionBId = fixtures.versionBId;

    studentToken = await login(`access-${stamp}-0@example.test`);

    openEvalId = await createOpenEvaluation(ownOfferingId, versionAId);
    closedEvalId = await createOpenEvaluation(ownOfferingId, versionBId);

    const closed = await api()
      .post(`/api/evaluations/${closedEvalId}/close`)
      .set(admin());

    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');

    otherEvalId = await createOpenEvaluation(tempOfferingId, versionBId);
  }, 60000);

  afterAll(async () => {
    try {
      if (prisma && courseId !== undefined) {
        await prisma.$transaction(async (tx) => {
          const versions = await tx.survey_versions.findMany({
            where: {
              survey_id: {
                in: [BigInt(tempSurveyId), BigInt(secondarySurveyId)],
              },
            },
            select: { id: true },
          });
          const versionIds = versions.map((version) => version.id);

          const evaluations = await tx.evaluations.findMany({
            where: { survey_version_id: { in: versionIds } },
            select: { id: true },
          });
          const evaluationIds = evaluations.map((evaluation) => evaluation.id);

          await tx.evaluation_participants.deleteMany({
            where: { evaluation_id: { in: evaluationIds } },
          });
          await tx.evaluation_generation_targets.deleteMany({
            where: { evaluation_id: { in: evaluationIds } },
          });
          await tx.evaluation_group_targets.deleteMany({
            where: { evaluation_id: { in: evaluationIds } },
          });
          await tx.evaluations.deleteMany({
            where: { id: { in: evaluationIds } },
          });
          await tx.question_options.deleteMany({
            where: {
              questions: { survey_version_id: { in: versionIds } },
            },
          });
          await tx.questions.deleteMany({
            where: { survey_version_id: { in: versionIds } },
          });
          await tx.survey_versions.deleteMany({
            where: { id: { in: versionIds } },
          });
          await tx.surveys.deleteMany({
            where: {
              id: { in: [BigInt(tempSurveyId), BigInt(secondarySurveyId)] },
            },
          });

          await releaseIsolatedOfferings(
            tx as PrismaService,
            isolatedOfferings,
          );
          const offerings = await tx.course_offerings.findMany({
            where: { course_id: courseId! },
            select: { id: true },
          });
          const offeringIds = offerings.map((offering) => offering.id);

          await tx.enrollments.deleteMany({
            where: { course_offering_id: { in: offeringIds } },
          });
          await tx.course_offerings.deleteMany({
            where: { id: { in: offeringIds } },
          });
          await tx.courses.delete({ where: { id: courseId! } });
          await tx.student_academic_records.deleteMany({
            where: { academic_year_id: academicYearId },
          });
          await tx.students.deleteMany({
            where: { user_id: { in: fixtureUserIds } },
          });
          await tx.users.deleteMany({
            where: { id: { in: fixtureUserIds } },
          });
          await tx.student_generations.delete({
            where: { id: generationId! },
          });
          await tx.semesters.delete({ where: { id: semesterId! } });
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

  describe('access control', () => {
    it('ADMIN is blocked from student routes -> 403', async () => {
      const res = await api().get('/api/student/evaluations').set(admin());

      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from student routes -> 403', async () => {
      const res = await api()
        .get('/api/student/evaluations')
        .set('Authorization', `Bearer ${lecturerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/student/evaluations', () => {
    it('shows an open evaluation I am part of, without internal ids -> 200', async () => {
      const res = await api().get('/api/student/evaluations').set(student());

      const mine = res.body.find((e: any) => e.id === openEvalId);

      expect(res.status).toBe(200);
      expect(mine).toBeDefined();

      expect(mine.course.code).toBe(testCourseCode);

      expect(mine.lecturer.full_name).toBe(lecturerName);

      expect(mine).not.toHaveProperty('course_offering_id');

      expect(mine).not.toHaveProperty('survey_version_id');
    });

    it('does not show a CLOSED evaluation', async () => {
      const res = await api().get('/api/student/evaluations').set(student());

      expect(res.body.some((e: any) => e.id === closedEvalId)).toBe(false);
    });

    it('does not show an evaluation for a class I am not in', async () => {
      const res = await api().get('/api/student/evaluations').set(student());

      expect(res.body.some((e: any) => e.id === otherEvalId)).toBe(false);
    });
  });

  describe('GET /api/student/evaluations/:id/survey', () => {
    it('returns the questions in order, with only student-facing fields -> 200', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(200);

      expect(res.body.evaluation.course.code).toBe(testCourseCode);

      expect(res.body.questions.map((q: any) => q.display_order)).toEqual([
        1, 2,
      ]);

      expect(res.body.questions[0]).not.toHaveProperty('created_at');
    });

    it('returns English and Khmer question text to the student -> 200', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(200);

      const question = res.body.questions[0];

      expect(question.question_text).toBe('The lecturer explains clearly.');

      expect(question.question_text_km).toBe('គ្រូបង្រៀនពន្យល់បានច្បាស់លាស់។');
    });

    it('returns null Khmer text when translation is not provided -> 200', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(200);

      const question = res.body.questions[1];

      expect(question.question_text).toBe('Any comments?');

      expect(question.question_text_km).toBeNull();
    });

    it('CLOSED evaluation -> 409', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${closedEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(409);
    });

    it('evaluation for a class I am not in -> 403', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${otherEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(403);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await api()
        .get('/api/student/evaluations/999999/survey')
        .set(student());

      expect(res.status).toBe(404);
    });

    it('non-numeric id -> 400', async () => {
      const res = await api()
        .get('/api/student/evaluations/abc/survey')
        .set(student());

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/student/evaluations/:id/submission-status', () => {
    it('not submitted yet -> 200', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/submission-status`)
        .set(student());

      expect(res.status).toBe(200);

      expect(res.body.has_submitted).toBe(false);
    });

    it('evaluation I am not part of -> 403', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${otherEvalId}/submission-status`)
        .set(student());

      expect(res.status).toBe(403);
    });
  });

  describe('after submitting', () => {
    beforeAll(async () => {
      // Simulate participant state only; submission persistence is tested separately.
      const updated = await prisma.evaluation_participants.updateMany({
        where: {
          evaluation_id: BigInt(openEvalId),
          student_id: studentUserId,
        },
        data: {
          has_submitted: true,
          submitted_at: new Date(),
        },
      });

      expect(updated.count).toBe(1);
    });

    it('status shows submitted -> 200', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/submission-status`)
        .set(student());

      expect(res.status).toBe(200);

      expect(res.body.has_submitted).toBe(true);

      expect(res.body.submitted_at).not.toBeNull();
    });

    it('survey can no longer be opened -> 409', async () => {
      const res = await api()
        .get(`/api/student/evaluations/${openEvalId}/survey`)
        .set(student());

      expect(res.status).toBe(409);
    });

    it('it disappears from my available list', async () => {
      const res = await api().get('/api/student/evaluations').set(student());

      expect(res.body.some((e: any) => e.id === openEvalId)).toBe(false);
    });
  });
});
