import { AcademicYearSetupService } from './academic-year-setup.service';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import { calendarDate } from '../common/utils/calendar-date.util';
import { throwKnownDatabaseConstraint } from '../common/utils/database-constraint.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.academic_years.findMany({
      orderBy: { name: 'desc' },
    });
  }

  async findOne(id: bigint) {
    const academicYear = await this.prisma.academic_years.findUnique({
      where: { id },
    });

    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    return academicYear;
  }

  async create(dto: CreateAcademicYearDto, actorId?: bigint) {
    return new AcademicYearSetupService(this.prisma).setup(dto, actorId ?? 0n);
  }

  async update(id: bigint, dto: UpdateAcademicYearDto) {
    return inSerializableTransaction(
      this.prisma,
      (db) => new AcademicYearsService(db).updateInTransaction(id, dto),
      (e: any) => {
        throwKnownDatabaseConstraint(e);
        if (e.code === 'P2002') {
          throw new ConflictException('Academic year already exists');
        }

        throw e;
      },
    );
  }

  private async updateInTransaction(id: bigint, dto: UpdateAcademicYearDto) {
    const existing = await this.findOne(id);

    const startDate =
      dto.start_date !== undefined
        ? calendarDate(dto.start_date)
        : existing.start_date;

    const endDate =
      dto.end_date !== undefined
        ? calendarDate(dto.end_date)
        : existing.end_date;

    this.checkDateOrder(startDate, endDate);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // If this year becomes active, deactivate every other year
        if (dto.is_active === true) {
          await tx.academic_years.updateMany({
            where: {
              is_active: true,
              id: { not: id },
            },
            data: {
              is_active: false,
              updated_at: new Date(),
            },
          });
        }

        return tx.academic_years.update({
          where: { id },
          data: {
            name: dto.name,
            start_year: dto.start_year,
            start_date: startDate,
            end_date: endDate,
            is_active: dto.is_active,
            updated_at: new Date(),
          },
        });
      });
    } catch (e: any) {
      throwKnownDatabaseConstraint(e);
      if (
        e.code === 'P2004' ||
        (e instanceof Error &&
          e.message.includes(
            'Curriculum academic year start_year is protected',
          ))
      ) {
        throw new ConflictException(
          'Academic year start_year is protected by curriculum revisions or bound offerings',
        );
      }
      if (e.code === 'P2002') {
        throw new ConflictException('Academic year already exists');
      }

      throw e;
    }
  }

  async remove(id: bigint) {
    return inSerializableTransaction(
      this.prisma,
      (db) => new AcademicYearsService(db).removeInTransaction(id),
      (e: any) => {
        if (e.code === 'P2003') {
          throw new ConflictException(
            'Academic year is used by semesters and cannot be deleted',
          );
        }

        throw e;
      },
    );
  }

  private async removeInTransaction(id: bigint) {
    await this.findOne(id);

    try {
      await this.prisma.academic_years.delete({
        where: { id },
      });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new ConflictException(
          'Academic year is used by semesters and cannot be deleted',
        );
      }

      throw e;
    }
  }

  private checkDateOrder(start: Date | null, end: Date | null) {
    if (start && end && end <= start) {
      throw new BadRequestException('end_date must be after start_date');
    }
  }
}
