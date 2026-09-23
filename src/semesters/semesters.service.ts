import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Injectable()
export class SemestersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.semesters.findMany({ orderBy: { id: 'asc' } });
  }

  async findOne(id: bigint) {
    const semester = await this.prisma.semesters.findUnique({ where: { id } });
    if (!semester) throw new NotFoundException('Semester not found');
    return semester;
  }

  async create(dto: CreateSemesterDto) {
    const startDate = dto.start_date ? new Date(dto.start_date) : null;
    const endDate = dto.end_date ? new Date(dto.end_date) : null;
    this.checkDateOrder(startDate, endDate);

    const now = new Date();
    try {
      return await this.prisma.semesters.create({
        data: {
          semester_name: dto.semester_name,
          academic_year: dto.academic_year,
          start_date: startDate,
          end_date: endDate,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('This semester already exists for that academic year');
      }
      throw e;
    }
  }

  async update(id: bigint, dto: UpdateSemesterDto) {
    const existing = await this.findOne(id);

    // If a date isn't sent, keep the one already saved, then check the final pair
    const startDate = dto.start_date !== undefined ? new Date(dto.start_date) : existing.start_date;
    const endDate = dto.end_date !== undefined ? new Date(dto.end_date) : existing.end_date;
    this.checkDateOrder(startDate, endDate);

    try {
      return await this.prisma.semesters.update({
        where: { id },
        data: {
          semester_name: dto.semester_name,
          academic_year: dto.academic_year,
          start_date: startDate,
          end_date: endDate,
          updated_at: new Date(),
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('This semester already exists for that academic year');
      }
      throw e;
    }
  }

  async remove(id: bigint) {
    await this.findOne(id);
    try {
      await this.prisma.semesters.delete({ where: { id } });
    } catch (e: any) {
      if (e.code === 'P2003') {
        throw new ConflictException('Semester is used by course offerings and cannot be deleted');
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