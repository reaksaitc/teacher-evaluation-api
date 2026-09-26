import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';

// Return the student with each enrollment, limited to safe fields (never password_hash)
const enrollmentInclude = {
  users: { select: { id: true, full_name: true, email: true } },
} satisfies Prisma.enrollmentsInclude;

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOffering(offeringId: bigint) {
    await this.checkOfferingExists(offeringId);
    return this.prisma.enrollments.findMany({
      where: { course_offering_id: offeringId },
      include: enrollmentInclude,
      orderBy: { id: 'asc' },
    });
  }

  async create(offeringId: bigint, dto: CreateEnrollmentDto) {
    await this.checkOfferingExists(offeringId);
    const studentId = BigInt(dto.student_id);

    // Business rule: only real STUDENT accounts can be enrolled
    const student = await this.prisma.users.findUnique({
      where: { id: studentId },
      select: { role: true },
    });
    if (!student || student.role !== 'STUDENT') {
      throw new BadRequestException('student_id must refer to a user with role STUDENT');
    }

    try {
      return await this.prisma.enrollments.create({
        data: {
          student_id: studentId,
          course_offering_id: offeringId,
          enrolled_at: new Date(),
        },
        include: enrollmentInclude,
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('Student is already enrolled in this course offering');
      }
      throw e;
    }
  }

  async remove(offeringId: bigint, studentId: bigint) {
    await this.checkOfferingExists(offeringId);

    const enrollment = await this.prisma.enrollments.findFirst({
      where: { course_offering_id: offeringId, student_id: studentId },
    });
    if (!enrollment) {
      throw new NotFoundException('Student is not enrolled in this course offering');
    }

    await this.prisma.enrollments.delete({ where: { id: enrollment.id } });
  }

  private async checkOfferingExists(offeringId: bigint) {
    const offering = await this.prisma.course_offerings.findUnique({
      where: { id: offeringId },
      select: { id: true },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
  }
}