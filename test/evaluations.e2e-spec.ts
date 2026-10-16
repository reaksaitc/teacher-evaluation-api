import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Same fix as main.ts — BigInt IDs can't be JSON-serialised by default
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Evaluations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let studentToken: string;
  let lecturerToken: string;
  let adminId: string;

  // Temporary data created for these tests
  let tempSurveyId: string;
  let secondarySurveyId: string;
  let versionWithQuestionsId: string;
  let emptyVersionId: string;
  let emptyOfferingId: string;
  let enrolledOfferingId: string;
  let evalId: string; // the main evaluation, opened and closed during the tests
  const createdEvalIds: string[] = [];

  let courseId: bigint | undefined;
  let semesterId: bigint | undefined;
  let academicYearId: bigint | undefined;
  let generationId: bigint | undefined;
  let participantUserId: bigint | undefined;

  const stamp = Date.now();
  const testCourseCode = `E2E-EVAL-${stamp}`;
  const hourAgo = new Date(stamp - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(stamp + 7 * 24 * 60 * 60 * 1000).toISOString();

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  const createEval = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/evaluations')
      .set(auth())
      .send(body);

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

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(auth());
    adminId = me.body.id;
    expect(me.status).toBe(200);
    prisma = app.get(PrismaService);

    const lecturer = await prisma.users.findUniqueOrThrow({
      where: { email: 'sokdara@itc.edu.kh' },
    });
    const seedStudent = await prisma.users.findUniqueOrThrow({
      where: { email: 'student1@itc.edu.kh' },
    });
    const department = await prisma.departments.findUniqueOrThrow({
      where: { code: 'AMS' },
    });

    const fixtures = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const year = await tx.academic_years.create({
        data: {
          name: `EV-${stamp}`,
          start_year: 2026,
          is_active: false,
        },
      });

      const semester = await tx.semesters.create({
        data: {
          academic_year_id: year.id,
          semester_name: 'Evaluations E2E',
          created_at: now,
          updated_at: now,
        },
      });

      const course = await tx.courses.create({
        data: {
          course_code: testCourseCode,
          course_name: 'Evaluations E2E Course',
          department_id: department.id,
          created_at: now,
          updated_at: now,
        },
      });

      const generation = await tx.student_generations.create({
        data: {
          name: `E2E-EVAL-${stamp}`,
          entry_academic_year_id: year.id,
          starting_year_level: 1,
        },
      });

      const user = await tx.users.create({
        data: {
          email: `evaluation-${stamp}@example.test`,
          full_name: 'Evaluation E2E Student',
          password_hash: seedStudent.password_hash,
          role: 'STUDENT',
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        },
      });

      await tx.students.create({
        data: {
          user_id: user.id,
          student_code: `E2E-EVAL-${stamp}`,
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

      const offeringData = {
        course_id: course.id,
        lecturer_id: lecturer.id,
        semester_id: semester.id,
        class_type: 'COURSE' as const,
        created_at: now,
        updated_at: now,
      };

      const enrolled = await tx.course_offerings.create({
        data: {
          ...offeringData,
          section_code: `ENROLLED-${stamp}`,
        },
      });

      const empty = await tx.course_offerings.create({
        data: {
          ...offeringData,
          class_type: 'TD',
          section_code: `EMPTY-${stamp}`,
        },
      });

      await tx.enrollments.create({
        data: {
          course_offering_id: enrolled.id,
          student_id: user.id,
          enrolled_at: now,
        },
      });

      return {
        yearId: year.id,
        semesterId: semester.id,
        courseId: course.id,
        generationId: generation.id,
        userId: user.id,
        enrolledId: enrolled.id.toString(),
        emptyId: empty.id.toString(),
      };
    });

    academicYearId = fixtures.yearId;
    semesterId = fixtures.semesterId;
    courseId = fixtures.courseId;
    generationId = fixtures.generationId;
    participantUserId = fixtures.userId;
    enrolledOfferingId = fixtures.enrolledId;
    emptyOfferingId = fixtures.emptyId;

    // Survey with two versions: one with a question, one empty
    const survey = await request(app.getHttpServer())
      .post('/api/surveys')
      .set(auth())
      .send({ title: `E2E Evaluations ${stamp}` });
    expect(survey.status).toBe(201);
    tempSurveyId = survey.body.id;

    const createdV1 = await prisma.survey_versions.findFirstOrThrow({
      where: {
        survey_id: BigInt(tempSurveyId),
        version_no: 1,
      },
    });
    versionWithQuestionsId = createdV1.id.toString();

    const question = await request(app.getHttpServer())
      .post(`/api/survey-versions/${versionWithQuestionsId}/questions`)
      .set(auth())
      .send({
        question_text: 'The lecturer explains clearly.',
        question_type: 'RATING',
        min_rating: 1,
        max_rating: 5,
      });

    expect(question.status).toBe(201);

    const secondSet = await request(app.getHttpServer())
      .post('/api/surveys')
      .set(auth())
      .send({ title: `E2E evaluations other ${stamp}` });
    expect(secondSet.status).toBe(201);
    secondarySurveyId = secondSet.body.id;
    const v2 = await request(app.getHttpServer())
      .post(`/api/surveys/${secondarySurveyId}/versions`)
      .set(auth())
      .send({ copy_questions: false });
    expect(v2.status).toBe(201);
    emptyVersionId = v2.body.id;
  }, 30000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.$transaction(async (tx) => {
          if (tempSurveyId) {
            const surveyId = BigInt(tempSurveyId);

            const versions = await tx.survey_versions.findMany({
              where: {
                survey_id: { in: [surveyId, BigInt(secondarySurveyId)] },
              },
              select: { id: true },
            });
            const versionIds = versions.map((version) => version.id);

            const evaluations = await tx.evaluations.findMany({
              where: { survey_version_id: { in: versionIds } },
              select: { id: true },
            });
            const evaluationIds = evaluations.map(
              (evaluation) => evaluation.id,
            );

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
            await tx.questions.deleteMany({
              where: { survey_version_id: { in: versionIds } },
            });
            await tx.survey_versions.deleteMany({
              where: { id: { in: versionIds } },
            });
            await tx.surveys.deleteMany({
              where: { id: { in: [surveyId, BigInt(secondarySurveyId)] } },
            });
          }

          if (courseId !== undefined) {
            const offerings = await tx.course_offerings.findMany({
              where: { course_id: courseId },
              select: { id: true },
            });
            const offeringIds = offerings.map((offering) => offering.id);

            await tx.enrollments.deleteMany({
              where: { course_offering_id: { in: offeringIds } },
            });
            await tx.course_offerings.deleteMany({
              where: { id: { in: offeringIds } },
            });
            await tx.courses.delete({ where: { id: courseId } });
          }

          if (participantUserId !== undefined) {
            await tx.student_academic_records.deleteMany({
              where: { academic_year_id: academicYearId },
            });
            await tx.students.deleteMany({
              where: { user_id: participantUserId },
            });
            await tx.users.delete({
              where: { id: participantUserId },
            });
          }

          if (generationId !== undefined) {
            await tx.student_generations.delete({
              where: { id: generationId },
            });
          }
          if (semesterId !== undefined) {
            await tx.semesters.delete({
              where: { id: semesterId },
            });
          }
          if (academicYearId !== undefined) {
            await tx.academic_years.delete({
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

  describe('access control', () => {
    it('STUDENT is blocked from listing -> 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/evaluations')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(403);
    });

    it('LECTURER is blocked from creating -> 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/evaluations')
        .set('Authorization', `Bearer ${lecturerToken}`)
        .send({
          course_offering_id: enrolledOfferingId,
          survey_version_id: versionWithQuestionsId,
        });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/evaluations', () => {
    it('ADMIN creates a DRAFT evaluation -> 201', async () => {
      const res = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: versionWithQuestionsId,
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.created_by).toBe(adminId);
      evalId = res.body.id;
      createdEvalIds.push(evalId);
    });

    it('same offering + version again -> 409', async () => {
      const res = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: versionWithQuestionsId,
      });
      expect(res.status).toBe(409);
    });

    it('course offering that does not exist -> 400', async () => {
      const res = await createEval({
        course_offering_id: '999999',
        survey_version_id: versionWithQuestionsId,
      });
      expect(res.status).toBe(400);
    });

    it('survey version that does not exist -> 400', async () => {
      const res = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: '999999',
      });
      expect(res.status).toBe(400);
    });

    it('end_at before start_at -> 400', async () => {
      const res = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: versionWithQuestionsId,
        start_at: nextWeek,
        end_at: hourAgo,
      });
      expect(res.status).toBe(400);
    });

    it('invalid date string -> 400', async () => {
      const res = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: emptyVersionId,
        start_at: 'tomorrow',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/evaluations', () => {
    it('filter by status=DRAFT returns only drafts, including ours -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/evaluations?status=DRAFT')
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.every((e: any) => e.status === 'DRAFT')).toBe(true);
      expect(res.body.some((e: any) => e.id === evalId)).toBe(true);
    });

    it('get one shows course, lecturer, and counts -> 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/evaluations/${evalId}`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.course_offerings.courses.course_code).toBe(
        testCourseCode,
      );
      expect(res.body.course_offerings.users.password_hash).toBeUndefined();
      expect(res.body._count.evaluation_participants).toBe(0);
    });

    it('evaluation that does not exist -> 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/evaluations/999999')
        .set(auth());
      expect(res.status).toBe(404);
    });
  });

  describe('schedule and open', () => {
    it('cannot open without dates -> 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${evalId}/open`)
        .set(auth());
      expect(res.status).toBe(400);
    });

    it('schedule with end before start -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ start_at: nextWeek, end_at: hourAgo });
      expect(res.status).toBe(400);
    });

    it('set a valid schedule -> 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ start_at: hourAgo, end_at: nextWeek });

      expect(res.status).toBe(200);
      expect(res.body.end_at).toBe(nextWeek);
    });

    it('rejects an empty survey version at evaluation creation -> 400', async () => {
      const created = await createEval({
        course_offering_id: enrolledOfferingId,
        survey_version_id: emptyVersionId,
        start_at: hourAgo,
        end_at: nextWeek,
      });

      expect(created.status).toBe(400);
      expect(created.body.message).toContain('no questions');

      expect(
        await prisma.evaluations.count({
          where: { survey_version_id: BigInt(emptyVersionId) },
        }),
      ).toBe(0);
    });

    it('ADMIN can delete a DRAFT evaluation -> 204', async () => {
      const created = await createEval({
        course_offering_id: emptyOfferingId,
        survey_version_id: versionWithQuestionsId,
      });

      expect(created.status).toBe(201);

      const deleted = await request(app.getHttpServer())
        .delete(`/api/evaluations/${created.body.id}`)
        .set(auth());

      expect(deleted.status).toBe(204);
      expect(
        await prisma.evaluations.findUnique({
          where: { id: BigInt(created.body.id) },
        }),
      ).toBeNull();
    });

    it('cannot open when no students are enrolled -> 400', async () => {
      const created = await createEval({
        course_offering_id: emptyOfferingId,
        survey_version_id: versionWithQuestionsId,
        start_at: hourAgo,
        end_at: nextWeek,
      });
      expect(created.status).toBe(201);
      createdEvalIds.push(created.body.id);

      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${created.body.id}/open`)
        .set(auth());
      expect(res.status).toBe(400);
    });

    it('opening registers every enrolled student as a participant -> 200', async () => {
      const enrolled = await request(app.getHttpServer())
        .get(`/api/course-offerings/${enrolledOfferingId}/enrollments`)
        .set(auth());

      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${evalId}/open`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OPEN');
      expect(res.body._count.evaluation_participants).toBe(
        enrolled.body.length,
      );

      expect(enrolled.status).toBe(200);
      expect(enrolled.body).toHaveLength(1);

      const participants = await prisma.evaluation_participants.findMany({
        where: { evaluation_id: BigInt(evalId) },
      });

      expect(participants).toHaveLength(1);
      expect(participants[0].student_id).toBe(participantUserId);
      expect(participants[0].has_submitted).toBe(false);
    });

    it('opening locks the survey version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/surveys/${tempSurveyId}/versions/${versionWithQuestionsId}`)
        .set(auth());

      expect(res.body.status).toBe('LOCKED');
      expect(res.body.locked_at).not.toBeNull();
    });

    it('questions in the locked version can no longer be added -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/survey-versions/${versionWithQuestionsId}/questions`)
        .set(auth())
        .send({ question_text: 'Too late', question_type: 'TEXT' });
      expect(res.status).toBe(409);
    });
  });

  describe('while OPEN', () => {
    it('opening again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${evalId}/open`)
        .set(auth());
      expect(res.status).toBe(409);
    });

    it('active schedule start changes are rejected -> 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/evaluations/${evalId}/schedule`)
        .set(auth())
        .send({ end_at: nextWeek });
      expect(res.status).toBe(400);
    });

    it('cannot be deleted -> 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/evaluations/${evalId}`)
        .set(auth());
      expect(res.status).toBe(409);
    });
  });

  describe('close', () => {
    it('ADMIN closes an OPEN evaluation -> 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${evalId}/close`)
        .set(auth());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLOSED');
    });

    it('closing again -> 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/evaluations/${evalId}/close`)
        .set(auth());
      expect(res.status).toBe(409);
    });
  });
});
