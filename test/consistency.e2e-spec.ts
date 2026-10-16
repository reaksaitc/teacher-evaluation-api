import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ConflictException,
} from '@nestjs/common';
import { Prisma, question_type } from '@prisma/client';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StudentAccessService } from '../src/student-access/student-access.service';
import { AssessmentDraftsService } from '../src/assessment-drafts/assessment-drafts.service';
import { SubmissionsService } from '../src/submissions/submissions.service';
import { SurveyVersionsService } from '../src/survey-versions/survey-versions.service';
import { QuestionsService } from '../src/questions/questions.service';
import { EvaluationsService } from '../src/evaluations/evaluations.service';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { StudentsService } from '../src/students/students.service';
import { StudentEvaluationProgressService } from '../src/students/student-evaluation-progress.service';
import { UsersService } from '../src/users/users.service';
import { StudentAcademicRecordsService } from '../src/student-academic-records/student-academic-records.service';
import { CommentsService } from '../src/comments/comments.service';
import { LecturerDashboardService } from '../src/lecturer-dashboard/lecturer-dashboard.service';
import { ResultsService } from '../src/results/results.service';
import { ReviewedWorkflowsService } from '../src/reviewed-workflows/reviewed-workflows.service';
import { CourseOfferingsService } from '../src/course-offerings/course-offerings.service';
import { SemestersService } from '../src/semesters/semesters.service';

const historical = createRequire(`${process.cwd()}/package.json`)(
  './scripts/historical-metadata.cjs',
);

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/** Pause one real SQL operation. All delegates still execute against PostgreSQL. */
function gateTransaction(prisma: PrismaService, model: string, method: string) {
  let reached!: () => void;
  let release!: () => void;
  let paused = false;
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const db = new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction')
        return (operation: any, options: any) =>
          target.$transaction(
            async (tx) =>
              operation(
                new Proxy(tx, {
                  get(client, delegate) {
                    const value = Reflect.get(client, delegate);
                    if (delegate !== model)
                      return typeof value === 'function'
                        ? value.bind(client)
                        : value;
                    return new Proxy(value, {
                      get(table, action) {
                        const fn = Reflect.get(table, action);
                        if (action !== method)
                          return typeof fn === 'function' ? fn.bind(table) : fn;
                        return async (...args: any[]) => {
                          if (!paused) {
                            paused = true;
                            reached();
                            await resume;
                          }
                          return fn.apply(table, args);
                        };
                      },
                    });
                  },
                }),
              ),
            options,
          );
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    db,
    release,
    async wait(operation: Promise<any>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          operation.then(() => {
            throw new Error('Operation never reached SQL barrier');
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('SQL barrier timed out')),
              8_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

describe('School consistency acceptance (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: bigint,
    lecturer: bigint,
    year: bigint,
    semester: bigint,
    generation: bigint,
    major: bigint,
    department: bigint;
  let adminToken: string;
  const stamp = Date.now().toString();
  const userIds: bigint[] = [],
    offeringIds: bigint[] = [],
    courseIds: bigint[] = [],
    surveyIds: bigint[] = [];
  const extraGenerationIds: bigint[] = [],
    extraMajorIds: bigint[] = [],
    extraYearIds: bigint[] = [];
  const extraSemesterIds: bigint[] = [];
  const extraDepartmentIds: bigint[] = [];
  const students: {
    account: bigint;
    profile: bigint;
    placement: bigint;
    group: string;
  }[] = [];
  let passwordHash: string;

  const api = () => request(app.getHttpServer());
  const authorization = () => ({ Authorization: `Bearer ${adminToken}` });
  async function account(role: 'ADMIN' | 'LECTURER' | 'STUDENT', name: string) {
    const now = new Date();
    const user = await prisma.users.create({
      data: {
        email: `${name}-${stamp}@consistency.test`,
        full_name: name,
        password_hash: passwordHash,
        role,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      },
    });
    userIds.push(user.id);
    return user.id;
  }
  async function student(
    group: string,
    generationId = generation,
    majorId = major,
    yearLevel = 1,
  ) {
    const accountId = await account('STUDENT', `student-${userIds.length}`);
    const profile = await prisma.students.create({
      data: {
        user_id: accountId,
        student_code: `C-${stamp}-${accountId}`,
        generation_id: generationId,
      },
    });
    const placement = await prisma.student_academic_records.create({
      data: {
        student_id: profile.id,
        academic_year_id: year,
        year_level: yearLevel,
        major_id: majorId,
        class_group: group,
      },
    });
    return {
      account: accountId,
      profile: profile.id,
      placement: placement.id,
      group,
    };
  }
  async function offering(groups: string[] = [], semesterId = semester) {
    const now = new Date();
    const course = await prisma.courses.create({
      data: {
        course_code: `C${stamp}-${courseIds.length}`,
        course_name: 'Consistency test',
        department_id: department,
        created_at: now,
        updated_at: now,
      },
    });
    courseIds.push(course.id);
    const result = await prisma.course_offerings.create({
      data: {
        course_id: course.id,
        lecturer_id: lecturer,
        semester_id: semesterId,
        class_type: groups.length === 1 ? 'TD' : 'COURSE',
        year_level: 1,
        section_code: 'A label is not a scope',
        created_at: now,
        updated_at: now,
        group_scopes: {
          create: groups.map((class_group) => ({
            academic_year_id: year,
            generation_id: generation,
            major_id: major,
            year_level: 1,
            class_group,
          })),
        },
      },
    });
    offeringIds.push(result.id);
    return result;
  }
  async function survey() {
    const now = new Date();
    const set = await prisma.surveys.create({
      data: {
        title: `Consistency ${stamp}-${surveyIds.length}`,
        created_by: admin,
        created_at: now,
        updated_at: now,
      },
    });
    surveyIds.push(set.id);
    const v1 = await version(set.id, 1);
    return { set, v1 };
  }
  async function version(
    surveyId: bigint,
    number: number,
    withQuestions = true,
  ) {
    const now = new Date();
    return prisma.survey_versions.create({
      data: {
        survey_id: surveyId,
        version_no: number,
        created_by: admin,
        created_at: now,
        status: 'DRAFT',
        questions: {
          create: withQuestions
            ? [
                {
                  question_type: question_type.RATING,
                  question_text: `Rating V${number}`,
                  min_rating: 1,
                  max_rating: 5,
                  display_order: 1,
                  created_at: now,
                  updated_at: now,
                },
                {
                  question_type: question_type.TEXT,
                  question_text: `Comment V${number}`,
                  is_required: false,
                  display_order: 2,
                  created_at: now,
                  updated_at: now,
                },
              ]
            : [],
        },
      },
      include: { questions: true },
    });
  }
  async function evaluation(semesterId = semester) {
    const assignment = await offering(['A', 'B'], semesterId);
    const { set, v1 } = await survey();
    const now = new Date();
    await prisma.enrollments.createMany({
      data: students.map((s) => ({
        student_id: s.account,
        course_offering_id: assignment.id,
        enrolled_at: now,
      })),
    });
    const result = await prisma.evaluations.create({
      data: {
        course_offering_id: assignment.id,
        survey_version_id: v1.id,
        created_by: admin,
        status: 'OPEN',
        start_at: new Date(Date.now() - 60_000),
        end_at: new Date(Date.now() + 86_400_000),
        created_at: now,
        updated_at: now,
        evaluation_participants: {
          create: students.map((s) => ({
            student_id: s.account,
            survey_version_id: v1.id,
            has_submitted: false,
            created_at: now,
          })),
        },
      },
      include: { evaluation_participants: true },
    });
    return { ...result, set, v1, assignment };
  }
  const answers = (v: {
    questions: { id: bigint; question_type: string }[];
  }) => ({
    answers: [
      {
        question_id: v.questions
          .find((q) => q.question_type === 'RATING')!
          .id.toString(),
        rating_value: 5,
      },
    ],
  });
  const selection = (groups: string[]) => ({
    academic_year_id: year.toString(),
    generation_id: generation.toString(),
    major_id: major.toString(),
    year_level: 1,
    class_groups: groups,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    passwordHash = await bcrypt.hash('Consistency123', 10);
    admin = await account('ADMIN', 'admin');
    lecturer = await account('LECTURER', 'lecturer');
    const login = await api()
      .post('/api/auth/login')
      .send({
        identifier: `admin-${stamp}@consistency.test`,
        password: 'Consistency123',
      });
    expect(login.status).toBe(200);
    adminToken = login.body.access_token;
    department = (
      await prisma.departments.create({
        data: { code: `C-${stamp}`, name: `Consistency ${stamp}` },
      })
    ).id;
    year = (
      await prisma.academic_years.create({
        data: { name: `C-${stamp}`, start_year: 2026 },
      })
    ).id;
    const now = new Date();
    semester = (
      await prisma.semesters.create({
        data: {
          academic_year_id: year,
          semester_name: 'Consistency',
          semester_number: 1,
          created_at: now,
          updated_at: now,
        },
      })
    ).id;
    generation = (
      await prisma.student_generations.create({
        data: { name: `C-${stamp}`, entry_academic_year_id: year },
      })
    ).id;
    major = (
      await prisma.majors.create({
        data: {
          code: `C-${stamp}`,
          name: 'Consistency',
          department_id: department,
        },
      })
    ).id;
    students.push(await student('A'), await student('B'));
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma)
        await prisma.$transaction(
          async (tx) => {
            await tx.reviewed_operations.deleteMany({
              where: { actor_id: { in: userIds } },
            });
            const evaluations = { course_offering_id: { in: offeringIds } };
            const responseFilter = { evaluations };
            const questionFilter = {
              survey_versions: { survey_id: { in: surveyIds } },
            };
            await tx.answer_options.deleteMany({
              where: { answers: { responses: responseFilter } },
            });
            await tx.answers.deleteMany({
              where: { responses: responseFilter },
            });
            await tx.responses.deleteMany({ where: responseFilter });
            await tx.assessment_drafts.deleteMany({
              where: { evaluation_participants: { evaluations } },
            });
            await tx.evaluation_participants.deleteMany({
              where: { evaluations },
            });
            await tx.evaluation_group_targets.deleteMany({
              where: { evaluations },
            });
            await tx.evaluation_generation_targets.deleteMany({
              where: { evaluations },
            });
            await tx.evaluations.deleteMany({ where: evaluations });
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
              where: { rule: { course_id: { in: courseIds } } },
            });
            await tx.course_year_rules.deleteMany({
              where: { course_id: { in: courseIds } },
            });
            await tx.courses.deleteMany({ where: { id: { in: courseIds } } });
            await tx.question_options.deleteMany({
              where: { questions: questionFilter },
            });
            await tx.questions.deleteMany({ where: questionFilter });
            await tx.survey_versions.deleteMany({
              where: { survey_id: { in: surveyIds } },
            });
            await tx.surveys.deleteMany({ where: { id: { in: surveyIds } } });
            await tx.student_academic_records.deleteMany({
              where: { students: { user_id: { in: userIds } } },
            });
            await tx.students.deleteMany({
              where: { user_id: { in: userIds } },
            });
            await tx.user_departments.deleteMany({
              where: { user_id: { in: userIds } },
            });
            await tx.users.deleteMany({ where: { id: { in: userIds } } });
            await tx.student_generations.deleteMany({
              where: {
                id: { in: [generation, ...extraGenerationIds].filter(Boolean) },
              },
            });
            await tx.majors.deleteMany({
              where: { id: { in: [major, ...extraMajorIds].filter(Boolean) } },
            });
            await tx.semesters.deleteMany({
              where: { id: { in: extraSemesterIds } },
            });
            if (semester)
              await tx.semesters.delete({ where: { id: semester } });
            if (year) await tx.academic_years.delete({ where: { id: year } });
            await tx.academic_years.deleteMany({
              where: { id: { in: extraYearIds } },
            });
            await tx.departments.deleteMany({
              where: { id: { in: extraDepartmentIds } },
            });
            if (department)
              await tx.departments.delete({ where: { id: department } });
          },
          { timeout: 20_000 },
        );
    } finally {
      if (app) await app.close();
    }
  });

  it('rejects direct single/bulk scope bypass and accepts saved shared A+B scope', async () => {
    const aOnly = await offering(['A']);
    const shared = await offering(['A', 'B']);
    const url = (id: bigint) => `/api/course-offerings/${id}/enrollments`;
    expect(
      (
        await api()
          .post(url(aOnly.id))
          .set(authorization())
          .send({ student_id: students[1].account.toString() })
      ).status,
    ).toBe(400);
    const bulk = await api()
      .post(`${url(aOnly.id)}/bulk`)
      .set(authorization())
      .send({
        ...selection(['A', 'B']),
        confirmed_student_ids: students.map((s) => s.account.toString()),
      });
    expect(bulk.status).toBe(409);
    expect(
      await prisma.enrollments.count({
        where: { course_offering_id: aOnly.id },
      }),
    ).toBe(0);
    for (const s of students)
      expect(
        (
          await api()
            .post(url(shared.id))
            .set(authorization())
            .send({ student_id: s.account.toString() })
        ).status,
      ).toBe(201);
  });

  it('rejects same-named groups in another generation, major or year and inactive accounts', async () => {
    const aOnly = await offering(['A']);
    const otherGeneration = (
      await prisma.student_generations.create({
        data: { name: `Other-${stamp}`, entry_academic_year_id: year },
      })
    ).id;
    extraGenerationIds.push(otherGeneration);
    const otherMajor = (
      await prisma.majors.create({
        data: {
          code: `Other-${stamp}`,
          name: 'Other',
          department_id: department,
        },
      })
    ).id;
    extraMajorIds.push(otherMajor);
    for (const s of [
      await student('A', otherGeneration),
      await student('A', generation, otherMajor),
      await student('A', generation, major, 2),
    ]) {
      await expect(
        app
          .get(EnrollmentsService)
          .create(aOnly.id, { student_id: s.account.toString() }),
      ).rejects.toThrow();
    }
    await prisma.users.update({
      where: { id: students[0].account },
      data: { status: 'INACTIVE' },
    });
    try {
      await expect(
        app
          .get(EnrollmentsService)
          .create(aOnly.id, { student_id: students[0].account.toString() }),
      ).rejects.toThrow();
    } finally {
      await prisma.users.update({
        where: { id: students[0].account },
        data: { status: 'ACTIVE' },
      });
    }
    expect(
      await prisma.enrollments.count({
        where: { course_offering_id: aOnly.id },
      }),
    ).toBe(0);
  });

  it('requires a yearly group even for legacy unscoped offerings without inferring section restrictions', async () => {
    const legacy = await offering();
    const user = await account('STUDENT', 'legacy-no-placement');
    await expect(
      app
        .get(EnrollmentsService)
        .create(legacy.id, { student_id: user.toString() }),
    ).rejects.toThrow('recorded placement');
    const assigned = await student('LEGACY');
    await app
      .get(EnrollmentsService)
      .create(legacy.id, { student_id: assigned.account.toString() });
    expect(
      await prisma.enrollments.count({
        where: { course_offering_id: legacy.id },
      }),
    ).toBe(1);
  });

  it('rejects stale explicit versions and never falls back when the newest is empty', async () => {
    const assignment = await offering();
    const { set, v1 } = await survey();
    await version(set.id, 2, false);
    await expect(
      app.get(EvaluationsService).create(
        {
          course_offering_id: assignment.id.toString(),
          survey_version_id: v1.id.toString(),
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      app.get(EvaluationsService).create(
        {
          course_offering_id: assignment.id.toString(),
          survey_id: set.id.toString(),
        },
        admin,
      ),
    ).rejects.toThrow('no questions');
    expect(
      await prisma.evaluations.count({
        where: { course_offering_id: assignment.id },
      }),
    ).toBe(0);
  });

  it('protects questions assigned to a DRAFT evaluation and older unused drafts', async () => {
    const assignment = await offering();
    const { set, v1 } = await survey();
    await app.get(EvaluationsService).create(
      {
        course_offering_id: assignment.id.toString(),
        survey_version_id: v1.id.toString(),
      },
      admin,
    );
    await expect(
      app.get(QuestionsService).update(v1.questions[0].id, {
        question_text: 'Changed after assignment',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const unused = await survey();
    await version(unused.set.id, 2);
    await expect(
      app
        .get(QuestionsService)
        .update(unused.v1.questions[0].id, { question_text: 'Stale edit' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.survey_versions.count({ where: { survey_id: set.id } }),
    ).toBe(1);
  });

  it('rejects a stale opening and preserves its assigned version and frozen participants', async () => {
    const e = await evaluation();
    await prisma.evaluations.update({
      where: { id: e.id },
      data: { status: 'DRAFT' },
    });
    await version(e.set.id, 2);
    await expect(app.get(EvaluationsService).open(e.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const saved = await prisma.evaluations.findUniqueOrThrow({
      where: { id: e.id },
      include: { evaluation_participants: true },
    });
    expect(saved.status).toBe('DRAFT');
    expect(saved.survey_version_id).toBe(e.v1.id);
    expect(saved.evaluation_participants.map((p) => p.id)).toEqual(
      e.evaluation_participants.map((p) => p.id),
    );
  });

  it('allows continuing an existing archived-set assignment but rejects new assignments', async () => {
    const e = await evaluation();
    await prisma.evaluations.update({
      where: { id: e.id },
      data: { status: 'DRAFT' },
    });
    await prisma.surveys.update({
      where: { id: e.set.id },
      data: { archived_at: new Date() },
    });
    await app.get(EvaluationsService).open(e.id);
    await app
      .get(SubmissionsService)
      .submit(e.id, students[0].account, answers(e.v1));
    const other = await offering();
    await expect(
      app.get(EvaluationsService).create(
        {
          course_offering_id: other.id.toString(),
          survey_version_id: e.v1.id.toString(),
        },
        admin,
      ),
    ).rejects.toThrow('archived question set');
  });

  it('rolls back a question edit raced against assignment; original IDs and wording survive', async () => {
    const assignment = await offering();
    const { v1 } = await survey();
    const gate = gateTransaction(prisma, 'questions', 'update');
    const editing = new QuestionsService(
      gate.db,
      app.get(SurveyVersionsService),
    ).update(v1.questions[0].id, { question_text: 'Concurrent edit' });
    const outcome = editing.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(editing);
      await app.get(EvaluationsService).create(
        {
          course_offering_id: assignment.id.toString(),
          survey_version_id: v1.id.toString(),
        },
        admin,
      );
    } finally {
      gate.release();
    }
    expect(await outcome).toBeInstanceOf(ConflictException);
    expect(
      (
        await prisma.questions.findUniqueOrThrow({
          where: { id: v1.questions[0].id },
        })
      ).question_text,
    ).toBe('Rating V1');
  });

  it('a delayed draft save cannot recreate a draft after anonymous submission', async () => {
    const e = await evaluation();
    const gate = gateTransaction(prisma, 'assessment_drafts', 'upsert');
    const saving = new AssessmentDraftsService(
      gate.db,
      app.get(StudentAccessService),
    ).save(e.id, students[0].account, answers(e.v1));
    const outcome = saving.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(saving);
      await app
        .get(SubmissionsService)
        .submit(e.id, students[0].account, answers(e.v1));
    } finally {
      gate.release();
    }
    expect(await outcome).toBeInstanceOf(ConflictException);
    expect(
      await prisma.assessment_drafts.count({
        where: { participant_id: e.evaluation_participants[0].id },
      }),
    ).toBe(0);
    expect(
      await prisma.responses.count({ where: { evaluation_id: e.id } }),
    ).toBe(1);
  });

  it('racing question application protects a newly saved V1 draft atomically', async () => {
    const e = await evaluation();
    const v2 = await version(e.set.id, 2);
    const gate = gateTransaction(
      prisma,
      'evaluation_participants',
      'updateMany',
    );
    const applying = new SurveyVersionsService(gate.db).applyToUnfinished(
      e.set.id,
      v2.id,
    );
    const outcome = applying.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(applying);
      await app
        .get(AssessmentDraftsService)
        .save(e.id, students[0].account, answers(e.v1));
    } finally {
      gate.release();
    }
    expect(await outcome).toBeInstanceOf(ConflictException);
    const participant = await prisma.evaluation_participants.findUniqueOrThrow({
      where: { id: e.evaluation_participants[0].id },
      include: { assessment_drafts: true },
    });
    expect(participant.survey_version_id).toBe(e.v1.id);
    expect(participant.assessment_drafts!.survey_version_id).toBe(e.v1.id);
    expect(
      (
        await prisma.evaluation_participants.findUniqueOrThrow({
          where: { id: e.evaluation_participants[1].id },
        })
      ).survey_version_id,
    ).toBe(e.v1.id);
    const retry = await app
      .get(SurveyVersionsService)
      .applyToUnfinished(e.set.id, v2.id);
    expect(retry.updated_participants).toBe(1);
    const repeated = await app
      .get(SurveyVersionsService)
      .applyToUnfinished(e.set.id, v2.id);
    expect(repeated.updated_participants).toBe(0);
  });

  it('concurrent final submissions create exactly one anonymous response', async () => {
    const e = await evaluation();
    const service = app.get(SubmissionsService);
    const result = await Promise.allSettled([
      service.submit(e.id, students[0].account, answers(e.v1)),
      service.submit(e.id, students[0].account, answers(e.v1)),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(
      await prisma.responses.count({ where: { evaluation_id: e.id } }),
    ).toBe(1);
    expect(
      await prisma.answers.count({
        where: { responses: { evaluation_id: e.id } },
      }),
    ).toBe(1);
  });

  it('moves safe NULL-version participants but preserves NULL-version historical drafts', async () => {
    const e = await evaluation();
    const v2 = await version(e.set.id, 2);
    await prisma.evaluation_participants.updateMany({
      where: { evaluation_id: e.id },
      data: { survey_version_id: null },
    });
    await prisma.assessment_drafts.create({
      data: {
        participant_id: e.evaluation_participants[0].id,
        survey_version_id: null,
        answers_json: answers(e.v1).answers,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    const result = await app
      .get(SurveyVersionsService)
      .applyToUnfinished(e.set.id, v2.id);
    expect(result.updated_participants).toBe(1);
    expect(
      (
        await prisma.evaluation_participants.findUniqueOrThrow({
          where: { id: e.evaluation_participants[0].id },
        })
      ).survey_version_id,
    ).toBeNull();
    expect(
      (
        await prisma.evaluation_participants.findUniqueOrThrow({
          where: { id: e.evaluation_participants[1].id },
        })
      ).survey_version_id,
    ).toBe(v2.id);
  });

  it('returns comments and rating questions from the response actual V2 version', async () => {
    const e = await evaluation();
    const v2 = await version(e.set.id, 2);
    await app.get(SurveyVersionsService).applyToUnfinished(e.set.id, v2.id);
    const dto = answers(v2);
    await app.get(SubmissionsService).submit(e.id, students[0].account, {
      answers: [
        ...dto.answers,
        {
          question_id: v2.questions
            .find((q) => q.question_type === 'TEXT')!
            .id.toString(),
          text_value: 'V2 comment',
        },
      ],
    });
    await app.get(EvaluationsService).close(e.id);
    const comments = await app.get(CommentsService).getComments(e.id, lecturer);
    expect(comments.comment_count).toBe(1);
    expect(comments.questions.flatMap((q) => q.comments)).toContain(
      'V2 comment',
    );
    const dashboard = await app
      .get(LecturerDashboardService)
      .getDashboard(e.id, lecturer);
    expect(JSON.stringify(dashboard)).toContain(v2.questions[0].id.toString());
  });

  it('serializes placement drift without rewriting confirmed membership and rejects a stale retry', async () => {
    const assignment = await offering(['A']);
    const gate = gateTransaction(prisma, 'enrollments', 'createMany');
    const dto = {
      ...selection(['A']),
      confirmed_student_ids: [students[0].account.toString()],
    };
    const confirming = new EnrollmentsService(
      gate.db,
      app.get(StudentsService),
    ).bulkCreate(assignment.id, dto);
    const outcome = confirming.then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    try {
      await gate.wait(confirming);
      await app
        .get(StudentAcademicRecordsService)
        .update(students[0].placement, { class_group: 'B' });
    } finally {
      gate.release();
    }
    const result = await outcome;
    expect(
      result.error === null || result.error instanceof ConflictException,
    ).toBe(true);
    expect(
      await prisma.enrollments.count({
        where: { course_offering_id: assignment.id },
      }),
    ).toBe(result.error ? 0 : 1);
    await expect(
      app.get(EnrollmentsService).bulkCreate(assignment.id, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    await app
      .get(StudentAcademicRecordsService)
      .update(students[0].placement, { class_group: 'A' });
  });

  it('historical recovery requires evidence, dry-runs, applies idempotently and rolls back exact metadata', async () => {
    const e = await evaluation();
    await app
      .get(SubmissionsService)
      .submit(e.id, students[0].account, answers(e.v1));
    const response = await prisma.responses.findFirstOrThrow({
      where: { evaluation_id: e.id },
    });
    await prisma.responses.update({
      where: { id: response.id },
      data: { survey_version_id: null },
    });
    const record = await historical.inspectRecord(
      prisma,
      'response',
      response.id.toString(),
    );
    expect(record.status).toBe('CANDIDATE_REQUIRES_VERIFIED_PROVENANCE');
    await app
      .get(AssessmentDraftsService)
      .save(e.id, students[1].account, answers(e.v1));
    const draft = await prisma.assessment_drafts.findUniqueOrThrow({
      where: { participant_id: e.evaluation_participants[1].id },
    });
    await prisma.assessment_drafts.update({
      where: { id: draft.id },
      data: { survey_version_id: null },
    });
    const draftRecord = await historical.inspectRecord(
      prisma,
      'draft',
      draft.id.toString(),
    );
    expect(draftRecord.candidate_version_id).toBe(e.v1.id.toString());
    const manifest = {
      schema_version: 1,
      records: [
        {
          ...record,
          verified_version_id: e.v1.id.toString(),
          verified_by: 'Synthetic fixture verifier',
          evidence_reference:
            'This test created and submitted V1 before clearing metadata',
        },
        {
          ...draftRecord,
          verified_version_id: e.v1.id.toString(),
          verified_by: 'Synthetic fixture verifier',
          evidence_reference:
            'This test saved the V1 draft before clearing metadata',
        },
      ],
    };
    expect(() =>
      historical.validateManifest({
        ...manifest,
        records: [{ ...manifest.records[0], evidence_reference: '' }],
      }),
    ).toThrow('evidence');
    const operation = (options: any): Promise<any[]> =>
      prisma.$transaction((tx) => historical.reconcile(tx, manifest, options), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    expect((await operation({ dryRun: true }))[0].outcome).toBe('WOULD_CHANGE');
    expect(
      (await prisma.responses.findUniqueOrThrow({ where: { id: response.id } }))
        .survey_version_id,
    ).toBeNull();
    expect((await operation({ dryRun: false }))[0].outcome).toBe('CHANGED');
    expect((await operation({ dryRun: false }))[0].outcome).toBe(
      'ALREADY_APPLIED',
    );
    expect(
      (await operation({ dryRun: false, rollback: true }))[0].outcome,
    ).toBe('CHANGED');
    expect(
      (await operation({ dryRun: false, rollback: true }))[0].outcome,
    ).toBe('ALREADY_APPLIED');
    expect(
      await prisma.answers.count({ where: { response_id: response.id } }),
    ).toBe(1);
    const restoredDraft = await prisma.assessment_drafts.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(restoredDraft.survey_version_id).toBeNull();
    expect(restoredDraft.answers_json).toEqual(draft.answers_json);
    expect(restoredDraft.updated_at).toEqual(draft.updated_at);
  });

  it('a status change invalidates reviewed eligibility and cannot partially enroll a group', async () => {
    const assignment = await offering(['A', 'B']);
    const service = app.get(EnrollmentsService);
    const preview = await service.previewGroup(
      assignment.id,
      selection(['A', 'B']),
    );
    await app
      .get(UsersService)
      .update(students[0].account, { status: 'INACTIVE' }, admin);
    try {
      await expect(
        service.bulkCreate(assignment.id, {
          ...selection(['A', 'B']),
          confirmed_student_ids: preview.confirmed_student_ids,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: assignment.id },
        }),
      ).toBe(0);
    } finally {
      await app
        .get(UsersService)
        .update(students[0].account, { status: 'ACTIVE' }, admin);
    }
  });

  it('racing enrollment removal cannot leave a partially frozen evaluation', async () => {
    const assignment = await offering(['A', 'B']);
    const { v1 } = await survey();
    for (const s of students)
      await app
        .get(EnrollmentsService)
        .create(assignment.id, { student_id: s.account.toString() });
    const gate = gateTransaction(
      prisma,
      'evaluation_participants',
      'createMany',
    );
    const dto = {
      course_offering_id: assignment.id.toString(),
      survey_version_id: v1.id.toString(),
      confirmed_student_ids: students.map((s) => s.account.toString()),
    };
    const creating = new EvaluationsService(gate.db).create(dto, admin);
    const outcome = creating.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(creating);
      await app
        .get(EnrollmentsService)
        .remove(assignment.id, students[0].account);
    } finally {
      gate.release();
    }
    const error = await outcome;
    expect(error === null || error instanceof ConflictException).toBe(true);
    expect(
      await prisma.evaluations.count({
        where: { course_offering_id: assignment.id },
      }),
    ).toBe(error ? 0 : 1);
    const frozen = await prisma.evaluation_participants.findMany({
      where: { evaluations: { course_offering_id: assignment.id } },
    });
    // A successful freeze serializes before the deliberate removal. Later removal
    // leaves the reviewed historical snapshot intact, never a partial selection.
    expect(frozen.map((p) => p.student_id.toString()).sort()).toEqual(
      error ? [] : dto.confirmed_student_ids.slice().sort(),
    );
    await expect(
      app.get(EvaluationsService).create(dto, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes a simultaneous status change and enrollment confirmation without widening reviewed IDs', async () => {
    const assignment = await offering(['A']);
    const gate = gateTransaction(prisma, 'enrollments', 'createMany');
    const dto = {
      ...selection(['A']),
      confirmed_student_ids: [students[0].account.toString()],
    };
    const confirming = new EnrollmentsService(
      gate.db,
      app.get(StudentsService),
    ).bulkCreate(assignment.id, dto);
    const outcome = confirming.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(confirming);
      await app
        .get(UsersService)
        .update(students[0].account, { status: 'INACTIVE' }, admin);
    } finally {
      gate.release();
    }
    try {
      const error = await outcome;
      expect(error === null || error instanceof ConflictException).toBe(true);
      const rows = await prisma.enrollments.findMany({
        where: { course_offering_id: assignment.id },
      });
      expect(rows.map((row) => row.student_id.toString())).toEqual(
        error ? [] : dto.confirmed_student_ids,
      );
      await expect(
        app.get(EnrollmentsService).bulkCreate(assignment.id, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    } finally {
      await app
        .get(UsersService)
        .update(students[0].account, { status: 'ACTIVE' }, admin);
    }
  });

  it('racing individual and bulk placement writes return conflict without lost updates or partial group changes', async () => {
    const gate = gateTransaction(
      prisma,
      'student_academic_records',
      'updateMany',
    );
    const changing = new StudentsService(
      gate.db,
      app.get(StudentEvaluationProgressService),
    ).bulkUpdateClassGroup(
      year,
      students.map((s) => s.profile),
      'D',
    );
    const outcome = changing.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(changing);
      await app
        .get(StudentAcademicRecordsService)
        .update(students[0].placement, { class_group: 'C' });
    } finally {
      gate.release();
    }
    expect(await outcome).toBeInstanceOf(ConflictException);
    expect(
      (
        await prisma.student_academic_records.findUniqueOrThrow({
          where: { id: students[0].placement },
        })
      ).class_group,
    ).toBe('C');
    expect(
      (
        await prisma.student_academic_records.findUniqueOrThrow({
          where: { id: students[1].placement },
        })
      ).class_group,
    ).toBe('B');
    await app
      .get(StudentAcademicRecordsService)
      .update(students[0].placement, { class_group: 'A' });
  });

  it('a reassignment raced against draft saving rolls back the enrollment move and protects the draft', async () => {
    const e = await evaluation();
    const target = await offering(['A', 'B']);
    await prisma.course_offerings.update({
      where: { id: target.id },
      data: {
        class_type: 'TP',
        course_id: e.assignment.course_id,
        section_code: 'Reassignment target',
      },
    });
    const service = app.get(EnrollmentsService);
    const input = {
      student_id: students[0].account.toString(),
      target_offering_id: target.id.toString(),
    };
    const preview = await service.previewReassignment(e.assignment.id, input);
    const gate = gateTransaction(prisma, 'enrollments', 'delete');
    const moving = new EnrollmentsService(
      gate.db,
      app.get(StudentsService),
    ).confirmReassignment(e.assignment.id, {
      ...input,
      confirmed_enrollment_id: preview.confirmed_enrollment_id,
    });
    const outcome = moving.then(
      () => null,
      (error) => error,
    );
    try {
      await gate.wait(moving);
      await app
        .get(AssessmentDraftsService)
        .save(e.id, students[0].account, answers(e.v1));
    } finally {
      gate.release();
    }
    expect(await outcome).toBeInstanceOf(ConflictException);
    expect(
      await prisma.enrollments.count({
        where: { course_offering_id: target.id },
      }),
    ).toBe(0);
    expect(
      await prisma.enrollments.count({
        where: {
          course_offering_id: e.assignment.id,
          student_id: students[0].account,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.assessment_drafts.count({
        where: { participant_id: e.evaluation_participants[0].id },
      }),
    ).toBe(1);
    await expect(
      service.confirmReassignment(e.assignment.id, {
        ...input,
        confirmed_enrollment_id: preview.confirmed_enrollment_id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never downgrades unfinished participants or applies a superseded target', async () => {
    const e = await evaluation();
    const v2 = await version(e.set.id, 2);
    await app.get(SurveyVersionsService).applyToUnfinished(e.set.id, v2.id);
    await expect(
      app.get(SurveyVersionsService).applyToUnfinished(e.set.id, e.v1.id),
    ).rejects.toBeInstanceOf(ConflictException);
    await version(e.set.id, 3, false);
    await expect(
      app.get(SurveyVersionsService).applyToUnfinished(e.set.id, v2.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.evaluation_participants.count({
        where: { evaluation_id: e.id, survey_version_id: v2.id },
      }),
    ).toBe(2);
  });

  it('keeps V1/V2 response groups separate and reconciles unavailable legacy results truthfully', async () => {
    const e = await evaluation();
    await app
      .get(SubmissionsService)
      .submit(e.id, students[0].account, answers(e.v1));
    const v2 = await version(e.set.id, 2);
    const applied = await app
      .get(SurveyVersionsService)
      .applyToUnfinished(e.set.id, v2.id);
    expect(applied.updated_participants).toBe(1);
    await app
      .get(SubmissionsService)
      .submit(e.id, students[1].account, answers(v2));
    await app.get(EvaluationsService).close(e.id);
    const results = app.get(ResultsService);
    const grouped = (
      await results.getLecturerResults(lecturer)
    ).evaluations.find((item) => item.evaluation.id === e.id)!;
    expect(grouped.submission_count).toBe(2);
    expect(grouped.unversioned_submission_count).toBe(0);
    expect(
      grouped.version_results.map((group) => ({
        id: group.survey_version_id,
        count: group.submission_count,
      })),
    ).toEqual([
      { id: e.v1.id, count: 1 },
      { id: v2.id, count: 1 },
    ]);
    for (const group of grouped.version_results) {
      const ownIds = (
        group.survey_version_id === e.v1.id ? e.v1 : v2
      ).questions.map((question) => question.id);
      expect(
        group.questions.every((question: { question_id: bigint }) =>
          ownIds.includes(question.question_id),
        ),
      ).toBe(true);
    }
    const oldResponse = await prisma.responses.findFirstOrThrow({
      where: { evaluation_id: e.id, survey_version_id: e.v1.id },
    });
    await prisma.responses.update({
      where: { id: oldResponse.id },
      data: { survey_version_id: null },
    });
    const incomplete = (
      await results.getLecturerResults(lecturer)
    ).evaluations.find((item) => item.evaluation.id === e.id)!;
    expect(incomplete.submission_count).toBe(2);
    expect(incomplete.unversioned_submission_count).toBe(1);
    expect(incomplete.version_results).toHaveLength(1);
    expect(
      incomplete.version_results.reduce(
        (total, group) => total + group.submission_count,
        0,
      ) + incomplete.unversioned_submission_count,
    ).toBe(incomplete.submission_count);
    expect(JSON.stringify(incomplete)).not.toMatch(
      /student_id|participant_id|response_id|password_hash/,
    );
  });

  it('historical recovery rolls back the whole batch on stale evidence and preserves ambiguous records', async () => {
    const e = await evaluation();
    for (const s of students)
      await app.get(SubmissionsService).submit(e.id, s.account, answers(e.v1));
    const responses = await prisma.responses.findMany({
      where: { evaluation_id: e.id },
      orderBy: { id: 'asc' },
    });
    await prisma.responses.updateMany({
      where: { evaluation_id: e.id },
      data: { survey_version_id: null },
    });
    const records: any[] = [];
    for (const response of responses)
      records.push({
        ...(await historical.inspectRecord(
          prisma,
          'response',
          response.id.toString(),
        )),
        verified_version_id: e.v1.id.toString(),
        verified_by: 'Synthetic verifier',
        evidence_reference: 'Fixture submission',
      });
    records[1].fingerprint = '0'.repeat(64);
    await expect(
      prisma.$transaction(
        (tx) =>
          historical.reconcile(
            tx,
            { schema_version: 1, records },
            { dryRun: false },
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).rejects.toThrow('changed after review');
    expect(
      await prisma.responses.count({
        where: { evaluation_id: e.id, survey_version_id: null },
      }),
    ).toBe(2);
    const v2 = await version(e.set.id, 2);
    await prisma.answers.create({
      data: {
        response_id: responses[0].id,
        question_id: v2.questions[0].id,
        rating_value: 4,
        created_at: new Date(),
      },
    });
    const ambiguous = await historical.inspectRecord(
      prisma,
      'response',
      responses[0].id.toString(),
    );
    expect(ambiguous.candidate_version_id).toBeNull();
    expect(ambiguous.issues).toContain('NO_SINGLE_ORIGINAL_VERSION');
  });

  describe('One primary department per user', () => {
    let departments: bigint[];
    const migration = readFileSync(
      'prisma/migrations/20261014010000_enforce_one_primary_department/migration.sql',
      'utf8',
    );
    const rows = (userId: bigint) =>
      prisma.user_departments.findMany({
        where: { user_id: userId },
        orderBy: { department_id: 'asc' },
      });
    const owner = () => account('LECTURER', `primary-${userIds.length}`);
    const post = (userId: bigint, departmentId: bigint, isPrimary?: boolean) =>
      api()
        .post(`/api/users/${userId}/departments`)
        .set(authorization())
        .send({
          department_id: Number(departmentId),
          ...(isPrimary !== undefined ? { is_primary: isPrimary } : {}),
        });
    const member = (userId: bigint, departmentId: bigint, isPrimary = false) =>
      prisma.user_departments.create({
        data: {
          user_id: userId,
          department_id: departmentId,
          is_primary: isPrimary,
        },
      });
    const newDepartment = async () => {
      const result = await prisma.departments.create({
        data: {
          code: `PD${extraDepartmentIds.length}-${stamp}`,
          name: `Primary department ${extraDepartmentIds.length}-${stamp}`,
        },
      });
      extraDepartmentIds.push(result.id);
      return result.id;
    };
    beforeAll(async () => {
      departments = [
        await newDepartment(),
        await newDepartment(),
        await newDepartment(),
      ];
    });

    it('keeps multiple non-primary memberships and permits zero primary departments', async () => {
      const userId = await owner();
      for (const departmentId of departments)
        expect((await post(userId, departmentId, false)).status).toBe(201);
      const memberships = await rows(userId);
      expect(memberships).toHaveLength(3);
      expect(memberships.every((row) => !row.is_primary)).toBe(true);
      const listed = await api()
        .get(`/api/users/${userId}/departments`)
        .set(authorization());
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(3);
      expect(JSON.stringify(listed.body)).not.toContain('password_hash');
    });

    it('switches primary atomically, retains other memberships/timestamps and returns consistent profile flags', async () => {
      const userId = await owner();
      for (const departmentId of departments)
        await member(userId, departmentId);
      expect((await post(userId, departments[0], true)).status).toBe(201);
      const original = await rows(userId);
      const switched = await post(userId, departments[1], true);
      expect(switched.status).toBe(201);
      expect(switched.body.is_primary).toBe(true);
      const after = await rows(userId);
      expect(
        after.filter((row) => row.is_primary).map((row) => row.department_id),
      ).toEqual([departments[1]]);
      expect(
        after.map((row) => ({
          department_id: row.department_id,
          created_at: row.created_at,
        })),
      ).toEqual(
        original.map((row) => ({
          department_id: row.department_id,
          created_at: row.created_at,
        })),
      );
      const user = await prisma.users.findUniqueOrThrow({
        where: { id: userId },
      });
      const login = await api()
        .post('/api/auth/login')
        .send({ identifier: user.email, password: 'Consistency123' });
      expect(login.status).toBe(200);
      const profile = await api()
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${login.body.access_token}` });
      expect(profile.status).toBe(200);
      expect(
        profile.body.user_departments
          .filter((row: any) => row.is_primary)
          .map((row: any) => row.department.id),
      ).toEqual([String(departments[1])]);
    });

    it('keeps repeated assignment idempotent and allows demotion/removal without inventing a replacement primary', async () => {
      const userId = await owner();
      await post(userId, departments[0], true);
      await post(userId, departments[1], false);
      const original = await rows(userId);
      expect((await post(userId, departments[0], true)).status).toBe(201);
      expect(await rows(userId)).toEqual(original);
      expect((await post(userId, departments[0])).status).toBe(201);
      expect((await rows(userId)).every((row) => !row.is_primary)).toBe(true);
      await post(userId, departments[0], true);
      const removed = await api()
        .delete(`/api/users/${userId}/departments/${departments[0]}`)
        .set(authorization());
      expect(removed.status).toBe(200);
      const after = await rows(userId);
      expect(after).toHaveLength(1);
      expect(after[0].department_id).toBe(departments[1]);
      expect(after[0].is_primary).toBe(false);
    });

    it('rejects missing/inactive departments and malformed input without demoting an existing primary', async () => {
      const userId = await owner();
      await member(userId, departments[0], true);
      const inactiveId = await newDepartment();
      await prisma.departments.update({
        where: { id: inactiveId },
        data: { status: 'INACTIVE' },
      });
      const original = await rows(userId);
      expect((await post(userId, inactiveId, true)).status).toBe(400);
      expect((await post(userId, 999999999n, true)).status).toBe(400);
      expect((await post(999999999n, departments[0], true)).status).toBe(404);
      const malformed = await api()
        .post(`/api/users/${userId}/departments`)
        .set(authorization())
        .send({ department_id: Number(departments[1]), is_primary: 'true' });
      expect(malformed.status).toBe(400);
      expect(await rows(userId)).toEqual(original);
    });

    it('requires ADMIN authorization and saves no memberships for rejected callers', async () => {
      const userId = await owner();
      const path = `/api/users/${userId}/departments`;
      const body = { department_id: Number(departments[0]), is_primary: true };
      expect((await api().post(path).send(body)).status).toBe(401);
      for (const accountId of [lecturer, students[0].account]) {
        const user = await prisma.users.findUniqueOrThrow({
          where: { id: accountId },
        });
        const login = await api()
          .post('/api/auth/login')
          .send({ identifier: user.email, password: 'Consistency123' });
        expect(login.status).toBe(200);
        expect(
          (
            await api()
              .post(path)
              .set({ Authorization: `Bearer ${login.body.access_token}` })
              .send(body)
          ).status,
        ).toBe(403);
      }
      expect(await rows(userId)).toEqual([]);
    });

    it('rejects duplicate primaries through direct SQL atomically while retaining non-primary membership support', async () => {
      const userId = await owner();
      await expect(prisma.$executeRaw`
        INSERT INTO user_departments (user_id, department_id, is_primary)
        VALUES (${userId}, ${departments[0]}, TRUE),
               (${userId}, ${departments[1]}, FALSE),
               (${userId}, ${departments[2]}, TRUE)`).rejects.toMatchObject({
        code: 'P2010',
        meta: { code: '23505' },
      });
      expect(await rows(userId)).toEqual([]);
      for (const departmentId of departments)
        await member(userId, departmentId);
      expect(await rows(userId)).toHaveLength(3);
    });

    it('rejects a simultaneous first-primary race without partial membership changes and allows a deliberate retry after reload', async () => {
      const userId = await owner();
      const firstGate = gateTransaction(prisma, 'user_departments', 'upsert');
      const secondGate = gateTransaction(prisma, 'user_departments', 'upsert');
      const first = new UsersService(firstGate.db).assignDepartment(userId, {
        department_id: Number(departments[0]),
        is_primary: true,
      });
      const second = new UsersService(secondGate.db).assignDepartment(userId, {
        department_id: Number(departments[1]),
        is_primary: true,
      });
      const firstResult = first.then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      const secondResult = second.then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      try {
        await Promise.all([firstGate.wait(first), secondGate.wait(second)]);
      } finally {
        firstGate.release();
        secondGate.release();
      }
      const outcomes = await Promise.all([firstResult, secondResult]);
      expect(outcomes.filter((result) => result.error === null)).toHaveLength(
        1,
      );
      const failure = outcomes.find((result) => result.error !== null)!.error;
      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure.getResponse()).toMatchObject({
        code: 'DEPARTMENT_ASSIGNMENT_CONFLICT',
      });
      const committed = await rows(userId);
      expect(committed).toHaveLength(1);
      expect(committed[0].is_primary).toBe(true);
      const retryDepartment =
        committed[0].department_id === departments[0]
          ? departments[1]
          : departments[0];
      expect((await post(userId, retryDepartment, true)).status).toBe(201);
      const afterRetry = await rows(userId);
      expect(afterRetry).toHaveLength(2);
      expect(
        afterRetry
          .filter((row) => row.is_primary)
          .map((row) => row.department_id),
      ).toEqual([retryDepartment]);
    });

    it('rolls back the previous-primary demotion if the target department disappears before upsert', async () => {
      const userId = await owner();
      await member(userId, departments[0], true);
      await member(userId, departments[1]);
      const targetId = await newDepartment();
      const original = await rows(userId);
      const gate = gateTransaction(prisma, 'user_departments', 'upsert');
      const assigning = new UsersService(gate.db).assignDepartment(userId, {
        department_id: Number(targetId),
        is_primary: true,
      });
      const outcome = assigning.then(
        () => null,
        (error) => error,
      );
      try {
        await gate.wait(assigning);
        await prisma.departments.delete({ where: { id: targetId } });
      } finally {
        gate.release();
      }
      const failure = await outcome;
      expect(failure).not.toBeNull();
      expect([400, 409]).toContain(failure.getStatus());
      expect(await rows(userId)).toEqual(original);
    });

    const temporaryTable = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE user_departments (user_id BIGINT, department_id BIGINT, is_primary BOOLEAN NOT NULL, created_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (user_id, department_id)) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_temp, public');
    };

    it('applies the exact migration to clean temporary data without altering rows or restricting non-primary memberships', async () => {
      await prisma.$transaction(async (tx) => {
        await temporaryTable(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO user_departments (user_id, department_id, is_primary) VALUES (1, 1, TRUE), (1, 2, FALSE), (1, 3, FALSE)',
        );
        const original = await tx.$queryRawUnsafe(
          'SELECT * FROM user_departments ORDER BY department_id',
        );
        await tx.$executeRawUnsafe(migration);
        expect(
          await tx.$queryRawUnsafe(
            'SELECT * FROM user_departments ORDER BY department_id',
          ),
        ).toEqual(original);
        const indexes = await tx.$queryRaw<
          { unique: boolean; predicate: string }[]
        >`
          SELECT i.indisunique AS unique, pg_get_expr(i.indpred, i.indrelid) AS predicate
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = 'user_departments'::regclass AND c.relname = 'user_departments_one_primary_per_user_idx'`;
        expect(indexes).toHaveLength(1);
        expect(indexes[0].unique).toBe(true);
        expect(indexes[0].predicate).toContain('is_primary');
      });
    });

    it('blocks the exact migration for duplicate temporary primaries without choosing or rewriting an assignment', async () => {
      await prisma.$transaction(async (tx) => {
        await temporaryTable(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO user_departments (user_id, department_id, is_primary) VALUES (1, 1, TRUE), (1, 2, TRUE), (1, 3, FALSE)',
        );
        const original = await tx.$queryRawUnsafe(
          'SELECT * FROM user_departments ORDER BY department_id',
        );
        await tx.$executeRawUnsafe('SAVEPOINT primary_preflight');
        await expect(tx.$executeRawUnsafe(migration)).rejects.toThrow(
          'Multiple primary departments exist',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT primary_preflight');
        expect(
          await tx.$queryRawUnsafe(
            'SELECT * FROM user_departments ORDER BY department_id',
          ),
        ).toEqual(original);
        const [index] = await tx.$queryRaw<
          { name: string | null }[]
        >`SELECT to_regclass('pg_temp.user_departments_one_primary_per_user_idx')::text AS name`;
        expect(index.name).toBeNull();
      });
    });
  });

  describe('Closed lecturer results and teaching history', () => {
    let lecturerToken: string;
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
    const loginAccount = async (id: bigint) => {
      const user = await prisma.users.findUniqueOrThrow({ where: { id } });
      const result = await api().post('/api/auth/login').send({
        identifier: user.email,
        password: 'Consistency123',
      });
      expect(result.status).toBe(200);
      return result.body.access_token as string;
    };
    const newYear = async () => {
      const result = await prisma.academic_years.create({
        data: { name: `P${extraYearIds.length}-${stamp}`, start_year: 2027 },
      });
      extraYearIds.push(result.id);
      return result.id;
    };
    const newSemester = async () => {
      const now = new Date();
      const result = await prisma.semesters.create({
        data: {
          academic_year_id: year,
          semester_name: `Policy-${extraSemesterIds.length}-${stamp}`,
          semester_number: null,
          created_at: now,
          updated_at: now,
        },
      });
      extraSemesterIds.push(result.id);
      return result.id;
    };
    const history = (id: bigint) =>
      prisma.course_offerings.findUniqueOrThrow({
        where: { id },
        include: {
          group_scopes: true,
          enrollments: true,
          evaluations: {
            include: {
              generation_targets: true,
              group_targets: true,
              evaluation_participants: { include: { assessment_drafts: true } },
              responses: {
                include: { answers: { include: { answer_options: true } } },
              },
            },
          },
        },
      });
    const pendingCreation = async (assignmentId: bigint) => {
      const { v1 } = await survey();
      await prisma.enrollments.createMany({
        data: students.map((s) => ({
          student_id: s.account,
          course_offering_id: assignmentId,
          enrolled_at: new Date(),
        })),
      });
      return {
        course_offering_id: String(assignmentId),
        survey_version_id: String(v1.id),
        confirmed_student_ids: students.map((s) => String(s.account)),
      };
    };

    beforeAll(async () => {
      lecturerToken = await loginAccount(lecturer);
    });

    it('withholds OPEN/DRAFT lecturer answers and releases owned results, dashboard and comments after close', async () => {
      const open = await evaluation();
      const draft = await evaluation();
      await prisma.evaluations.update({
        where: { id: draft.id },
        data: { status: 'DRAFT' },
      });
      const comment = 'Policy withheld comment';
      await app.get(SubmissionsService).submit(open.id, students[0].account, {
        answers: [
          ...answers(open.v1).answers,
          {
            question_id: String(
              open.v1.questions.find((q) => q.question_type === 'TEXT')!.id,
            ),
            text_value: comment,
          },
        ],
      });
      const before = await history(open.assignment.id);
      const withheld = await api()
        .get('/api/lecturer/results')
        .set(bearer(lecturerToken));
      expect(withheld.status).toBe(200);
      expect(
        withheld.body.evaluations.some((e: any) =>
          [String(open.id), String(draft.id)].includes(e.evaluation.id),
        ),
      ).toBe(false);
      expect(
        withheld.body.evaluations.every(
          (e: any) => e.evaluation.status === 'CLOSED',
        ),
      ).toBe(true);
      expect(JSON.stringify(withheld.body)).not.toContain(comment);
      for (const suffix of ['dashboard', 'comments']) {
        expect(
          (
            await api()
              .get(`/api/lecturer/evaluations/${open.id}/${suffix}`)
              .set(bearer(lecturerToken))
          ).status,
        ).toBe(409);
      }
      const adminResults = await api()
        .get('/api/admin/results')
        .set(authorization());
      expect(adminResults.status).toBe(200);
      expect(
        adminResults.body.some((e: any) => e.evaluation.id === String(open.id)),
      ).toBe(true);
      expect(await history(open.assignment.id)).toEqual(before);
      await app.get(EvaluationsService).close(open.id);
      const released = await api()
        .get('/api/lecturer/results')
        .set(bearer(lecturerToken));
      const own = released.body.evaluations.find(
        (e: any) => e.evaluation.id === String(open.id),
      );
      expect(released.status).toBe(200);
      expect(own.submission_count).toBe(1);
      expect(JSON.stringify(own)).toContain(comment);
      expect(JSON.stringify(own)).not.toMatch(
        /student_id|participant_id|response_id|password_hash/,
      );
      for (const suffix of ['dashboard', 'comments']) {
        expect(
          (
            await api()
              .get(`/api/lecturer/evaluations/${open.id}/${suffix}`)
              .set(bearer(lecturerToken))
          ).status,
        ).toBe(200);
      }
      const after = await history(open.assignment.id);
      expect(after.evaluations[0].responses).toEqual(
        before.evaluations[0].responses,
      );
      expect(after.evaluations[0].evaluation_participants).toEqual(
        before.evaluations[0].evaluation_participants,
      );
    });

    it('returns an empty released list for another lecturer and preserves authentication, role and ownership checks', async () => {
      const stranger = await account(
        'LECTURER',
        `policy-empty-${userIds.length}`,
      );
      const token = await loginAccount(stranger);
      const empty = await api().get('/api/lecturer/results').set(bearer(token));
      expect(empty.status).toBe(200);
      expect(empty.body.evaluations).toEqual([]);
      expect((await api().get('/api/lecturer/results')).status).toBe(401);
      const studentToken = await loginAccount(students[0].account);
      expect(
        (await api().get('/api/lecturer/results').set(bearer(studentToken)))
          .status,
      ).toBe(403);
      const e = await evaluation();
      await app.get(EvaluationsService).close(e.id);
      expect(
        (
          await api()
            .get(`/api/lecturer/evaluations/${e.id}/comments`)
            .set(bearer(token))
        ).status,
      ).toBe(403);
    });

    it.each(['DRAFT', 'OPEN', 'CLOSED'] as const)(
      'rejects course/lecturer/semester changes for %s evaluations with exact history unchanged',
      async (status) => {
        const e = await evaluation();
        if (status !== 'OPEN')
          await prisma.evaluations.update({
            where: { id: e.id },
            data: { status },
          });
        if (status === 'OPEN') {
          await app
            .get(AssessmentDraftsService)
            .save(e.id, students[0].account, answers(e.v1));
          await app
            .get(SubmissionsService)
            .submit(e.id, students[1].account, answers(e.v1));
        }
        const alternate = await offering();
        const alternateLecturer = await account(
          'LECTURER',
          `policy-alt-${userIds.length}`,
        );
        const alternateSemester = await newSemester();
        const before = await history(e.assignment.id);
        for (const change of [
          { course_id: String(alternate.course_id) },
          { lecturer_id: String(alternateLecturer) },
          { semester_id: String(alternateSemester) },
        ]) {
          const result = await api()
            .put(`/api/course-offerings/${e.assignment.id}`)
            .set(authorization())
            .send(change);
          expect(result.status).toBe(409);
          expect(result.body.code).toBe('OFFERING_HISTORY_PROTECTED');
          expect(await history(e.assignment.id)).toEqual(before);
        }
      },
    );

    it.each(['DRAFT', 'OPEN', 'CLOSED'] as const)(
      'rejects an indirect academic-year move through a semester used by a %s evaluation',
      async (status) => {
        const ownSemester = await newSemester();
        const e = await evaluation(ownSemester);
        if (status !== 'OPEN')
          await prisma.evaluations.update({
            where: { id: e.id },
            data: { status },
          });
        const targetYear = await newYear();
        const original = await prisma.semesters.findUniqueOrThrow({
          where: { id: ownSemester },
        });
        const before = await history(e.assignment.id);
        const rejected = await api()
          .put(`/api/semesters/${ownSemester}`)
          .set(authorization())
          .send({ academic_year_id: Number(targetYear) });
        expect(rejected.status).toBe(409);
        expect(rejected.body.code).toBe('SEMESTER_HISTORY_PROTECTED');
        expect(
          await prisma.semesters.findUniqueOrThrow({
            where: { id: ownSemester },
          }),
        ).toEqual(original);
        expect(await history(e.assignment.id)).toEqual(before);
      },
    );

    it('keeps unused offering and unused semester context editable', async () => {
      const ownSemester = await newSemester();
      const unused = await offering([], ownSemester);
      const alternate = await offering();
      const alternateLecturer = await account(
        'LECTURER',
        `policy-unused-${userIds.length}`,
      );
      const targetYear = await newYear();
      const semesterEdit = await api()
        .put(`/api/semesters/${ownSemester}`)
        .set(authorization())
        .send({ academic_year_id: Number(targetYear) });
      expect(semesterEdit.status).toBe(200);
      await prisma.course_year_rules.create({
        data: {
          course_id: alternate.course_id,
          major_id: major,
          year_level: 1,
          revisions: {
            create: {
              revision_no: 1,
              effective_academic_year_id: year,
              effective_start_year: 2026,
              enabled: true,
            },
          },
        },
      });
      const result = await api()
        .put(`/api/course-offerings/${unused.id}`)
        .set(authorization())
        .send({
          course_id: String(alternate.course_id),
          lecturer_id: String(alternateLecturer),
          semester_id: String(semester),
        });
      expect(result.status).toBe(200);
      expect(result.body.lecturer_id).toBe(String(alternateLecturer));
      expect(result.body.course_id).toBe(String(alternate.course_id));
      expect(result.body.semester_id).toBe(String(semester));
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: unused.id },
        }),
      ).toBe(0);
    });

    it('permits display edits and identical context IDs while retaining scope, drafts and answers', async () => {
      const ownSemester = await newSemester();
      const e = await evaluation(ownSemester);
      await app
        .get(AssessmentDraftsService)
        .save(e.id, students[0].account, answers(e.v1));
      await app
        .get(SubmissionsService)
        .submit(e.id, students[1].account, answers(e.v1));
      const before = await history(e.assignment.id);
      const result = await api()
        .put(`/api/course-offerings/${e.assignment.id}`)
        .set(authorization())
        .send({
          course_id: String(e.assignment.course_id),
          lecturer_id: String(lecturer),
          semester_id: String(ownSemester),
          section_code: 'Policy display edit',
        });
      expect(result.status).toBe(200);
      const semesterEdit = await api()
        .put(`/api/semesters/${ownSemester}`)
        .set(authorization())
        .send({
          academic_year_id: Number(year),
          semester_name: 'Policy renamed semester',
        });
      expect(semesterEdit.status).toBe(200);
      const after = await history(e.assignment.id);
      expect(after.evaluations).toEqual(before.evaluations);
      expect(after.enrollments).toEqual(before.enrollments);
      expect(after.group_scopes).toEqual(before.group_scopes);
      expect(after.section_code).toBe('Policy display edit');
    });

    it('rolls back a teaching reassignment when evaluation creation commits during its protected transaction', async () => {
      const unused = await offering();
      const input = await pendingCreation(unused.id);
      const alternateLecturer = await account(
        'LECTURER',
        `policy-race-${userIds.length}`,
      );
      const gate = gateTransaction(prisma, 'course_offerings', 'update');
      const updating = new CourseOfferingsService(gate.db).update(unused.id, {
        lecturer_id: String(alternateLecturer),
      });
      const outcome = updating.then(
        () => null,
        (error) => error,
      );
      try {
        await gate.wait(updating);
        await app.get(EvaluationsService).create(input, admin);
      } finally {
        gate.release();
      }
      expect(await outcome).toBeInstanceOf(ConflictException);
      expect(
        (
          await prisma.course_offerings.findUniqueOrThrow({
            where: { id: unused.id },
          })
        ).lecturer_id,
      ).toBe(lecturer);
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: unused.id },
        }),
      ).toBe(1);
    });

    it('rolls back a semester year move when evaluation creation commits during its protected transaction', async () => {
      const ownSemester = await newSemester();
      const unused = await offering([], ownSemester);
      const input = await pendingCreation(unused.id);
      const targetYear = await newYear();
      const gate = gateTransaction(prisma, 'semesters', 'update');
      const updating = new SemestersService(gate.db).update(ownSemester, {
        academic_year_id: Number(targetYear),
      });
      const outcome = updating.then(
        () => null,
        (error) => error,
      );
      try {
        await gate.wait(updating);
        await app.get(EvaluationsService).create(input, admin);
      } finally {
        gate.release();
      }
      expect(await outcome).toBeInstanceOf(ConflictException);
      expect(
        (
          await prisma.semesters.findUniqueOrThrow({
            where: { id: ownSemester },
          })
        ).academic_year_id,
      ).toBe(year);
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: unused.id },
        }),
      ).toBe(1);
    });
  });

  describe('Approved student progression', () => {
    let previousYear: bigint,
      entryYear: bigint,
      nextYear: bigint,
      progressionGeneration: bigint;
    beforeAll(async () => {
      for (const start of [2024, 2025, 2027]) {
        const y = await prisma.academic_years.create({
          data: { name: `P-${stamp}-${start}`, start_year: start },
        });
        extraYearIds.push(y.id);
      }
      [entryYear, previousYear, nextYear] = extraYearIds.slice(-3);
      progressionGeneration = (
        await prisma.student_generations.create({
          data: { name: `P-${stamp}`, entry_academic_year_id: entryYear },
        })
      ).id;
      extraGenerationIds.push(progressionGeneration);
    });
    const recordUrl = (id?: bigint) =>
      `/api/student-academic-records${id ? `/${id}` : ''}`;
    const context = async (profile: bigint, y = year) =>
      (
        (await app.get(StudentsService).findOne(profile, String(y))) as {
          academic_context: any;
        }
      ).academic_context;
    async function approve(
      s: { profile: bigint },
      y: bigint,
      level: number,
      action: 'NORMAL' | 'REPEAT' | 'TRANSFER' | 'PAUSE' | 'RESUME',
      group: string | null = 'A',
      m = major,
    ) {
      return api().post(recordUrl()).set(authorization()).send({
        student_id: s.profile.toString(),
        academic_year_id: y.toString(),
        year_level: level,
        major_id: m.toString(),
        class_group: group,
        progression_action: action,
      });
    }
    async function own() {
      const s = await student('A', progressionGeneration);
      await prisma.student_academic_records.delete({
        where: { id: s.placement },
      });
      return s;
    }
    async function assignedEvaluation(
      s: { account: bigint },
      assignment: { id: bigint },
    ) {
      const { set, v1 } = await survey();
      const now = new Date();
      await prisma.enrollments.create({
        data: {
          course_offering_id: assignment.id,
          student_id: s.account,
          enrolled_at: now,
        },
      });
      const e = await prisma.evaluations.create({
        data: {
          course_offering_id: assignment.id,
          survey_version_id: v1.id,
          created_by: admin,
          status: 'OPEN',
          start_at: new Date(Date.now() - 60000),
          end_at: new Date(Date.now() + 86400000),
          created_at: now,
          updated_at: now,
          evaluation_participants: {
            create: {
              student_id: s.account,
              survey_version_id: v1.id,
              created_at: now,
            },
          },
        },
        include: { evaluation_participants: true },
      });
      return { ...e, set, v1 };
    }

    it('repeat uses the approved placement anchor consistently and requires a new yearly group', async () => {
      const s = await own();
      expect((await approve(s, previousYear, 1, 'REPEAT')).status).toBe(201);
      expect(await context(s.profile)).toMatchObject({
        calculated_year_level: 3,
        effective_year_level: 2,
        year_level_source: 'PROGRESSION_CALCULATION',
        placement_eligible: false,
        placement: { class_group: null },
      });
      const studentsService = app.get(StudentsService);
      expect(
        await studentsService.selectStudentsForEnrollment({
          academic_year_id: year.toString(),
          generation_id: progressionGeneration.toString(),
        }),
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: s.profile })]),
      );
      const current = await approve(s, year, 2, 'NORMAL', 'B');
      expect(current.status).toBe(201);
      expect(await context(s.profile)).toMatchObject({
        effective_year_level: 2,
        placement_eligible: true,
        placement: { class_group: 'B' },
      });
      expect(await context(s.profile, nextYear)).toMatchObject({
        effective_year_level: 3,
        placement_eligible: false,
        placement: { class_group: null },
      });
      const assignment = await offering();
      await prisma.course_offerings.update({
        where: { id: assignment.id },
        data: { year_level: 2 },
      });
      expect(
        (
          await api()
            .post(`/api/course-offerings/${assignment.id}/enrollments`)
            .set(authorization())
            .send({ student_id: s.account.toString() })
        ).status,
      ).toBe(201);
      const preview = await app
        .get(EvaluationsService)
        .previewParticipants({ course_offering_id: assignment.id.toString() });
      expect(preview.eligible_students).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            student_id: s.profile.toString(),
            effective_year_level: 2,
            class_group: 'B',
          }),
        ]),
      );
    });

    it('transfer uses the new approved level and major across views and export without rewriting earlier placement', async () => {
      const s = await own();
      const newMajor = (
        await prisma.majors.create({
          data: {
            code: `PT-${stamp}`,
            name: 'Transfer destination',
            department_id: department,
          },
        })
      ).id;
      extraMajorIds.push(newMajor);
      expect((await approve(s, entryYear, 1, 'NORMAL')).status).toBe(201);
      const transferred = await approve(
        s,
        previousYear,
        3,
        'TRANSFER',
        'T',
        newMajor,
      );
      expect(transferred.status).toBe(201);
      expect(await context(s.profile)).toMatchObject({
        calculated_year_level: 3,
        effective_year_level: 4,
        placement: { major_id: newMajor, class_group: null },
        placement_eligible: false,
      });
      expect((await approve(s, year, 4, 'NORMAL', 'X', newMajor)).status).toBe(
        201,
      );
      const assignment = await offering();
      await prisma.course_offerings.update({
        where: { id: assignment.id },
        data: { year_level: 4 },
      });
      const e = await assignedEvaluation(s, assignment);
      const exportResponse = await api()
        .get(
          `/api/students/export?academic_year_id=${year}&generation_id=${progressionGeneration}&major_id=${newMajor}`,
        )
        .set(authorization());
      expect(exportResponse.status).toBe(200);
      expect(
        exportResponse.body.data.find(
          (row: any) => row.student_code === `C-${stamp}-${s.account}`,
        ),
      ).toMatchObject({
        placement: {
          year_level: 4,
          major_id: newMajor.toString(),
          class_group: 'X',
        },
        academic_context: {
          effective_year_level: 4,
          progression_status: 'ACTIVE',
        },
      });
      expect(
        await prisma.student_academic_records.findUnique({
          where: {
            student_id_academic_year_id: {
              student_id: s.profile,
              academic_year_id: entryYear,
            },
          },
        }),
      ).toMatchObject({ year_level: 1, major_id: major, class_group: 'A' });
      expect(
        await app
          .get(StudentAccessService)
          .getAnswerableEvaluation(e.id, s.account),
      ).toBeDefined();
    });

    it('pause persists across ordinary placements and blocks targeting, enrollment, available surveys, drafts and submissions until explicit resume', async () => {
      const s = await own();
      expect((await approve(s, previousYear, 1, 'PAUSE')).status).toBe(201);
      const current = await approve(s, year, 1, 'NORMAL');
      expect(current.status).toBe(201);
      expect(await context(s.profile)).toMatchObject({
        progression_status: 'PAUSED',
        placement_eligible: false,
      });
      const assignment = await offering();
      const e = await assignedEvaluation(s, assignment);
      const access = app.get(StudentAccessService);
      expect(await access.findAvailable(s.account)).toEqual([]);
      await expect(
        access.getAnswerableEvaluation(e.id, s.account),
      ).rejects.toThrow('paused');
      await expect(
        app.get(AssessmentDraftsService).save(e.id, s.account, { answers: [] }),
      ).rejects.toThrow('paused');
      await expect(
        app.get(SubmissionsService).submit(e.id, s.account, { answers: [] }),
      ).rejects.toThrow('paused');
      const preview = await app
        .get(EvaluationsService)
        .previewParticipants({ course_offering_id: assignment.id.toString() });
      expect(preview.eligible_count).toBe(0);
      expect(preview.ineligible_reasons.paused_student).toBe(1);
      const another = await offering();
      await expect(
        app
          .get(EnrollmentsService)
          .create(another.id, { student_id: s.account.toString() }),
      ).rejects.toThrow('paused');
      expect(
        (
          await api()
            .put(recordUrl(BigInt(current.body.id)))
            .set(authorization())
            .send({ progression_action: 'RESUME' })
        ).status,
      ).toBe(200);
      expect(await context(s.profile)).toMatchObject({
        progression_status: 'ACTIVE',
        placement_eligible: true,
      });
      expect(await access.findAvailable(s.account)).toHaveLength(1);
      await expect(
        access.getAnswerableEvaluation(e.id, s.account),
      ).resolves.toBeDefined();
      expect(
        (
          await app.get(EvaluationsService).previewParticipants({
            course_offering_id: assignment.id.toString(),
          })
        ).eligible_count,
      ).toBe(1);
      await expect(
        app.get(AssessmentDraftsService).save(e.id, s.account, { answers: [] }),
      ).resolves.toBeDefined();
      expect(
        await prisma.evaluation_participants.count({
          where: { evaluation_id: e.id },
        }),
      ).toBe(1);
      expect(
        await prisma.responses.count({ where: { evaluation_id: e.id } }),
      ).toBe(0);
    });

    it('same-year pause requires explicit resume and preserves frozen assignment and saved draft', async () => {
      const s = await student('A');
      const assignment = await offering();
      const e = await assignedEvaluation(s, assignment);
      await app
        .get(AssessmentDraftsService)
        .save(e.id, s.account, { answers: [] });
      const before = await prisma.assessment_drafts.findUniqueOrThrow({
        where: { participant_id: e.evaluation_participants[0].id },
      });
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'PAUSE' })
        ).status,
      ).toBe(200);
      await expect(
        app.get(StudentAccessService).getAnswerableEvaluation(e.id, s.account),
      ).rejects.toThrow('paused');
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ class_group: 'B' })
        ).status,
      ).toBe(200);
      for (const action of ['NORMAL', 'REPEAT', 'TRANSFER'])
        expect(
          (
            await api()
              .put(recordUrl(s.placement))
              .set(authorization())
              .send({ progression_action: action })
          ).status,
        ).toBe(400);
      expect(
        (await api().delete(recordUrl(s.placement)).set(authorization()))
          .status,
      ).toBe(409);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'RESUME' })
        ).status,
      ).toBe(200);
      await expect(
        app.get(StudentAccessService).getAnswerableEvaluation(e.id, s.account),
      ).resolves.toBeDefined();
      expect(
        await prisma.assessment_drafts.findUnique({ where: { id: before.id } }),
      ).toEqual(before);
      expect(
        await prisma.evaluation_participants.findUnique({
          where: { id: e.evaluation_participants[0].id },
        }),
      ).toEqual(e.evaluation_participants[0]);
    });

    it('a missing or blank yearly group blocks all new eligibility including legacy offering paths', async () => {
      const s = await own();
      expect((await approve(s, previousYear, 1, 'REPEAT', 'OLD')).status).toBe(
        201,
      );
      const assignment = await offering();
      await prisma.course_offerings.update({
        where: { id: assignment.id },
        data: { year_level: 2 },
      });
      const e = await assignedEvaluation(s, assignment);
      for (const group of [undefined, null, '  ']) {
        if (group !== undefined) {
          const existing = await prisma.student_academic_records.findUnique({
            where: {
              student_id_academic_year_id: {
                student_id: s.profile,
                academic_year_id: year,
              },
            },
          });
          if (existing)
            await api()
              .put(recordUrl(existing.id))
              .set(authorization())
              .send({ class_group: group });
          else
            expect((await approve(s, year, 2, 'NORMAL', group)).status).toBe(
              201,
            );
        }
        expect(await context(s.profile)).toMatchObject({
          effective_year_level: 2,
          placement_eligible: false,
          ineligibility_reason: 'MISSING_YEARLY_GROUP',
          placement: { class_group: null },
        });
        expect(
          (
            await app.get(EvaluationsService).previewParticipants({
              course_offering_id: assignment.id.toString(),
            })
          ).ineligible_reasons.missing_yearly_group,
        ).toBe(1);
        expect(
          await app.get(StudentsService).selectStudentsForEnrollment({
            academic_year_id: year.toString(),
            generation_id: progressionGeneration.toString(),
            year_level: 2,
          }),
        ).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: s.profile })]),
        );
        await expect(
          app
            .get(StudentAccessService)
            .getAnswerableEvaluation(e.id, s.account),
        ).rejects.toThrow('class group');
      }
      const another = await offering();
      await prisma.course_offerings.update({
        where: { id: another.id },
        data: { year_level: 2 },
      });
      await expect(
        app
          .get(EnrollmentsService)
          .create(another.id, { student_id: s.account.toString() }),
      ).rejects.toThrow('class group');
    });

    it('rejects invalid progression actions, resuming without a pause, missing chronology and moving exception anchors', async () => {
      const s = await student('A');
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'AUTO_RESUME' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: null })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ year_level: null })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'RESUME' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'REPEAT' })
        ).status,
      ).toBe(200);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ academic_year_id: nextYear.toString() })
        ).status,
      ).toBe(400);
      expect(
        (await api().delete(recordUrl(s.placement)).set(authorization()))
          .status,
      ).toBe(409);
      const unknown = await prisma.academic_years.create({
        data: { name: `PU-${stamp}` },
      });
      extraYearIds.push(unknown.id);
      expect((await approve(s, unknown.id, 2, 'TRANSFER')).status).toBe(400);
    });

    it('a pause after reviewed preview makes confirmation stale and writes no enrollment', async () => {
      const s = await student('A');
      const assignment = await offering(['A']);
      const dto = {
        ...selection(['A']),
        confirmed_student_ids: [s.account.toString()],
      };
      const workflow = app.get(ReviewedWorkflowsService);
      const review = await workflow.previewGroup(assignment.id, dto, admin);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'PAUSE' })
        ).status,
      ).toBe(200);
      await expect(
        workflow.confirmGroup(
          assignment.id,
          { ...dto, review_id: review.review_id },
          admin,
        ),
      ).rejects.toThrow();
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: assignment.id },
        }),
      ).toBe(0);
      expect(
        await prisma.reviewed_operations.findUnique({
          where: { id: review.review_id },
        }),
      ).toMatchObject({ completed_at: null, result_json: null });
    });

    it('resuming with no yearly group clears the pause but does not restore eligibility', async () => {
      const s = await own();
      expect((await approve(s, previousYear, 1, 'PAUSE')).status).toBe(201);
      expect((await approve(s, year, 1, 'RESUME', null)).status).toBe(201);
      expect(await context(s.profile)).toMatchObject({
        progression_status: 'ACTIVE',
        placement_eligible: false,
        ineligibility_reason: 'MISSING_YEARLY_GROUP',
      });
      const current = await prisma.student_academic_records.findUniqueOrThrow({
        where: {
          student_id_academic_year_id: {
            student_id: s.profile,
            academic_year_id: year,
          },
        },
      });
      expect(
        (
          await api()
            .put(recordUrl(current.id))
            .set(authorization())
            .send({ class_group: 'NEW' })
        ).status,
      ).toBe(200);
      expect(await context(s.profile)).toMatchObject({
        progression_status: 'ACTIVE',
        placement_eligible: true,
      });
    });

    it('prior approved anchor changes invalidate a review even if current placement and account selection stay the same', async () => {
      const s = await student('A', progressionGeneration);
      const approved = await approve(s, previousYear, 1, 'REPEAT');
      expect(approved.status).toBe(201);
      const assignment = await offering();
      const workflow = app.get(ReviewedWorkflowsService);
      const dto = {
        academic_year_id: year.toString(),
        generation_id: progressionGeneration.toString(),
        year_level: 1,
        major_id: major.toString(),
        class_groups: ['A'],
      };
      const review = await workflow.previewGroup(assignment.id, dto, admin);
      expect(review.confirmed_student_ids).toContain(s.account.toString());
      expect(
        (
          await api()
            .put(recordUrl(BigInt(approved.body.id)))
            .set(authorization())
            .send({ year_level: 2 })
        ).status,
      ).toBe(200);
      expect(
        (await app.get(EnrollmentsService).previewGroup(assignment.id, dto))
          .confirmed_student_ids,
      ).toEqual(review.confirmed_student_ids);
      await expect(
        workflow.confirmGroup(
          assignment.id,
          {
            ...dto,
            confirmed_student_ids: review.confirmed_student_ids,
            review_id: review.review_id,
          },
          admin,
        ),
      ).rejects.toThrow('Reviewed context');
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: assignment.id },
        }),
      ).toBe(0);
    });

    it('paused students cannot bypass eligibility through reassignment preview or confirmation', async () => {
      const s = await student('A');
      const source = await offering(['A']);
      const target = await prisma.course_offerings.create({
        data: {
          course_id: source.course_id,
          lecturer_id: lecturer,
          semester_id: semester,
          year_level: 1,
          class_type: 'TP',
          created_at: new Date(),
          updated_at: new Date(),
          group_scopes: {
            create: {
              academic_year_id: year,
              generation_id: generation,
              major_id: major,
              year_level: 1,
              class_group: 'A',
            },
          },
        },
      });
      offeringIds.push(target.id);
      const service = app.get(EnrollmentsService);
      const enrollment = await service.create(source.id, {
        student_id: s.account.toString(),
      });
      const dto = {
        student_id: s.account.toString(),
        target_offering_id: target.id.toString(),
      };
      await service.previewReassignment(source.id, dto);
      expect(
        (
          await api()
            .put(recordUrl(s.placement))
            .set(authorization())
            .send({ progression_action: 'PAUSE' })
        ).status,
      ).toBe(200);
      await expect(service.previewReassignment(source.id, dto)).rejects.toThrow(
        'paused',
      );
      await expect(
        service.confirmReassignment(source.id, {
          ...dto,
          confirmed_enrollment_id: enrollment.id.toString(),
        }),
      ).rejects.toThrow();
      expect(
        await prisma.enrollments.findUnique({ where: { id: enrollment.id } }),
      ).toMatchObject({ course_offering_id: source.id });
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(0);
    });

    it('missing pause chronology fails closed across student views, targeting and questionnaire access', async () => {
      const s = await own();
      const y = await prisma.academic_years.create({
        data: { name: `PX-${stamp}`, start_year: 2025 },
      });
      extraYearIds.push(y.id);
      expect((await approve(s, y.id, 1, 'PAUSE')).status).toBe(201);
      expect((await approve(s, year, 1, 'NORMAL')).status).toBe(201);
      const assignment = await offering();
      const e = await assignedEvaluation(s, assignment);
      await prisma.academic_years.update({
        where: { id: y.id },
        data: { start_year: null },
      });
      expect(await context(s.profile)).toMatchObject({
        progression_status: 'UNRESOLVED',
        placement_eligible: false,
      });
      expect(
        (
          await app.get(EvaluationsService).previewParticipants({
            course_offering_id: assignment.id.toString(),
          })
        ).ineligible_reasons.progression_unresolved,
      ).toBe(1);
      await expect(
        app.get(StudentAccessService).getAnswerableEvaluation(e.id, s.account),
      ).rejects.toThrow('chronology');
      expect(
        await prisma.evaluation_participants.count({
          where: { evaluation_id: e.id },
        }),
      ).toBe(1);
    });

    it('a concurrent pause and draft save serialize consistently and preserve frozen history', async () => {
      const s = await student('RACE-P');
      const assignment = await offering();
      const e = await assignedEvaluation(s, assignment);
      const gate = gateTransaction(prisma, 'assessment_drafts', 'upsert');
      const saving = new AssessmentDraftsService(
        gate.db,
        app.get(StudentAccessService),
      ).save(e.id, s.account, { answers: [] });
      const outcome = saving.then(
        () => null,
        (error) => error,
      );
      try {
        await gate.wait(saving);
        await app
          .get(StudentAcademicRecordsService)
          .update(s.placement, { progression_action: 'PAUSE' });
      } finally {
        gate.release();
      }
      const error = await outcome;
      expect(error === null || error instanceof ConflictException).toBe(true);
      expect(
        await prisma.assessment_drafts.count({
          where: { participant_id: e.evaluation_participants[0].id },
        }),
      ).toBe(error ? 0 : 1);
      await expect(
        app.get(StudentAccessService).getAnswerableEvaluation(e.id, s.account),
      ).rejects.toThrow('paused');
      expect(
        await prisma.evaluation_participants.findUnique({
          where: { id: e.evaluation_participants[0].id },
        }),
      ).toEqual(e.evaluation_participants[0]);
    });
  });

  describe('Immutable historical target labels', () => {
    const post = (url: string, body: object = {}) =>
      api().post(url).set(authorization()).send(body);
    async function prepared(groups = ['A']) {
      const target = await offering(groups);
      const own = [await student(groups[0]), await student(groups.at(-1)!)];
      await prisma.enrollments.createMany({
        data: own.map((s) => ({
          student_id: s.account,
          course_offering_id: target.id,
          enrolled_at: new Date(),
        })),
      });
      const { set, v1 } = await survey();
      const input = {
        course_offering_id: String(target.id),
        survey_version_id: String(v1.id),
        participant_scope: 'SELECTED_GENERATIONS' as const,
        generation_ids: [String(generation)],
        group_scope: selection(groups),
        start_at: new Date(Date.now() - 60000).toISOString(),
        end_at: new Date(Date.now() + 86400000).toISOString(),
      };
      const preview = await post('/api/evaluations/create-preview', input);
      expect(preview.status).toBe(200);
      const body = {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      };
      return { target, own, set, v1, input, preview, body };
    }
    async function confirmed(groups = ['A']) {
      const fixture = await prepared(groups);
      const created = await post('/api/evaluations', fixture.body);
      expect(created.status).toBe(201);
      return { ...fixture, created, id: BigInt(created.body.id) };
    }
    async function token(accountId: bigint) {
      const user = await prisma.users.findUniqueOrThrow({
        where: { id: accountId },
      });
      const login = await api()
        .post('/api/auth/login')
        .send({ identifier: user.email, password: 'Consistency123' });
      expect(login.status).toBe(200);
      return login.body.access_token as string;
    }
    const frozen = (id: bigint) =>
      prisma.evaluations.findUniqueOrThrow({
        where: { id },
        include: {
          generation_targets: true,
          group_targets: true,
          evaluation_participants: {
            orderBy: { id: 'asc' },
            include: { assessment_drafts: true },
          },
          responses: { include: { answers: true } },
        },
      });
    async function rename(kind: string) {
      const name = `L-${stamp}`;
      if (kind === 'generation') {
        const previous = await prisma.student_generations.findUniqueOrThrow({
          where: { id: generation },
        });
        await prisma.student_generations.update({
          where: { id: generation },
          data: { name },
        });
        return () =>
          prisma.student_generations.update({
            where: { id: generation },
            data: { name: previous.name },
          });
      }
      if (kind === 'major') {
        const previous = await prisma.majors.findUniqueOrThrow({
          where: { id: major },
        });
        await api()
          .put(`/api/majors/${major}`)
          .set(authorization())
          .send({ name, code: name })
          .expect(200);
        return () =>
          prisma.majors.update({
            where: { id: major },
            data: { name: previous.name, code: previous.code },
          });
      }
      const previous = await prisma.academic_years.findUniqueOrThrow({
        where: { id: year },
      });
      await api()
        .put(`/api/academic-years/${year}`)
        .set(authorization())
        .send({ name })
        .expect(200);
      return () =>
        prisma.academic_years.update({
          where: { id: year },
          data: { name: previous.name },
        });
    }

    it('previews exact labels and captures them only in the committed targeting transaction', async () => {
      const e = await prepared();
      expect(e.preview.body.target_labels.generations).toHaveLength(1);
      expect(e.preview.body.target_labels.groups).toHaveLength(1);
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: e.target.id },
        }),
      ).toBe(0);
      const created = await post('/api/evaluations', e.body).expect(201);
      const rows = await frozen(BigInt(created.body.id));
      expect(rows.generation_targets[0].historical_labels).toEqual(
        e.preview.body.target_labels.generations[0].historical_labels,
      );
      expect(rows.group_targets[0].historical_labels).toEqual(
        e.preview.body.target_labels.groups[0].historical_labels,
      );
      expect(rows.group_targets[0].labels_captured_at).toEqual(rows.created_at);
      expect(rows.generation_targets[0].labels_captured_at).toEqual(
        rows.created_at,
      );
      expect(created.body.group_targets[0].historical_labels_status).toBe(
        'CAPTURED',
      );
    });

    it.each(['generation', 'major', 'academic_year'])(
      'rejects a %s rename after review atomically and captures fresh labels after re-review',
      async (kind) => {
        const e = await prepared();
        const restore = await rename(kind);
        try {
          const stale = await post('/api/evaluations', e.body);
          expect(stale.status).toBe(409);
          expect(stale.body.code).toBe('REVIEW_STALE');
          expect(
            await prisma.evaluations.count({
              where: { course_offering_id: e.target.id },
            }),
          ).toBe(0);
          expect(
            (
              await prisma.reviewed_operations.findUniqueOrThrow({
                where: { id: e.body.review_id },
              })
            ).completed_at,
          ).toBeNull();
          const fresh = await post(
            '/api/evaluations/create-preview',
            e.input,
          ).expect(200);
          expect(fresh.body.target_labels).not.toEqual(
            e.preview.body.target_labels,
          );
          const saved = await post('/api/evaluations', {
            ...e.input,
            confirmed_student_ids: fresh.body.confirmed_student_ids,
            review_id: fresh.body.review_id,
          }).expect(201);
          expect(saved.body.group_targets[0].historical_labels).toEqual(
            fresh.body.target_labels.groups[0].historical_labels,
          );
        } finally {
          await restore();
        }
      },
    );

    it('keeps captured labels and exact drafts/completions/answers across renames and version application', async () => {
      const e = await confirmed();
      await post(`/api/evaluations/${e.id}/open`).expect(200);
      await api()
        .put(`/api/student/evaluations/${e.id}/draft`)
        .set('Authorization', `Bearer ${await token(e.own[0].account)}`)
        .send(answers(e.v1))
        .expect(200);
      await api()
        .post(`/api/student/evaluations/${e.id}/responses`)
        .set('Authorization', `Bearer ${await token(e.own[1].account)}`)
        .send(answers(e.v1))
        .expect(201);
      const before = await frozen(e.id);
      const restore = [];
      try {
        for (const kind of ['generation', 'major', 'academic_year'])
          restore.push(await rename(kind));
        const v2 = await version(e.set.id, 2);
        await app.get(SurveyVersionsService).applyToUnfinished(e.set.id, v2.id);
        await post(`/api/evaluations/${e.id}/close`).expect(200);
        const after = await frozen(e.id);
        expect(after.generation_targets).toEqual(before.generation_targets);
        expect(after.group_targets).toEqual(before.group_targets);
        expect(after.evaluation_participants).toEqual(
          before.evaluation_participants,
        );
        expect(after.responses).toEqual(before.responses);
        const adminReport = await api()
          .get('/api/admin/results')
          .set(authorization())
          .expect(200);
        const report = adminReport.body.find(
          (item: any) => item.evaluation.id === String(e.id),
        );
        expect(report.submission_count).toBe(1);
        const saved = report.target_scope.groups[0];
        expect(saved.historical_labels).toEqual(
          e.preview.body.target_labels.groups[0].historical_labels,
        );
        expect(saved.current_labels.major.name).toBe(`L-${stamp}`);
        expect(saved.historical_labels.major.name).not.toBe(
          saved.current_labels.major.name,
        );
        const lecturerToken = await token(lecturer);
        const lecturerReport = await api()
          .get('/api/lecturer/results')
          .set('Authorization', `Bearer ${lecturerToken}`)
          .expect(200);
        expect(
          lecturerReport.body.evaluations.find(
            (item: any) => item.evaluation.id === String(e.id),
          ).target_scope,
        ).toEqual(report.target_scope);
        const dashboard = await api()
          .get(`/api/lecturer/evaluations/${e.id}/dashboard`)
          .set('Authorization', `Bearer ${lecturerToken}`)
          .expect(200);
        expect(dashboard.body.group_scope.groups[0].historical_labels).toEqual(
          saved.historical_labels,
        );
        const detail = await api()
          .get(`/api/evaluations/${e.id}`)
          .set(authorization())
          .expect(200);
        expect(detail.body.group_targets[0].historical_labels).toEqual(
          saved.historical_labels,
        );
        const retry = await post('/api/evaluations', e.body).expect(201);
        expect(retry.body.already_applied).toBe(true);
        expect(retry.body.group_targets[0].historical_labels).toEqual(
          saved.historical_labels,
        );
        expect(retry.body.group_targets[0].current_labels.major.name).toBe(
          before.group_targets[0].historical_labels &&
            (e.preview.body.target_labels.groups[0].historical_labels as any)
              .major.name,
        );
        expect(JSON.stringify(report)).not.toMatch(
          /student_id|student_code|participant_id|response_id|password_hash/,
        );
      } finally {
        for (const undo of restore.reverse()) await undo();
      }
    });

    it('keeps legacy target labels unknown through reads and lifecycle actions', async () => {
      const e = await evaluation();
      await prisma.evaluation_generation_targets.create({
        data: { evaluation_id: e.id, generation_id: generation },
      });
      await prisma.evaluation_group_targets.create({
        data: {
          evaluation_id: e.id,
          academic_year_id: year,
          generation_id: generation,
          major_id: major,
          year_level: 1,
          class_group: 'A',
        },
      });
      await post(`/api/evaluations/${e.id}/close`).expect(200);
      const report = (
        await api().get('/api/admin/results').set(authorization()).expect(200)
      ).body.find((item: any) => item.evaluation.id === String(e.id));
      for (const target of [
        ...report.target_scope.groups,
        ...report.target_scope.generations,
      ]) {
        expect(target.historical_labels).toBeNull();
        expect(target.labels_captured_at).toBeNull();
        expect(target.historical_labels_status).toBe('UNKNOWN');
        expect(target.historical_labels_unavailable_reason).toBe(
          'LEGACY_LABELS_NOT_CAPTURED',
        );
        expect(target.current_labels.generation.name).toBeTruthy();
      }
      const row = (await frozen(e.id)).group_targets[0];
      await expect(
        prisma.evaluation_group_targets.update({
          where: { id: row.id },
          data: {
            historical_labels: { schema_version: 1 },
            labels_captured_at: new Date(),
          },
        }),
      ).rejects.toThrow();
      expect(
        (await frozen(e.id)).group_targets[0].historical_labels,
      ).toBeNull();
    });

    it('rejects SQL rewrites of captured labels and frozen target identity', async () => {
      const e = await confirmed();
      const before = await frozen(e.id);
      await expect(
        prisma.evaluation_group_targets.update({
          where: { id: before.group_targets[0].id },
          data: {
            historical_labels: { schema_version: 1 },
            labels_captured_at: new Date(),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.evaluation_generation_targets.update({
          where: {
            evaluation_id_generation_id: {
              evaluation_id: e.id,
              generation_id: generation,
            },
          },
          data: { historical_labels: Prisma.DbNull, labels_captured_at: null },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.evaluation_group_targets.update({
          where: { id: before.group_targets[0].id },
          data: { class_group: 'B' },
        }),
      ).rejects.toThrow();
      expect(await frozen(e.id)).toEqual(before);
    });

    it('does not accept forged labels through compatibility creation DTOs', async () => {
      const e = await prepared();
      // HTTP whitelist may strip this field; it must never override server labels.
      const result = await post('/api/evaluations', {
        ...e.input,
        confirmed_student_ids: e.body.confirmed_student_ids,
        historical_labels: { generation: { name: 'Forged' } },
      });
      expect([201, 400]).toContain(result.status);
      if (result.status === 201)
        expect(result.body.group_targets[0].historical_labels).toEqual(
          e.preview.body.target_labels.groups[0].historical_labels,
        );
      else
        expect(
          await prisma.evaluations.count({
            where: { course_offering_id: e.target.id },
          }),
        ).toBe(0);
    });

    it('keeps whole anonymous aggregates and rejects mixed or unknown generation/group query slices', async () => {
      const e = await confirmed(['A', 'B']);
      await post(`/api/evaluations/${e.id}/open`).expect(200);
      await app
        .get(SubmissionsService)
        .submit(e.id, e.own[0].account, answers(e.v1));
      await post(`/api/evaluations/${e.id}/close`).expect(200);
      const lecturerToken = await token(lecturer);
      const routes = [
        { path: '/api/admin/results', bearer: adminToken },
        { path: `/api/admin/results/${lecturer}`, bearer: adminToken },
        { path: '/api/lecturer/results', bearer: lecturerToken },
        {
          path: `/api/lecturer/evaluations/${e.id}/dashboard`,
          bearer: lecturerToken,
        },
        {
          path: `/api/lecturer/evaluations/${e.id}/comments`,
          bearer: lecturerToken,
        },
      ];
      for (const route of routes) {
        await api()
          .get(route.path)
          .set('Authorization', `Bearer ${route.bearer}`)
          .expect(200);
        for (const query of [
          `generation_id=${generation}`,
          'generation_id=999999999',
          'class_group=A',
          'group_scope=unknown',
        ]) {
          const rejected = await api()
            .get(`${route.path}?${query}`)
            .set('Authorization', `Bearer ${route.bearer}`);
          expect(rejected.status).toBe(400);
          expect(rejected.body.code).toBe('UNSUPPORTED_ANONYMOUS_SCOPE');
        }
      }
      expect((await frozen(e.id)).responses).toHaveLength(1);
    });

    it('a real concurrent rename and confirmation retain one coherent snapshot or roll back atomically', async () => {
      const e = await prepared();
      const gate = gateTransaction(
        prisma,
        'evaluation_generation_targets',
        'createMany',
      );
      const operation = new ReviewedWorkflowsService(gate.db).confirmCreate(
        e.body,
        admin,
      );
      const outcome = operation.then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      await gate.wait(outcome);
      const restore = await rename('generation');
      gate.release();
      try {
        const result = await outcome;
        if (result.error) {
          expect(result.error).toBeInstanceOf(ConflictException);
          expect(
            await prisma.evaluations.count({
              where: { course_offering_id: e.target.id },
            }),
          ).toBe(0);
          expect(
            (
              await prisma.reviewed_operations.findUniqueOrThrow({
                where: { id: e.body.review_id },
              })
            ).completed_at,
          ).toBeNull();
        } else {
          const rows = await frozen(BigInt(String(result.value!.id)));
          expect(rows.generation_targets[0].historical_labels).toEqual(
            e.preview.body.target_labels.generations[0].historical_labels,
          );
          expect(rows.group_targets[0].historical_labels).toEqual(
            e.preview.body.target_labels.groups[0].historical_labels,
          );
        }
      } finally {
        gate.release();
        await restore();
      }
    });
  });

  describe('Reviewed frontend operations', () => {
    const groupUrl = (o: bigint) => `/api/course-offerings/${o}/enrollments`;
    const applyUrl = (s: bigint, v: bigint) =>
      `/api/surveys/${s}/versions/${v}/apply-to-unfinished`;
    const post = (url: string, body: object = {}) =>
      api().post(url).set(authorization()).send(body);
    async function fixture(status: 'DRAFT' | 'OPEN' = 'OPEN', count = 3) {
      const assignment = await offering(['A', 'B']);
      const { set, v1 } = await survey();
      const ownStudents = [];
      for (let index = 0; index < count; index++)
        ownStudents.push(await student(index % 2 ? 'B' : 'A'));
      const now = new Date();
      await prisma.enrollments.createMany({
        data: ownStudents.map((s) => ({
          student_id: s.account,
          course_offering_id: assignment.id,
          enrolled_at: now,
        })),
      });
      const result = await prisma.evaluations.create({
        data: {
          course_offering_id: assignment.id,
          survey_version_id: v1.id,
          created_by: admin,
          status,
          start_at: new Date(Date.now() - 60_000),
          end_at: new Date(Date.now() + 86_400_000),
          created_at: now,
          updated_at: now,
          evaluation_participants: {
            create: ownStudents.map((s) => ({
              student_id: s.account,
              survey_version_id: v1.id,
              has_submitted: false,
              created_at: now,
            })),
          },
        },
        include: { evaluation_participants: true },
      });
      return { ...result, set, v1, assignment, ownStudents };
    }

    it('review rejects a placement change even when exact selected account IDs stay unchanged', async () => {
      const own = await student('A');
      const target = await offering(['A', 'B']);
      const input = selection(['A', 'B']);
      const preview = await post(`${groupUrl(target.id)}/preview`, input);
      expect(preview.status).toBe(200);
      await app
        .get(StudentAcademicRecordsService)
        .update(own.placement, { class_group: 'B' });
      const updatedPreview = await post(
        `${groupUrl(target.id)}/preview`,
        input,
      );
      expect(updatedPreview.body.confirmed_student_ids.sort()).toEqual(
        preview.body.confirmed_student_ids.sort(),
      );
      const confirm = await post(`${groupUrl(target.id)}/bulk`, {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      });
      expect(confirm.status).toBe(409);
      expect(confirm.body.code).toBe('REVIEW_STALE');
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.reviewed_operations.findUniqueOrThrow({
            where: { id: preview.body.review_id },
          })
        ).completed_at,
      ).toBeNull();
    });

    it('review ignores unrelated names/notes and retry cannot enroll newly eligible accounts', async () => {
      const own = await student('A');
      const target = await offering(['A']);
      const input = selection(['A']);
      const preview = await post(`${groupUrl(target.id)}/preview`, input);
      expect(preview.status).toBe(200);
      await prisma.users.update({
        where: { id: own.account },
        data: { full_name: 'Display name correction' },
      });
      await prisma.students.update({
        where: { id: own.profile },
        data: { notes: 'Unrelated administrative note' },
      });
      const body = {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      };
      const first = await post(`${groupUrl(target.id)}/bulk`, body);
      expect(first.status).toBe(201);
      expect(first.body.already_applied).toBe(false);
      const added = await student('A');
      await prisma.reviewed_operations.update({
        where: { id: preview.body.review_id },
        data: { expires_at: new Date(0) },
      });
      const retry = await post(`${groupUrl(target.id)}/bulk`, body);
      expect(retry.status).toBe(201);
      expect(retry.body.already_applied).toBe(true);
      expect(retry.body.enrolled_count).toBe(first.body.enrolled_count);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: target.id, student_id: added.account },
        }),
      ).toBe(0);
      const fresh = await post(`${groupUrl(target.id)}/preview`, input);
      const next = await post(`${groupUrl(target.id)}/bulk`, {
        ...input,
        confirmed_student_ids: fresh.body.confirmed_student_ids,
        review_id: fresh.body.review_id,
      });
      expect(next.status).toBe(201);
      expect(next.body.enrolled_count).toBe(1);
    });

    it('review checks expiry, caller, input and resource without partial enrollment writes', async () => {
      const target = await offering(['A']);
      const input = selection(['A']);
      const preview = await post(`${groupUrl(target.id)}/preview`, input);
      const body = {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      };
      const changed = await post(`${groupUrl(target.id)}/bulk`, {
        ...body,
        class_groups: ['B'],
      });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('REVIEW_INPUT_MISMATCH');
      const otherOffering = await offering(['A']);
      const wrongResource = await post(
        `${groupUrl(otherOffering.id)}/bulk`,
        body,
      );
      expect(wrongResource.status).toBe(409);
      expect(wrongResource.body.code).toBe('REVIEW_OPERATION_MISMATCH');
      const other = await account('ADMIN', 'other-review-admin');
      const login = await api()
        .post('/api/auth/login')
        .send({
          identifier: `other-review-admin-${stamp}@consistency.test`,
          password: 'Consistency123',
        });
      const wrongActor = await api()
        .post(`${groupUrl(target.id)}/bulk`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send(body);
      expect(wrongActor.status).toBe(404);
      expect(other).not.toBe(admin);
      await prisma.reviewed_operations.update({
        where: { id: preview.body.review_id },
        data: { expires_at: new Date(0) },
      });
      const expired = await post(`${groupUrl(target.id)}/bulk`, body);
      expect(expired.status).toBe(409);
      expect(expired.body.code).toBe('REVIEW_EXPIRED');
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: { in: [target.id, otherOffering.id] } },
        }),
      ).toBe(0);
    });

    it('reviewed creation binds questionnaire and scope, freezes all reviewed IDs and retries exactly once', async () => {
      const own = await student('A');
      const target = await offering(['A']);
      await prisma.enrollments.create({
        data: {
          student_id: own.account,
          course_offering_id: target.id,
          enrolled_at: new Date(),
        },
      });
      const { v1 } = await survey();
      const input = {
        course_offering_id: target.id.toString(),
        survey_version_id: v1.id.toString(),
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 86_400_000).toISOString(),
      };
      const preview = await post('/api/evaluations/create-preview', input);
      expect(preview.status).toBe(200);
      await app.get(QuestionsService).update(v1.questions[0].id, {
        question_text: 'Reviewed questionnaire changed',
      });
      const stale = await post('/api/evaluations', {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(0);
      const fresh = await post('/api/evaluations/create-preview', input);
      const body = {
        ...input,
        confirmed_student_ids: fresh.body.confirmed_student_ids,
        review_id: fresh.body.review_id,
      };
      const first = await post('/api/evaluations', body);
      expect(first.status).toBe(201);
      expect(
        await prisma.evaluation_participants.count({
          where: { evaluation_id: BigInt(first.body.id) },
        }),
      ).toBe(1);
      const retry = await post('/api/evaluations', body);
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.already_applied).toBe(true);
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(1);
    });

    it('reviewed creation rejects a newer version and direct set-only review without changing assignments', async () => {
      const e = await fixture('DRAFT');
      const v2 = await version(e.set.id, 2);
      const own = await student('A');
      const target = await offering(['A']);
      await prisma.enrollments.create({
        data: {
          student_id: own.account,
          course_offering_id: target.id,
          enrolled_at: new Date(),
        },
      });
      const input = {
        course_offering_id: target.id.toString(),
        survey_version_id: v2.id.toString(),
      };
      const preview = await post('/api/evaluations/create-preview', input);
      expect(preview.status).toBe(200);
      await version(e.set.id, 3);
      const stale = await post('/api/evaluations', {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      const setOnly = await post('/api/evaluations/create-preview', {
        course_offering_id: target.id.toString(),
        survey_id: e.set.id.toString(),
      });
      expect(setOnly.status).toBe(400);
      expect(
        await prisma.evaluations.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(0);
    });

    it('reviewed creation rejects malformed optional context and invalid schedules without 500 errors', async () => {
      const e = await fixture();
      const v2 = await version(e.set.id, 2);
      const input = {
        course_offering_id: e.assignment.id.toString(),
        survey_version_id: v2.id.toString(),
      };
      expect(
        (
          await post('/api/evaluations/create-preview', {
            ...input,
            survey_id: { invalid: true },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('/api/evaluations/create-preview', {
            ...input,
            generation_ids: { invalid: true },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('/api/evaluations/create-preview', {
            ...input,
            start_at: new Date(Date.now() + 172_800_000).toISOString(),
            end_at: new Date(Date.now() + 86_400_000).toISOString(),
          })
        ).status,
      ).toBe(400);
      expect(
        await prisma.evaluations.count({
          where: {
            course_offering_id: e.assignment.id,
            survey_version_id: v2.id,
          },
        }),
      ).toBe(0);
    });

    it('reviewed placement rejects drift and completed retry does not overwrite a later correction', async () => {
      const own = await student('A');
      const input = {
        academic_year_id: year.toString(),
        student_ids: [own.profile.toString()],
        class_group: 'B',
      };
      const url = '/api/students/bulk/class-group';
      const preview = await post(`${url}/preview`, input);
      expect(preview.status).toBe(200);
      await app
        .get(StudentAcademicRecordsService)
        .update(own.placement, { class_group: 'C' });
      const stale = await post(`${url}/confirm`, {
        ...input,
        review_id: preview.body.review_id,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      const fresh = await post(`${url}/preview`, input);
      const body = { ...input, review_id: fresh.body.review_id };
      const first = await post(`${url}/confirm`, body);
      expect(first.status).toBe(200);
      expect(first.body.updated_count).toBe(1);
      await app
        .get(StudentAcademicRecordsService)
        .update(own.placement, { class_group: 'C' });
      const retry = await post(`${url}/confirm`, body);
      expect(retry.status).toBe(200);
      expect(retry.body.already_applied).toBe(true);
      expect(
        (
          await prisma.student_academic_records.findUniqueOrThrow({
            where: { id: own.placement },
          })
        ).class_group,
      ).toBe('C');
      const missingReview = await post(`${url}/confirm`, input);
      expect(missingReview.status).toBe(400);
    });

    it('reviewed reassignment binds same-ID placement impact and retains frozen participants on successful retry', async () => {
      const e = await fixture('DRAFT', 1);
      const own = e.ownStudents[0];
      const target = await prisma.course_offerings.create({
        data: {
          course_id: e.assignment.course_id,
          lecturer_id: lecturer,
          semester_id: semester,
          year_level: 1,
          class_type: 'TD',
          section_code: 'reviewed target',
          created_at: new Date(),
          updated_at: new Date(),
          group_scopes: {
            create: ['A', 'B'].map((class_group) => ({
              academic_year_id: year,
              generation_id: generation,
              major_id: major,
              year_level: 1,
              class_group,
            })),
          },
        },
      });
      offeringIds.push(target.id);
      const url = `${groupUrl(e.assignment.id)}/reassignment`;
      const input = {
        student_id: own.account.toString(),
        target_offering_id: target.id.toString(),
      };
      const preview = await post(`${url}/preview`, input);
      expect(preview.status).toBe(200);
      await app
        .get(StudentAcademicRecordsService)
        .update(own.placement, { class_group: 'B' });
      const stale = await post(`${url}/confirm`, {
        ...input,
        confirmed_enrollment_id: preview.body.confirmed_enrollment_id,
        review_id: preview.body.review_id,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      const fresh = await post(`${url}/preview`, input);
      const body = {
        ...input,
        confirmed_enrollment_id: fresh.body.confirmed_enrollment_id,
        review_id: fresh.body.review_id,
      };
      const first = await post(`${url}/confirm`, body);
      expect(first.status).toBe(201);
      const retry = await post(`${url}/confirm`, body);
      expect(retry.status).toBe(201);
      expect(retry.body.already_applied).toBe(true);
      expect(
        await prisma.enrollments.count({
          where: { student_id: own.account, course_offering_id: target.id },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.evaluation_participants.findUniqueOrThrow({
            where: { id: e.evaluation_participants[0].id },
          })
        ).evaluation_id,
      ).toBe(e.id);
    });

    it('reviewed older-version opening is explicit and cannot reopen an evaluation on retry', async () => {
      const e = await fixture('DRAFT');
      await version(e.set.id, 2);
      const url = `/api/evaluations/${e.id}/open`;
      expect((await post(url, { force: true })).status).toBe(409);
      const preview = await post(`${url}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.assigned_survey_version_id).toBe(e.v1.id.toString());
      const body = {
        review_id: preview.body.review_id,
        decision: 'RETAIN_ASSIGNED_VERSION',
        retain_assigned_version_id: e.v1.id.toString(),
      };
      const first = await post(`${url}/confirm`, body);
      expect(first.status).toBe(200);
      expect(first.body.survey_version_id).toBe(e.v1.id.toString());
      const participants = await prisma.evaluation_participants.findMany({
        where: { evaluation_id: e.id },
        orderBy: { id: 'asc' },
      });
      expect(participants.map((p) => p.id)).toEqual(
        e.evaluation_participants.map((p) => p.id),
      );
      expect(participants.every((p) => p.survey_version_id === e.v1.id)).toBe(
        true,
      );
      await app.get(EvaluationsService).close(e.id);
      const retry = await post(`${url}/confirm`, body);
      expect(retry.status).toBe(200);
      expect(retry.body.already_applied).toBe(true);
      expect(
        (await prisma.evaluations.findUniqueOrThrow({ where: { id: e.id } }))
          .status,
      ).toBe('CLOSED');
    });

    it('opening review rejects latest-version drift and preserves archived-set continuity without new assignments', async () => {
      const e = await fixture('DRAFT');
      await version(e.set.id, 2);
      const url = `/api/evaluations/${e.id}/open`;
      const preview = await post(`${url}/preview`);
      expect(preview.status).toBe(200);
      await version(e.set.id, 3);
      const stale = await post(`${url}/confirm`, {
        review_id: preview.body.review_id,
        decision: 'RETAIN_ASSIGNED_VERSION',
        retain_assigned_version_id: e.v1.id.toString(),
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      expect(
        (await prisma.evaluations.findUniqueOrThrow({ where: { id: e.id } }))
          .status,
      ).toBe('DRAFT');
      await prisma.surveys.update({
        where: { id: e.set.id },
        data: { archived_at: new Date() },
      });
      const fresh = await post(`${url}/preview`);
      expect(fresh.status).toBe(200);
      const opened = await post(`${url}/confirm`, {
        review_id: fresh.body.review_id,
        decision: 'RETAIN_ASSIGNED_VERSION',
        retain_assigned_version_id: e.v1.id.toString(),
      });
      expect(opened.status).toBe(200);
      const target = await offering(['A']);
      const denied = await post('/api/evaluations/create-preview', {
        course_offering_id: target.id.toString(),
        survey_version_id: e.v1.id.toString(),
      });
      expect(denied.status).toBe(400);
    });

    it('reviewed version impact protects drafts/completions, returns stable retry and truthful mixed-version results', async () => {
      const e = await fixture();
      const v2 = await version(e.set.id, 2);
      const [draftOwner, submitter, safe] = e.ownStudents;
      await app
        .get(AssessmentDraftsService)
        .save(e.id, draftOwner.account, answers(e.v1));
      await app
        .get(SubmissionsService)
        .submit(e.id, submitter.account, answers(e.v1));
      const url = applyUrl(e.set.id, v2.id);
      const preview = await post(`${url}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.proposed_moved_participants).toBe(1);
      expect(preview.body.skipped_reasons).toEqual({
        submitted: 1,
        protected_draft: 1,
        already_on_target: 0,
      });
      expect(JSON.stringify(preview.body)).not.toMatch(
        /student_id|participant_id|response_id|answers|rating_value|password_hash/,
      );
      const body = { review_id: preview.body.review_id };
      const first = await post(`${url}/confirm`, body);
      expect(first.status).toBe(200);
      expect(first.body.moved_participants).toBe(1);
      await app.get(AssessmentDraftsService).remove(e.id, draftOwner.account);
      const retry = await post(`${url}/confirm`, body);
      expect(retry.status).toBe(200);
      expect(retry.body.already_applied).toBe(true);
      expect(retry.body.moved_participants).toBe(1);
      const protectedParticipant =
        await prisma.evaluation_participants.findUniqueOrThrow({
          where: {
            evaluation_id_student_id: {
              evaluation_id: e.id,
              student_id: draftOwner.account,
            },
          },
        });
      expect(protectedParticipant.survey_version_id).toBe(e.v1.id);
      expect(
        (await prisma.evaluations.findUniqueOrThrow({ where: { id: e.id } }))
          .survey_version_id,
      ).toBe(e.v1.id);
      await app.get(SubmissionsService).submit(e.id, safe.account, answers(v2));
      await app.get(EvaluationsService).close(e.id);
      const report = (
        await app.get(ResultsService).getLecturerResults(lecturer)
      ).evaluations.find((item) => item.evaluation.id === e.id)!;
      expect(report.submission_count).toBe(2);
      expect(report.version_results).toHaveLength(2);
      expect(JSON.stringify(report)).not.toMatch(
        /student_id|participant_id|response_id|password_hash/,
      );
    });

    it('reviewed application rejects new draft impact atomically and never falls back from empty latest', async () => {
      const e = await fixture();
      const v2 = await version(e.set.id, 2);
      const url = applyUrl(e.set.id, v2.id);
      const preview = await post(`${url}/preview`);
      expect(preview.status).toBe(200);
      await app
        .get(AssessmentDraftsService)
        .save(e.id, e.ownStudents[0].account, answers(e.v1));
      const stale = await post(`${url}/confirm`, {
        review_id: preview.body.review_id,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('REVIEW_STALE');
      expect(
        await prisma.evaluation_participants.count({
          where: { evaluation_id: e.id, survey_version_id: v2.id },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.survey_versions.findUniqueOrThrow({
            where: { id: v2.id },
          })
        ).status,
      ).toBe('DRAFT');
      const empty = await version(e.set.id, 3, false);
      expect(
        (await post(`${applyUrl(e.set.id, empty.id)}/preview`)).status,
      ).toBe(400);
      expect((await post(`${url}/preview`)).status).toBe(409);
    });

    it('reviewed opening cannot bypass expired dates, empty questions, archived versions or missing frozen participants', async () => {
      const e = await fixture('DRAFT');
      const url = `/api/evaluations/${e.id}/open`;
      const originalEnd = e.end_at;
      const originalStart = e.start_at;
      await expect(
        prisma.evaluations.update({
          where: { id: e.id },
          data: { start_at: new Date(Date.now() + 172_800_000) },
        }),
      ).rejects.toThrow('evaluations_date_order_check');
      await prisma.evaluations.update({
        where: { id: e.id },
        data: { start_at: null },
      });
      expect((await post(`${url}/preview`)).status).toBe(400);
      await prisma.evaluations.update({
        where: { id: e.id },
        data: { start_at: originalStart },
      });
      await prisma.evaluations.update({
        where: { id: e.id },
        data: { start_at: new Date(0), end_at: new Date(1) },
      });
      expect((await post(`${url}/preview`)).status).toBe(400);
      await prisma.evaluations.update({
        where: { id: e.id },
        data: { start_at: originalStart, end_at: originalEnd },
      });
      await prisma.survey_versions.update({
        where: { id: e.v1.id },
        data: { status: 'ARCHIVED' },
      });
      expect((await post(`${url}/preview`)).status).toBe(400);
      await prisma.survey_versions.update({
        where: { id: e.v1.id },
        data: { status: 'DRAFT' },
      });
      await prisma.questions.deleteMany({
        where: { survey_version_id: e.v1.id },
      });
      expect((await post(`${url}/preview`)).status).toBe(400);
      const other = await fixture('DRAFT');
      await prisma.evaluation_participants.deleteMany({
        where: { evaluation_id: other.id },
      });
      expect(
        (await post(`/api/evaluations/${other.id}/open/preview`)).status,
      ).toBe(400);
      expect(
        (await prisma.evaluations.findUniqueOrThrow({ where: { id: e.id } }))
          .status,
      ).toBe('DRAFT');
      expect(
        (
          await prisma.evaluations.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).status,
      ).toBe('DRAFT');
    });

    it('reviewed impact preserves legacy skipped reasons for a draft already on the target version', async () => {
      const e = await fixture();
      const v2 = await version(e.set.id, 2);
      const participant = e.evaluation_participants[0];
      await prisma.evaluation_participants.update({
        where: { id: participant.id },
        data: { survey_version_id: v2.id },
      });
      await app
        .get(AssessmentDraftsService)
        .save(e.id, e.ownStudents[0].account, answers(v2));
      const url = applyUrl(e.set.id, v2.id);
      const preview = await post(`${url}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.skipped_reasons).toEqual({
        submitted: 0,
        protected_draft: 0,
        already_on_target: 1,
      });
      const confirm = await post(`${url}/confirm`, {
        review_id: preview.body.review_id,
      });
      expect(confirm.status).toBe(200);
      expect(confirm.body.skipped_reasons).toEqual(
        preview.body.skipped_reasons,
      );
      expect(confirm.body.moved_participants).toBe(
        preview.body.proposed_moved_participants,
      );
    });

    it('cutover rejects all five unreviewed mutation routes and reviewed-only confirms cannot be bypassed', async () => {
      const e = await fixture('DRAFT');
      const v2 = await version(e.set.id, 2);
      const before = process.env.REQUIRE_REVIEWED_CONFIRMATION;
      process.env.REQUIRE_REVIEWED_CONFIRMATION = 'true';
      try {
        const requests = [
          post(`${groupUrl(e.assignment.id)}/bulk`, {
            ...selection(['A', 'B']),
            confirmed_student_ids: e.ownStudents.map((s) =>
              s.account.toString(),
            ),
          }),
          post('/api/evaluations', {
            course_offering_id: e.assignment.id.toString(),
            survey_version_id: v2.id.toString(),
          }),
          post(`${groupUrl(e.assignment.id)}/reassignment/confirm`, {
            student_id: e.ownStudents[0].account.toString(),
            target_offering_id: '1',
            confirmed_enrollment_id: '1',
          }),
          api()
            .put('/api/students/bulk/class-group')
            .set(authorization())
            .send({
              academic_year_id: year.toString(),
              student_ids: [e.ownStudents[0].profile.toString()],
              class_group: 'C',
            }),
          post(applyUrl(e.set.id, v2.id)),
        ];
        for (const response of await Promise.all(requests)) {
          expect(response.status).toBe(400);
          expect(response.body.code).toBe('REVIEW_REQUIRED');
        }
        expect(
          (await post(`${applyUrl(e.set.id, v2.id)}/confirm`)).status,
        ).toBe(400);
        expect(
          (
            await post(`/api/evaluations/${e.id}/open/confirm`, {
              decision: 'RETAIN_ASSIGNED_VERSION',
              retain_assigned_version_id: e.v1.id.toString(),
            })
          ).status,
        ).toBe(400);
        expect(
          await prisma.evaluation_participants.count({
            where: { evaluation_id: e.id, survey_version_id: v2.id },
          }),
        ).toBe(0);
      } finally {
        if (before === undefined)
          delete process.env.REQUIRE_REVIEWED_CONFIRMATION;
        else process.env.REQUIRE_REVIEWED_CONFIRMATION = before;
      }
    });

    it('reviewed endpoints enforce authentication and ADMIN authorization', async () => {
      const e = await fixture('DRAFT');
      const v2 = await version(e.set.id, 2);
      const studentLogin = await api()
        .post('/api/auth/login')
        .send({
          identifier: `student-${userIds.indexOf(e.ownStudents[0].account)}-${stamp}@consistency.test`,
          password: 'Consistency123',
        });
      // account() uses the array length before insertion, so the index is the fixture account name.
      expect(studentLogin.status).toBe(200);
      const routes = [
        '/api/evaluations/create-preview',
        '/api/students/bulk/class-group/preview',
        '/api/students/bulk/class-group/confirm',
        `/api/evaluations/${e.id}/open/preview`,
        `/api/evaluations/${e.id}/open/confirm`,
        `${applyUrl(e.set.id, v2.id)}/preview`,
        `${applyUrl(e.set.id, v2.id)}/confirm`,
      ];
      for (const route of routes) {
        expect((await api().post(route).send({})).status).toBe(401);
        expect(
          (
            await api()
              .post(route)
              .set('Authorization', `Bearer ${studentLogin.body.access_token}`)
              .send({})
          ).status,
        ).toBe(403);
      }
    });

    it('simultaneous confirmation of one review commits only once and remains retryable', async () => {
      const target = await offering(['A']);
      const input = selection(['A']);
      const preview = await post(`${groupUrl(target.id)}/preview`, input);
      expect(preview.status).toBe(200);
      const body = {
        ...input,
        confirmed_student_ids: preview.body.confirmed_student_ids,
        review_id: preview.body.review_id,
      };
      const results = await Promise.all([
        post(`${groupUrl(target.id)}/bulk`, body),
        post(`${groupUrl(target.id)}/bulk`, body),
      ]);
      expect(results.some((r) => r.status === 201)).toBe(true);
      expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(
        await prisma.enrollments.count({
          where: { course_offering_id: target.id },
        }),
      ).toBe(preview.body.new_enrollment_count);
      const retry = await post(`${groupUrl(target.id)}/bulk`, body);
      expect(retry.status).toBe(201);
      expect(retry.body.already_applied).toBe(true);
    });

    it('reviewed enrollment overlapping placement yields a consistent snapshot or atomic conflict', async () => {
      const own = await student('A');
      const target = await offering(['A', 'B']);
      const input = selection(['A', 'B']);
      const workflows = app.get(ReviewedWorkflowsService);
      const preview = await workflows.previewGroup(target.id, input, admin);
      const gate = gateTransaction(prisma, 'enrollments', 'createMany');
      const confirm = new ReviewedWorkflowsService(gate.db).confirmGroup(
        target.id,
        {
          ...input,
          confirmed_student_ids: preview.confirmed_student_ids as string[],
          review_id: preview.review_id,
        },
        admin,
      );
      await gate.wait(confirm);
      try {
        await app
          .get(StudentAcademicRecordsService)
          .update(own.placement, { class_group: 'B' });
      } finally {
        gate.release();
      }
      const result = await Promise.allSettled([confirm]);
      if (result[0].status === 'rejected') {
        expect(result[0].reason).toBeInstanceOf(ConflictException);
        expect(
          await prisma.enrollments.count({
            where: { course_offering_id: target.id },
          }),
        ).toBe(0);
        expect(
          (
            await prisma.reviewed_operations.findUniqueOrThrow({
              where: { id: preview.review_id },
            })
          ).completed_at,
        ).toBeNull();
      } else {
        expect(
          await prisma.enrollments.count({
            where: { course_offering_id: target.id },
          }),
        ).toBe(preview.new_enrollment_count);
        expect(
          (
            await prisma.reviewed_operations.findUniqueOrThrow({
              where: { id: preview.review_id },
            })
          ).completed_at,
        ).not.toBeNull();
      }
    });

    it('reviewed version confirmation overlapping draft save rolls back impact and receipt together', async () => {
      const e = await fixture();
      const v2 = await version(e.set.id, 2);
      const workflows = app.get(ReviewedWorkflowsService);
      const preview = await workflows.previewApplication(
        e.set.id,
        v2.id,
        admin,
      );
      const gate = gateTransaction(
        prisma,
        'evaluation_participants',
        'updateMany',
      );
      const confirm = new ReviewedWorkflowsService(gate.db).confirmApplication(
        e.set.id,
        v2.id,
        preview.review_id,
        admin,
      );
      await gate.wait(confirm);
      try {
        await app
          .get(AssessmentDraftsService)
          .save(e.id, e.ownStudents[0].account, answers(e.v1));
      } finally {
        gate.release();
      }
      const outcome = await Promise.allSettled([confirm]);
      expect(outcome[0].status).toBe('rejected');
      if (outcome[0].status === 'rejected')
        expect(outcome[0].reason).toBeInstanceOf(ConflictException);
      expect(
        await prisma.evaluation_participants.count({
          where: { evaluation_id: e.id, survey_version_id: v2.id },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.reviewed_operations.findUniqueOrThrow({
            where: { id: preview.review_id },
          })
        ).completed_at,
      ).toBeNull();
      expect(
        (
          await prisma.survey_versions.findUniqueOrThrow({
            where: { id: v2.id },
          })
        ).status,
      ).toBe('DRAFT');
    });
  });
});
