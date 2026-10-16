// Validate and load the test database configuration first.
require('./run-e2e.cjs');

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

async function main() {
  const passwordHash = await bcrypt.hash('Password123', 10);

  await prisma.$transaction(async (tx) => {
    const department = await tx.departments.upsert({
      where: { code: 'AMS' },
      update: { status: 'ACTIVE' },
      create: {
        code: 'AMS',
        name: 'Applied Mathematics and Statistics',
        status: 'ACTIVE',
      },
    });

    const fixtures = [
      {
        email: 'admin@itc.edu.kh',
        full_name: 'E2E Admin',
        role: 'ADMIN',
      },
      {
        email: 'sokdara@itc.edu.kh',
        full_name: 'E2E Lecturer',
        role: 'LECTURER',
      },
      {
        email: 'chanthy@itc.edu.kh',
        full_name: 'E2E Lecturer Two',
        role: 'LECTURER',
      },
      {
        email: 'student1@itc.edu.kh',
        full_name: 'E2E Student',
        role: 'STUDENT',
      },
      {
        email: 'student2@itc.edu.kh',
        full_name: 'E2E Student Two',
        role: 'STUDENT',
      },
      {
        email: 'student3@itc.edu.kh',
        full_name: 'E2E Student Three',
        role: 'STUDENT',
      },
    ];

    const academicYear = await tx.academic_years.upsert({
      where: { name: 'E2E BASE 2026' },
      update: {},
      create: { name: 'E2E BASE 2026', start_year: 2026, is_active: false },
    });
    const major = await tx.majors.upsert({
      where: { code: 'E2E-BASE' },
      update: {},
      create: {
        code: 'E2E-BASE',
        name: 'E2E Base Major',
        department_id: department.id,
      },
    });
    const generation = await tx.student_generations.upsert({
      where: {
        major_id_generation_number: {
          major_id: major.id,
          generation_number: 1,
        },
      },
      update: {},
      create: {
        major_id: major.id,
        generation_number: 1,
        name: 'Gen 1',
        entry_academic_year_id: academicYear.id,
      },
    });
    const accounts = new Map();

    for (const fixture of fixtures) {
      const now = new Date();
      const data = {
        ...fixture,
        password_hash: passwordHash,
        status: 'ACTIVE',
        updated_at: now,
      };

      const user = await tx.users.upsert({
        where: { email: fixture.email },
        update: data,
        create: {
          ...data,
          created_at: now,
        },
      });
      accounts.set(fixture.email, user);

      if (fixture.role === 'ADMIN') {
        // This synthetic installation administrator has global setup scope.
        await tx.user_departments.deleteMany({ where: { user_id: user.id } });
      } else if (fixture.role !== 'STUDENT') {
        await tx.user_departments.upsert({
          where: {
            user_id_department_id: {
              user_id: user.id,
              department_id: department.id,
            },
          },
          update: { is_primary: true },
          create: {
            user_id: user.id,
            department_id: department.id,
            is_primary: true,
          },
        });
      } else {
        const profile = await tx.students.upsert({
          where: { user_id: user.id },
          update: {},
          create: {
            user_id: user.id,
            student_code: `e2e-base-${fixture.email.split('@')[0]}`,
            generation_id: generation.id,
          },
        });
        await tx.student_academic_records.upsert({
          where: {
            student_id_academic_year_id: {
              student_id: profile.id,
              academic_year_id: academicYear.id,
            },
          },
          update: {},
          create: {
            student_id: profile.id,
            academic_year_id: academicYear.id,
            year_level: 1,
            major_id: major.id,
            class_group: 'A',
          },
        });
      }
    }
    const now = new Date();
    const semester = await tx.semesters.upsert({
      where: {
        academic_year_id_semester_name: {
          academic_year_id: academicYear.id,
          semester_name: 'E2E BASE',
        },
      },
      update: {},
      create: {
        academic_year_id: academicYear.id,
        semester_name: 'E2E BASE',
        semester_number: 1,
        created_at: now,
        updated_at: now,
      },
    });
    const offerings = [];
    for (const [index, email] of [
      'sokdara@itc.edu.kh',
      'chanthy@itc.edu.kh',
    ].entries()) {
      const course = await tx.courses.upsert({
        where: { course_code: `E2E-BASE-${index + 1}` },
        update: {},
        create: {
          course_code: `E2E-BASE-${index + 1}`,
          course_name: `E2E Base Course ${index + 1}`,
          department_id: department.id,
          created_at: now,
          updated_at: now,
        },
      });
      let offering = await tx.course_offerings.findFirst({
        where: {
          course_id: course.id,
          lecturer_id: accounts.get(email).id,
          semester_id: semester.id,
          section_code: 'E2E BASE',
        },
      });
      if (!offering)
        offering = await tx.course_offerings.create({
          data: {
            course_id: course.id,
            lecturer_id: accounts.get(email).id,
            semester_id: semester.id,
            class_type: 'COURSE',
            section_code: 'E2E BASE',
            created_at: now,
            updated_at: now,
          },
        });
      offerings.push(offering);
      for (const fixture of fixtures.filter((f) => f.role === 'STUDENT')) {
        const studentId = accounts.get(fixture.email).id;
        await tx.enrollments.upsert({
          where: {
            student_id_course_offering_id: {
              student_id: studentId,
              course_offering_id: offering.id,
            },
          },
          update: {},
          create: {
            student_id: studentId,
            course_offering_id: offering.id,
            enrolled_at: now,
          },
        });
      }
    }
    const adminId = accounts.get('admin@itc.edu.kh').id;
    let set = await tx.surveys.findFirst({
      where: { title: 'E2E BASE PROTECTED' },
    });
    if (!set)
      set = await tx.surveys.create({
        data: {
          title: 'E2E BASE PROTECTED',
          created_by: adminId,
          created_at: now,
          updated_at: now,
        },
      });
    const version = await tx.survey_versions.upsert({
      where: { survey_id_version_no: { survey_id: set.id, version_no: 1 } },
      update: {},
      create: {
        survey_id: set.id,
        version_no: 1,
        status: 'LOCKED',
        locked_at: now,
        created_by: adminId,
        created_at: now,
        questions: {
          create: {
            question_type: 'RATING',
            question_text: 'E2E protected question',
            min_rating: 1,
            max_rating: 5,
            display_order: 1,
            created_at: now,
            updated_at: now,
          },
        },
      },
    });
    await tx.evaluations.upsert({
      where: {
        course_offering_id_survey_version_id: {
          course_offering_id: offerings[0].id,
          survey_version_id: version.id,
        },
      },
      update: {},
      create: {
        course_offering_id: offerings[0].id,
        survey_version_id: version.id,
        status: 'CLOSED',
        created_by: adminId,
        created_at: now,
        updated_at: now,
      },
    });
  });

  console.log('Isolated synthetic school E2E fixtures ready.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
