import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourseOfferingGroupScopeDto } from './dto/course-offering-group-scope.dto';
import { assertCohortMajor } from '../student-generations/generation-identity.util';

export async function requireCurriculumApproval(
  db: PrismaService,
  courseId: bigint,
  semesterId: bigint,
  yearLevel: number | null | undefined,
  scopes: CourseOfferingGroupScopeDto[] = [],
) {
  if (!Number.isInteger(yearLevel) || yearLevel! < 1 || yearLevel! > 5)
    throw new BadRequestException({
      code: 'COURSE_YEAR_REQUIRED',
      message: 'Choose an approved course student year from 1 to 5',
    });
  const [course, semester] = await Promise.all([
    db.courses.findUnique({
      where: { id: courseId },
      include: { departments: true },
    }),
    db.semesters.findUnique({
      where: { id: semesterId },
      include: { academic_years: true },
    }),
  ]);
  if (!course || !semester)
    throw new NotFoundException('Course or semester not found');
  if (course.departments.status !== 'ACTIVE')
    throw new BadRequestException('Course department is inactive');
  const startYear = semester.academic_years.start_year;
  if (startYear === null)
    throw new BadRequestException({
      code: 'ACADEMIC_CHRONOLOGY_REQUIRED',
      message:
        'Configure the semester academic year start_year before assigning courses',
    });
  const rules = await db.course_year_rules.findMany({
    where: { course_id: courseId, year_level: yearLevel! },
    include: {
      majors: true,
      revisions: {
        where: { effective_start_year: { lte: startYear } },
        orderBy: { effective_start_year: 'desc' },
      },
    },
  });
  const approved = rules.filter(
    (r) =>
      r.majors.department_id === course.department_id &&
      r.revisions[0]?.enabled,
  );
  if (!approved.length)
    throw new ConflictException({
      code: 'CURRICULUM_APPROVAL_REQUIRED',
      message:
        'No enabled curriculum revision approves this course/year in the selected academic year',
    });
  for (const scope of scopes) {
    if (
      BigInt(scope.academic_year_id) !== semester.academic_year_id ||
      scope.year_level !== yearLevel
    )
      throw new BadRequestException(
        'Every audience scope must match the semester academic year and course student year',
      );
    if (!approved.some((rule) => rule.major_id === BigInt(scope.major_id)))
      throw new ConflictException({
        code: 'CURRICULUM_APPROVAL_REQUIRED',
        message: 'A selected major/year lacks applicable approval',
      });
    const cohort = await db.student_generations.findUnique({
      where: { id: BigInt(scope.generation_id) },
    });
    if (!cohort) throw new NotFoundException('Generation not found');
    assertCohortMajor(cohort, BigInt(scope.major_id));
  }
  return { course, semester, approved };
}
