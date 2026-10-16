import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Administrators without department memberships administer the installation. */
export async function assertDepartmentScope(
  db: PrismaService,
  actorId: bigint,
  departmentId?: bigint,
) {
  const actor = await db.users.findUnique({
    where: { id: actorId },
    select: { role: true, status: true },
  });
  if (!actor || actor.status !== 'ACTIVE') throw new UnauthorizedException();
  if (actor.role !== 'ADMIN')
    throw new ForbiddenException('Administrator access is required');
  const memberships = await db.user_departments.findMany({
    where: { user_id: actorId },
    select: { department_id: true },
  });
  if (
    departmentId !== undefined &&
    memberships.length &&
    !memberships.some((m) => m.department_id === departmentId)
  )
    throw new ForbiddenException(
      'This department is outside your administrator scope',
    );
  return memberships.map((m) => m.department_id);
}
