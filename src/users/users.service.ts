import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// Same cost factor the seed script used
const BCRYPT_ROUNDS = 10;

// Every column except password_hash — used for every response from this service
const safeUserSelect = {
  id: true,
  email: true,
  full_name: true,
  role: true,
  status: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.usersSelect;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll(query: ListUsersQueryDto) {
    return this.prisma.users.findMany({
      where: { role: query.role, status: query.status },
      select: safeUserSelect,
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: bigint) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      select: safeUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const now = new Date();

    try {
      return await this.prisma.users.create({
        data: {
          email: normalizeEmail(dto.email),
          password_hash: passwordHash,
          full_name: dto.full_name,
          role: dto.role,
          created_at: now,
          updated_at: now,
        },
        select: safeUserSelect,
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email is already in use');
      throw e;
    }
  }

  async update(id: bigint, dto: UpdateUserDto, currentUserId: bigint) {
    await this.findOne(id);

    // Safety rule: an Admin must not lock themselves out
    if (dto.status === 'INACTIVE' && id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS) : undefined;

    try {
      return await this.prisma.users.update({
        where: { id },
        data: {
          email: dto.email ? normalizeEmail(dto.email) : undefined,
          full_name: dto.full_name,
          status: dto.status,
          password_hash: passwordHash,
          updated_at: new Date(),
        },
        select: safeUserSelect,
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email is already in use');
      throw e;
    }
  }
}