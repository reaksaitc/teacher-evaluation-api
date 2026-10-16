import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Each test evaluation needs its own actual assignment under the one-per-assignment rule. */
export async function isolatedEvaluationOffering(
  prisma: PrismaService,
  originalId: string,
  owned: bigint[],
) {
  return prisma.$transaction(async (db) => {
    const source = await db.course_offerings.findUniqueOrThrow({
      where: { id: BigInt(originalId) },
      include: { semesters: true, enrollments: true, group_scopes: true },
    });
    const semester = await db.semesters.create({
      data: {
        academic_year_id: source.semesters.academic_year_id,
        semester_name: `E2E isolated ${randomUUID().slice(0, 8)}`,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    const offering = await db.course_offerings.create({
      data: {
        course_id: source.course_id,
        lecturer_id: source.lecturer_id,
        semester_id: semester.id,
        class_type: source.class_type,
        year_level: source.year_level,
        section_code: source.section_code,
        created_at: new Date(),
        updated_at: new Date(),
        group_scopes: {
          create: source.group_scopes.map((s) => ({
            academic_year_id: s.academic_year_id,
            generation_id: s.generation_id,
            major_id: s.major_id,
            year_level: s.year_level,
            class_group: s.class_group,
            curriculum_revision_id: s.curriculum_revision_id,
          })),
        },
        enrollments: {
          create: source.enrollments.map((e) => ({
            student_id: e.student_id,
            enrolled_at: new Date(),
          })),
        },
      },
    });
    owned.push(offering.id);
    return String(offering.id);
  });
}
export async function releaseIsolatedOfferings(
  db: PrismaService,
  ids: bigint[],
) {
  const rows = await db.course_offerings.findMany({
    where: { id: { in: ids } },
    select: { id: true, semester_id: true },
  });
  await db.enrollments.deleteMany({
    where: { course_offering_id: { in: ids } },
  });
  await db.course_offering_group_scopes.deleteMany({
    where: { course_offering_id: { in: ids } },
  });
  await db.course_offerings.deleteMany({ where: { id: { in: ids } } });
  await db.semesters.deleteMany({
    where: { id: { in: rows.map((r) => r.semester_id) } },
  });
}
