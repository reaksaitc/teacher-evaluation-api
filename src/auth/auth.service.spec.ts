import { backendCapabilities } from './backend-capabilities';
import { jest } from '@jest/globals';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

type TestUser = {
  id: bigint;
  email: string | null;
  password_hash: string;
  full_name: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  status: 'ACTIVE' | 'DISABLED';
  auth_version: number;
  created_at: Date;
  updated_at: Date;
};

type StudentWithUser = {
  users: TestUser;
};

type StudentIdResult = {
  id: bigint;
};

type AcademicYearResult = {
  id: bigint;
  name: string;
  start_year: number | null;
  is_active: boolean;
};

describe('AuthService', () => {
  let service: AuthService;

  const usersFindFirstMock =
    jest.fn<(...args: unknown[]) => Promise<TestUser | null>>();

  const usersFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<any>>();

  const usersUpdateManyMock =
    jest.fn<(...args: unknown[]) => Promise<{ count: number }>>();

  const studentsFindUniqueMock =
    jest.fn<
      (...args: unknown[]) => Promise<StudentWithUser | StudentIdResult | null>
    >();

  const academicYearsFindFirstMock =
    jest.fn<(...args: unknown[]) => Promise<AcademicYearResult | null>>();

  const studentsServiceFindOneMock =
    jest.fn<(...args: unknown[]) => Promise<any>>();

  const jwtSignAsyncMock = jest.fn<(...args: unknown[]) => Promise<string>>();

  const prismaMock = {
    users: {
      findFirst: usersFindFirstMock,
      findUnique: usersFindUniqueMock,
      updateMany: usersUpdateManyMock,
    },

    students: {
      findUnique: studentsFindUniqueMock,
    },

    academic_years: {
      findFirst: academicYearsFindFirstMock,
    },
  };

  const jwtMock = {
    signAsync: jwtSignAsyncMock,
  };

  const studentsServiceMock = {
    findOne: studentsServiceFindOneMock,
  };

  const password = 'Password123';

  let passwordHash: string;

  const adminUser: TestUser = {
    id: BigInt(1),
    email: 'admin@itc.edu.kh',
    password_hash: '',
    full_name: 'System Admin',
    gender: null,
    role: 'ADMIN',
    status: 'ACTIVE',
    auth_version: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const studentUser: TestUser = {
    id: BigInt(73),
    email: null,
    password_hash: '',
    full_name: 'Test Student',
    gender: 'FEMALE',
    role: 'STUDENT',
    status: 'ACTIVE',
    auth_version: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const activeAcademicYear: AcademicYearResult = {
    id: BigInt(5),
    name: '2026-2027',
    start_year: 2026,
    is_active: true,
  };

  const fallbackAcademicYear: AcademicYearResult = {
    id: BigInt(4),
    name: '2025-2026',
    start_year: 2025,
    is_active: false,
  };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 10);

    adminUser.password_hash = passwordHash;
    studentUser.password_hash = passwordHash;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    jwtSignAsyncMock.mockResolvedValue('test-access-token');

    /*
     * A successful compare-and-swap password update
     * changes exactly one database row.
     */
    usersUpdateManyMock.mockResolvedValue({
      count: 1,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: jwtMock,
        },
        {
          provide: StudentsService,
          useValue: studentsServiceMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should log in admin/staff using email', async () => {
      usersFindFirstMock.mockResolvedValue(adminUser);

      const result = await service.login({
        identifier: ' ADMIN@ITC.EDU.KH ',
        password,
      });

      expect(usersFindFirstMock).toHaveBeenCalledWith({
        where: {
          email: 'admin@itc.edu.kh',
        },
      });

      expect(studentsFindUniqueMock).not.toHaveBeenCalled();

      expect(jwtSignAsyncMock).toHaveBeenCalledWith({
        sub: '1',
        email: 'admin@itc.edu.kh',
        role: 'ADMIN',
        auth_version: 0,
      });

      expect(result).toEqual({
        access_token: 'test-access-token',
        user: {
          capabilities: backendCapabilities,
          id: '1',
          email: 'admin@itc.edu.kh',
          full_name: 'System Admin',
          gender: null,
          role: 'ADMIN',
        },
      });
    });

    it('should log in student using student code', async () => {
      studentsFindUniqueMock.mockResolvedValue({
        users: studentUser,
      });

      const result = await service.login({
        identifier: ' E20221111 ',
        password,
      });

      expect(studentsFindUniqueMock).toHaveBeenCalledWith({
        where: {
          student_code: 'e20221111',
        },
        select: {
          users: true,
        },
      });

      expect(usersFindFirstMock).not.toHaveBeenCalled();

      expect(jwtSignAsyncMock).toHaveBeenCalledWith({
        sub: '73',
        email: null,
        role: 'STUDENT',
        auth_version: 0,
      });

      expect(result).toEqual({
        access_token: 'test-access-token',
        user: {
          capabilities: backendCapabilities,
          id: '73',
          email: null,
          full_name: 'Test Student',
          gender: 'FEMALE',
          role: 'STUDENT',
        },
      });
    });

    it('should reject an unknown email', async () => {
      usersFindFirstMock.mockResolvedValue(null);

      await expect(
        service.login({
          identifier: 'unknown@itc.edu.kh',
          password,
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid identifier or password'),
      );

      expect(jwtSignAsyncMock).not.toHaveBeenCalled();
    });

    it('should reject an unknown student code', async () => {
      studentsFindUniqueMock.mockResolvedValue(null);

      await expect(
        service.login({
          identifier: 'e99999999',
          password,
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid identifier or password'),
      );

      expect(jwtSignAsyncMock).not.toHaveBeenCalled();
    });

    it('should reject an incorrect password', async () => {
      usersFindFirstMock.mockResolvedValue(adminUser);

      await expect(
        service.login({
          identifier: 'admin@itc.edu.kh',
          password: 'WrongPassword',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid identifier or password'),
      );

      expect(jwtSignAsyncMock).not.toHaveBeenCalled();
    });

    it('should reject an inactive account', async () => {
      const inactiveStudent: TestUser = {
        ...studentUser,
        status: 'DISABLED',
      };

      studentsFindUniqueMock.mockResolvedValue({
        users: inactiveStudent,
      });

      await expect(
        service.login({
          identifier: 'e20221111',
          password,
        }),
      ).rejects.toThrow(new ForbiddenException('Account is not active'));

      expect(jwtSignAsyncMock).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('should return staff profile with department assignments', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        email: 'admin@itc.edu.kh',
        full_name: 'System Admin',
        gender: null,
        role: 'ADMIN',
        status: 'ACTIVE',

        user_departments: [
          {
            is_primary: true,
            departments: {
              id: BigInt(2),
              code: 'AMS',
              name: 'Applied Mathematics & Statistics',
            },
          },
          {
            is_primary: false,
            departments: {
              id: BigInt(3),
              code: 'GIC',
              name: 'Information and Communication Engineering',
            },
          },
        ],
      });

      const result = await service.getMe(BigInt(1));

      expect(usersFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(1),
        },

        select: {
          id: true,
          email: true,
          full_name: true,
          gender: true,
          role: true,
          status: true,

          user_departments: {
            select: {
              is_primary: true,

              departments: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },

            orderBy: [
              {
                is_primary: 'desc',
              },
              {
                department_id: 'asc',
              },
            ],
          },
        },
      });

      expect(result).toEqual({
        id: BigInt(1),
        full_name: 'System Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        email: 'admin@itc.edu.kh',
        gender: null,

        user_departments: [
          {
            is_primary: true,
            department: {
              id: BigInt(2),
              code: 'AMS',
              name: 'Applied Mathematics & Statistics',
            },
          },
          {
            is_primary: false,
            department: {
              id: BigInt(3),
              code: 'GIC',
              name: 'Information and Communication Engineering',
            },
          },
        ],

        capabilities: backendCapabilities,
      });

      expect(studentsFindUniqueMock).not.toHaveBeenCalled();

      expect(academicYearsFindFirstMock).not.toHaveBeenCalled();

      expect(studentsServiceFindOneMock).not.toHaveBeenCalled();
    });

    it('should return student generation and effective placement for the newest active academic year', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock.mockResolvedValueOnce(activeAcademicYear);

      studentsServiceFindOneMock.mockResolvedValue({
        id: BigInt(1),
        user_id: BigInt(73),
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },

        academic_context: {
          academic_year: activeAcademicYear,

          effective_year_level: 3,

          year_level_source: 'EXPLICIT_ACADEMIC_RECORD',

          academic_record: {
            id: BigInt(20),
            year_level: 3,

            majors: {
              id: BigInt(1),
              code: 'AMS',
              name: 'Applied Mathematics & Statistics',
              department_id: BigInt(2),
            },
          },
        },
      });

      const result = await service.getMe(BigInt(73));

      expect(academicYearsFindFirstMock).toHaveBeenCalledTimes(1);

      expect(academicYearsFindFirstMock).toHaveBeenCalledWith({
        where: {
          is_active: true,
        },

        orderBy: [
          {
            start_year: 'desc',
          },
          {
            id: 'desc',
          },
        ],

        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      });

      expect(studentsServiceFindOneMock).toHaveBeenCalledWith(BigInt(1), '5');

      expect(result).toEqual({
        id: BigInt(73),
        full_name: 'Test Student',
        role: 'STUDENT',
        status: 'ACTIVE',
        email: null,
        gender: 'FEMALE',

        student: {
          academic_context: expect.objectContaining({
            effective_year_level: 3,
          }),
          student_code: 'e20221111',

          generation: {
            major_id: null,
            generation_number: null,
            major: null,
            id: BigInt(10),
            name: 'Generation 43',
          },

          effective_placement: {
            major: {
              id: BigInt(1),
              code: 'AMS',
              name: 'Applied Mathematics & Statistics',
            },

            year_level: 3,

            academic_year: {
              id: BigInt(5),
              name: '2026-2027',
            },
          },
        },

        profile_academic_year: {
          id: BigInt(5),
          name: '2026-2027',
        },

        capabilities: backendCapabilities,
      });
    });

    it('should request the newest active academic year using start_year descending', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock.mockResolvedValueOnce(activeAcademicYear);

      studentsServiceFindOneMock.mockResolvedValue({
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },

        academic_context: {
          academic_year: activeAcademicYear,
          effective_year_level: 3,
          academic_record: null,
        },
      });

      await service.getMe(BigInt(73));

      expect(academicYearsFindFirstMock).toHaveBeenCalledTimes(1);

      expect(academicYearsFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            is_active: true,
          },

          orderBy: [
            {
              start_year: 'desc',
            },
            {
              id: 'desc',
            },
          ],
        }),
      );
    });

    it('should fall back to the newest academic year when no academic year is active', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(fallbackAcademicYear);

      studentsServiceFindOneMock.mockResolvedValue({
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },

        academic_context: {
          academic_year: fallbackAcademicYear,

          effective_year_level: 2,

          year_level_source: 'EXPLICIT_ACADEMIC_RECORD',

          academic_record: {
            id: BigInt(20),
            year_level: 2,

            majors: {
              id: BigInt(1),
              code: 'AMS',
              name: 'Applied Mathematics & Statistics',
              department_id: BigInt(2),
            },
          },
        },
      });

      const result = await service.getMe(BigInt(73));

      expect(academicYearsFindFirstMock).toHaveBeenCalledTimes(2);

      expect(academicYearsFindFirstMock).toHaveBeenNthCalledWith(1, {
        where: {
          is_active: true,
        },

        orderBy: [
          {
            start_year: 'desc',
          },
          {
            id: 'desc',
          },
        ],

        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      });

      expect(academicYearsFindFirstMock).toHaveBeenNthCalledWith(2, {
        orderBy: [
          {
            start_year: 'desc',
          },
          {
            id: 'desc',
          },
        ],

        select: {
          id: true,
          name: true,
          start_year: true,
          is_active: true,
        },
      });

      expect(studentsServiceFindOneMock).toHaveBeenCalledWith(BigInt(1), '4');

      expect(result.profile_academic_year).toEqual({
        id: BigInt(4),
        name: '2025-2026',
      });

      expect(result.student?.effective_placement).toEqual({
        major: {
          id: BigInt(1),
          code: 'AMS',
          name: 'Applied Mathematics & Statistics',
        },

        year_level: 2,

        academic_year: {
          id: BigInt(4),
          name: '2025-2026',
        },
      });
    });

    it('should keep major null when effective year level comes only from generation calculation', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock.mockResolvedValueOnce(activeAcademicYear);

      studentsServiceFindOneMock.mockResolvedValue({
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },

        academic_context: {
          academic_year: activeAcademicYear,

          effective_year_level: 3,

          year_level_source: 'GENERATION_CALCULATION',

          academic_record: null,
        },
      });

      const result = await service.getMe(BigInt(73));

      expect(result.student?.effective_placement).toEqual({
        major: null,
        year_level: 3,

        academic_year: {
          id: BigInt(5),
          name: '2026-2027',
        },
      });
    });

    it('should safely return unavailable placement when there are no academic years', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      studentsServiceFindOneMock.mockResolvedValue({
        id: BigInt(1),
        user_id: BigInt(73),
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },
      });

      const result = await service.getMe(BigInt(73));

      expect(academicYearsFindFirstMock).toHaveBeenCalledTimes(2);

      expect(studentsServiceFindOneMock).toHaveBeenCalledWith(BigInt(1));

      expect(result).toEqual({
        id: BigInt(73),
        full_name: 'Test Student',
        role: 'STUDENT',
        status: 'ACTIVE',
        email: null,
        gender: 'FEMALE',

        student: {
          student_code: 'e20221111',

          generation: {
            id: BigInt(10),
            name: 'Generation 43',
          },

          effective_placement: {
            major: null,
            year_level: null,
            academic_year: null,
          },
        },

        profile_academic_year: null,

        capabilities: backendCapabilities,
      });
    });

    it('should safely return null student when STUDENT user has no linked student record', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue(null);

      const result = await service.getMe(BigInt(73));

      expect(result).toEqual({
        id: BigInt(73),
        full_name: 'Test Student',
        role: 'STUDENT',
        status: 'ACTIVE',
        email: null,
        gender: 'FEMALE',

        student: null,

        profile_academic_year: null,

        capabilities: backendCapabilities,
      });

      expect(academicYearsFindFirstMock).not.toHaveBeenCalled();

      expect(studentsServiceFindOneMock).not.toHaveBeenCalled();
    });

    it('should return a safe fallback if StudentsService does not provide academic_context', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: studentUser.id,
        email: studentUser.email,
        full_name: studentUser.full_name,
        gender: studentUser.gender,
        role: studentUser.role,
        status: studentUser.status,
        user_departments: [],
      });

      studentsFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
      });

      academicYearsFindFirstMock.mockResolvedValueOnce(activeAcademicYear);

      studentsServiceFindOneMock.mockResolvedValue({
        student_code: 'e20221111',

        student_generations: {
          id: BigInt(10),
          name: 'Generation 43',
        },
      });

      const result = await service.getMe(BigInt(73));

      expect(result).toEqual({
        id: BigInt(73),
        full_name: 'Test Student',
        role: 'STUDENT',
        status: 'ACTIVE',
        email: null,
        gender: 'FEMALE',

        student: {
          student_code: 'e20221111',

          generation: {
            id: BigInt(10),
            name: 'Generation 43',
          },

          effective_placement: {
            major: null,
            year_level: null,

            academic_year: {
              id: BigInt(5),
              name: '2026-2027',
            },
          },
        },

        profile_academic_year: {
          id: BigInt(5),
          name: '2026-2027',
        },

        capabilities: backendCapabilities,
      });
    });

    it('should throw NotFoundException when authenticated user no longer exists', async () => {
      usersFindUniqueMock.mockResolvedValue(null);

      await expect(service.getMe(BigInt(999))).rejects.toThrow(
        new NotFoundException('User not found'),
      );

      expect(studentsFindUniqueMock).not.toHaveBeenCalled();

      expect(academicYearsFindFirstMock).not.toHaveBeenCalled();

      expect(studentsServiceFindOneMock).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should atomically change the password and increment auth_version', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'ACTIVE',
        auth_version: 3,
      });

      usersUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await service.changePassword(BigInt(1), {
        current_password: password,
        new_password: 'NewPassword456',
      });

      expect(usersFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(1),
        },

        select: {
          id: true,
          password_hash: true,
          status: true,
          auth_version: true,
        },
      });

      expect(usersUpdateManyMock).toHaveBeenCalledTimes(1);

      const updateArgument = usersUpdateManyMock.mock.calls[0][0] as {
        where: {
          id: bigint;
          status: string;
          password_hash: string;
          auth_version: number;
        };

        data: {
          password_hash: string;

          auth_version: {
            increment: number;
          };
        };
      };

      /*
       * These conditions are the compare-and-swap
       * protection. The write succeeds only while the
       * credential state is still the state we verified.
       */
      expect(updateArgument.where).toEqual({
        id: BigInt(1),
        status: 'ACTIVE',
        password_hash: passwordHash,
        auth_version: 3,
      });

      expect(updateArgument.data.auth_version).toEqual({
        increment: 1,
      });

      expect(updateArgument.data.password_hash).not.toBe(passwordHash);

      expect(
        await bcrypt.compare(
          'NewPassword456',
          updateArgument.data.password_hash,
        ),
      ).toBe(true);

      expect(result).toEqual({
        message: 'Password changed successfully. Please sign in again.',
      });
    });

    it('should reject stale credential proof when the atomic update changes zero rows', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'ACTIVE',
        auth_version: 3,
      });

      /*
       * count: 0 simulates another password change/reset
       * winning before this request reaches the database
       * update.
       */
      usersUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.changePassword(BigInt(1), {
          current_password: password,
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Credentials changed. Please sign in again.'),
      );

      expect(usersUpdateManyMock).toHaveBeenCalledTimes(1);

      const updateArgument = usersUpdateManyMock.mock.calls[0][0] as {
        where: {
          id: bigint;
          status: string;
          password_hash: string;
          auth_version: number;
        };
      };

      expect(updateArgument.where).toEqual({
        id: BigInt(1),
        status: 'ACTIVE',
        password_hash: passwordHash,
        auth_version: 3,
      });
    });

    it('should reject an incorrect current password', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'ACTIVE',
        auth_version: 0,
      });

      await expect(
        service.changePassword(BigInt(1), {
          current_password: 'WrongPassword',
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow(
        new BadRequestException('Current password is incorrect'),
      );

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });

    it('should reject reusing the current password', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'ACTIVE',
        auth_version: 0,
      });

      await expect(
        service.changePassword(BigInt(1), {
          current_password: password,
          new_password: password,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'New password must be different from the current password',
        ),
      );

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });

    it('should reject a new password exceeding 72 UTF-8 bytes', async () => {
      /*
       * 😀 uses 4 UTF-8 bytes.
       * 19 × 4 = 76 bytes, which exceeds bcrypt's
       * 72-byte safe limit.
       */
      const tooLongPassword = '😀'.repeat(19);

      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'ACTIVE',
        auth_version: 0,
      });

      await expect(
        service.changePassword(BigInt(1), {
          current_password: password,
          new_password: tooLongPassword,
        }),
      ).rejects.toThrow(
        new BadRequestException('Password must not exceed 72 UTF-8 bytes'),
      );

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });

    it('should reject a current password exceeding 72 UTF-8 bytes before querying the user', async () => {
      const tooLongPassword = '😀'.repeat(19);

      await expect(
        service.changePassword(BigInt(1), {
          current_password: tooLongPassword,
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow(
        new BadRequestException('Password must not exceed 72 UTF-8 bytes'),
      );

      expect(usersFindUniqueMock).not.toHaveBeenCalled();

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });

    it('should reject an inactive account', async () => {
      usersFindUniqueMock.mockResolvedValue({
        id: BigInt(1),
        password_hash: passwordHash,
        status: 'DISABLED',
        auth_version: 0,
      });

      await expect(
        service.changePassword(BigInt(1), {
          current_password: password,
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow(new ForbiddenException('Account is not active'));

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });

    it('should reject a missing user', async () => {
      usersFindUniqueMock.mockResolvedValue(null);

      await expect(
        service.changePassword(BigInt(999), {
          current_password: password,
          new_password: 'NewPassword456',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersUpdateManyMock).not.toHaveBeenCalled();
    });
  });
});
