import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { SemestersService } from './semesters.service';

describe('SemestersService', () => {
  let service: SemestersService;

  const semesterFindManyMock = jest.fn<(args: any) => Promise<any>>();

  const semesterFindUniqueMock = jest.fn<(args: any) => Promise<any>>();

  const semesterCreateMock = jest.fn<(args: any) => Promise<any>>();

  const semesterUpdateMock = jest.fn<(args: any) => Promise<any>>();

  const semesterDeleteMock = jest.fn<(args: any) => Promise<any>>();

  const academicYearFindUniqueMock = jest.fn<(args: any) => Promise<any>>();

  const prismaMock = {
    semesters: {
      findMany: semesterFindManyMock,
      findUnique: semesterFindUniqueMock,
      create: semesterCreateMock,
      update: semesterUpdateMock,
      delete: semesterDeleteMock,
    },
    academic_years: {
      findUnique: academicYearFindUniqueMock,
    },
    evaluations: {
      count: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (callback: (db: any) => Promise<any>) =>
      callback(prismaMock),
    ),
  };

  const academicYear = {
    id: 1n,
    name: '2026-2027',
    start_year: 2026,
    start_date: new Date('2026-10-01'),
    end_date: new Date('2027-09-30'),
    is_active: true,
  };

  const semester = {
    id: 10n,
    semester_name: 'Semester 1',
    semester_number: 1,
    academic_year_id: 1n,
    start_date: new Date('2026-10-01'),
    end_date: new Date('2027-02-28'),
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    updated_at: new Date('2026-10-01T00:00:00.000Z'),
    academic_years: academicYear,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SemestersService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = moduleRef.get(SemestersService);
  });

  it('returns all semesters with academic-year metadata', async () => {
    semesterFindManyMock.mockResolvedValue([semester]);

    const result = await service.findAll();

    expect(result).toEqual([semester]);

    expect(semesterFindManyMock).toHaveBeenCalledWith({
      include: {
        academic_years: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
  });

  it('returns one semester', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    const result = await service.findOne(10n);

    expect(result).toEqual(semester);

    expect(semesterFindUniqueMock).toHaveBeenCalledWith({
      where: {
        id: 10n,
      },
      include: {
        academic_years: true,
      },
    });
  });

  it('throws when semester does not exist', async () => {
    semesterFindUniqueMock.mockResolvedValue(null);

    await expect(service.findOne(999n)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a semester with an explicit semester number', async () => {
    academicYearFindUniqueMock.mockResolvedValue(academicYear);
    semesterCreateMock.mockResolvedValue(semester);

    const result = await service.create({
      semester_name: 'Semester 1',
      semester_number: 1,
      academic_year_id: 1,
      start_date: '2026-10-01',
      end_date: '2027-02-28',
    });

    expect(result).toEqual(semester);

    expect(academicYearFindUniqueMock).toHaveBeenCalledWith({
      where: {
        id: 1n,
      },
    });

    expect(semesterCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          semester_name: 'Semester 1',
          semester_number: 1,
          academic_year_id: 1n,
        }),
        include: {
          academic_years: true,
        },
      }),
    );
  });

  it('rejects creation when the academic year does not exist', async () => {
    academicYearFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.create({
        semester_name: 'Semester 1',
        semester_number: 1,
        academic_year_id: 999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(semesterCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid date order during creation', async () => {
    await expect(
      service.create({
        semester_name: 'Semester 1',
        semester_number: 1,
        academic_year_id: 1,
        start_date: '2027-03-01',
        end_date: '2027-02-28',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(academicYearFindUniqueMock).not.toHaveBeenCalled();

    expect(semesterCreateMock).not.toHaveBeenCalled();
  });

  it('returns a conflict for duplicate semester name or number', async () => {
    academicYearFindUniqueMock.mockResolvedValue(academicYear);

    semesterCreateMock.mockRejectedValue({
      code: 'P2002',
    });

    await expect(
      service.create({
        semester_name: 'Semester 1',
        semester_number: 1,
        academic_year_id: 1,
      }),
    ).rejects.toThrow(
      'Semester name or semester number already exists for this academic year',
    );
  });

  it('updates the semester number', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    const updatedSemester = {
      ...semester,
      semester_number: 2,
    };

    semesterUpdateMock.mockResolvedValue(updatedSemester);

    const result = await service.update(10n, {
      semester_number: 2,
    });

    expect(result).toEqual(updatedSemester);

    expect(semesterUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 10n,
        },
        data: expect.objectContaining({
          semester_number: 2,
          academic_year_id: undefined,
        }),
      }),
    );
  });

  it('preserves semester number during an unrelated partial update', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    const renamedSemester = {
      ...semester,
      semester_name: 'First Semester',
    };

    semesterUpdateMock.mockResolvedValue(renamedSemester);

    await service.update(10n, {
      semester_name: 'First Semester',
    });

    expect(semesterUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          semester_name: 'First Semester',
          semester_number: undefined,
          academic_year_id: undefined,
        }),
      }),
    );
  });

  it('preserves an unknown historical semester number during unrelated updates', async () => {
    const historicalSemester = {
      ...semester,
      id: 20n,
      semester_name: 'Development Term',
      semester_number: null,
    };

    semesterFindUniqueMock.mockResolvedValue(historicalSemester);

    semesterUpdateMock.mockResolvedValue({
      ...historicalSemester,
      semester_name: 'Development Term Updated',
    });

    await service.update(20n, {
      semester_name: 'Development Term Updated',
    });

    expect(semesterUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          semester_name: 'Development Term Updated',
          semester_number: undefined,
        }),
      }),
    );
  });

  it('validates a changed academic year during partial update', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    const newAcademicYear = {
      ...academicYear,
      id: 2n,
      name: '2027-2028',
      start_year: 2027,
    };

    academicYearFindUniqueMock.mockResolvedValue(newAcademicYear);

    semesterUpdateMock.mockResolvedValue({
      ...semester,
      academic_year_id: 2n,
      academic_years: newAcademicYear,
    });

    await service.update(10n, {
      academic_year_id: 2,
    });

    expect(academicYearFindUniqueMock).toHaveBeenCalledWith({
      where: {
        id: 2n,
      },
    });

    expect(semesterUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          academic_year_id: 2n,
          semester_number: undefined,
        }),
      }),
    );
  });

  it('returns a conflict when an update violates semester uniqueness', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    semesterUpdateMock.mockRejectedValue({
      code: 'P2002',
    });

    await expect(
      service.update(10n, {
        semester_number: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes an unused semester', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);
    semesterDeleteMock.mockResolvedValue(semester);

    await service.remove(10n);

    expect(semesterDeleteMock).toHaveBeenCalledWith({
      where: {
        id: 10n,
      },
    });
  });

  it('rejects deletion when the semester is referenced by course offerings', async () => {
    semesterFindUniqueMock.mockResolvedValue(semester);

    semesterDeleteMock.mockRejectedValue({
      code: 'P2003',
    });

    await expect(service.remove(10n)).rejects.toThrow(
      'Semester is used by course offerings and cannot be deleted',
    );
  });
});
