import { completeTransactionMock } from '../../test/utils/complete-transaction-mock';
import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { class_type } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CourseOfferingsService } from './course-offerings.service';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<any>>;

describe('CourseOfferingsService', () => {
  let service: CourseOfferingsService;

  let courseFindUnique: AsyncMock;
  let userFindUnique: AsyncMock;
  let semesterFindUnique: AsyncMock;
  let academicYearFindUnique: AsyncMock;
  let generationFindUnique: AsyncMock;
  let majorFindUnique: AsyncMock;
  let offeringFindUnique: AsyncMock;
  let offeringFindFirst: AsyncMock;
  let offeringFindMany: AsyncMock;
  let offeringCreate: AsyncMock;
  let offeringUpdate: AsyncMock;
  let offeringDelete: AsyncMock;
  let groupScopeCreateMany: AsyncMock;
  let groupScopeDeleteMany: AsyncMock;
  let evaluationCount: AsyncMock;
  let transactionResult: unknown;

  beforeEach(() => {
    courseFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    userFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    semesterFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    academicYearFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    generationFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    majorFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    offeringFindUnique = jest.fn<(...args: any[]) => Promise<any>>();

    offeringFindFirst = jest.fn<(...args: any[]) => Promise<any>>();

    offeringFindMany = jest.fn<(...args: any[]) => Promise<any>>();

    offeringCreate = jest.fn<(...args: any[]) => Promise<any>>();

    offeringUpdate = jest.fn<(...args: any[]) => Promise<any>>();

    offeringDelete = jest.fn<(...args: any[]) => Promise<any>>();

    groupScopeCreateMany = jest.fn<(...args: any[]) => Promise<any>>();

    groupScopeDeleteMany = jest.fn<(...args: any[]) => Promise<any>>();
    evaluationCount = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(0);

    transactionResult = undefined;

    const prismaMock = {
      evaluations: { count: evaluationCount },
      course_year_rules: {
        findMany: jest
          .fn<(...args: any[]) => Promise<any>>()
          .mockImplementation(async () =>
            [3, 4].map((year_level) => ({
              major_id: 60n,
              year_level,
              majors: { department_id: 1n },
              revisions: [
                { id: 1n, effective_start_year: 2020, enabled: true },
              ],
            })),
          ),
      },
      courses: {
        findUnique: async (...args: any[]) => {
          const v = await courseFindUnique(...args);
          return v
            ? { department_id: 1n, departments: { status: 'ACTIVE' }, ...v }
            : v;
        },
      },

      users: {
        findUnique: userFindUnique,
      },

      semesters: {
        findUnique: async (...args: any[]) => {
          const v = await semesterFindUnique(...args);
          return v
            ? {
                academic_year_id: 10n,
                academic_years: { id: 10n, start_year: 2026 },
                ...v,
              }
            : v;
        },
      },

      academic_years: {
        findUnique: async (...args: any[]) => {
          const v = await academicYearFindUnique(...args);
          return v ? { start_year: 2026, ...v } : v;
        },
      },

      student_generations: {
        findUnique: async (...args: any[]) => {
          const v = await generationFindUnique(...args);
          return v ? { major_id: 60n, ...v } : v;
        },
      },

      majors: {
        findUnique: majorFindUnique,
      },

      course_offerings: {
        findUnique: offeringFindUnique,
        findFirst: offeringFindFirst,
        findMany: offeringFindMany,
        create: offeringCreate,
        update: offeringUpdate,
        delete: offeringDelete,
      },

      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) =>
        callback(
          completeTransactionMock(prismaMock, {
            course_offerings: {
              create: async (...args: any[]) => {
                transactionResult = await offeringCreate(...args);
                return transactionResult;
              },
              update: async (...args: any[]) => {
                transactionResult = await offeringUpdate(...args);
                return transactionResult;
              },
              findUniqueOrThrow: async () => transactionResult,
              delete: offeringDelete,
            },
            course_offering_group_scopes: {
              createMany: groupScopeCreateMany,
              deleteMany: groupScopeDeleteMany,
            },
          }),
        ),
      ),
    };

    service = new CourseOfferingsService(
      prismaMock as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns course offerings', async () => {
      const offerings = [
        {
          id: 1n,
          year_level: 4,
          class_type: class_type.COURSE,
        },
      ];

      offeringFindMany.mockResolvedValue(offerings);

      const result = await service.findAll();

      expect(result).toBe(offerings);

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            id: 'asc',
          },
          include: expect.objectContaining({
            courses: true,
            semesters: expect.objectContaining({
              include: {
                academic_years: true,
              },
            }),
            users: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('findOwnedByLecturer', () => {
    it('returns explicit group scopes separately from section_code', async () => {
      offeringFindMany.mockResolvedValue([
        {
          id: 1n,
          lecturer_id: 20n,
          section_code: 'TD-01',
          year_level: 4,
          class_type: class_type.TD,
          group_scopes: [
            {
              id: 100n,
              academic_year_id: 40n,
              generation_id: 50n,
              major_id: 60n,
              year_level: 4,
              class_group: 'A',
            },
            {
              id: 101n,
              academic_year_id: 40n,
              generation_id: 50n,
              major_id: 60n,
              year_level: 4,
              class_group: 'B',
            },
          ],
          evaluations: [],
        },
      ]);

      const result = await service.findOwnedByLecturer(20n, {});

      expect(result.items[0].section_code).toBe('TD-01');

      expect(result.items[0].group_scopes).toEqual([
        expect.objectContaining({
          academic_year_id: 40n,
          generation_id: 50n,
          major_id: 60n,
          year_level: 4,
          class_group: 'A',
        }),
        expect.objectContaining({
          academic_year_id: 40n,
          generation_id: 50n,
          major_id: 60n,
          year_level: 4,
          class_group: 'B',
        }),
      ]);

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            group_scopes: expect.any(Object),
          }),
        }),
      );
    });

    it('returns only the authenticated lecturer assignments including offerings with and without evaluations', async () => {
      const offerings = [
        {
          id: 1n,
          lecturer_id: 20n,
          year_level: 4,
          class_type: class_type.COURSE,
          section_code: 'A',
          evaluations: [
            {
              id: 100n,
              status: 'OPEN',
              start_at: new Date('2026-10-01T00:00:00.000Z'),
              end_at: new Date('2026-10-31T23:59:59.000Z'),
              survey_version_id: 101n,
            },
          ],
        },
        {
          id: 2n,
          lecturer_id: 20n,
          year_level: 4,
          class_type: class_type.TD,
          section_code: 'A',
          evaluations: [],
        },
      ];

      offeringFindMany.mockResolvedValue(offerings);

      const result = await service.findOwnedByLecturer(20n, {});

      expect(result).toEqual({
        items: offerings,
        total: 2,
        complete: true,
      });

      expect(result.items[0].evaluations).toHaveLength(1);

      expect(result.items[1].evaluations).toEqual([]);

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lecturer_id: 20n,
          }),
        }),
      );
    });

    it('applies search and assignment filters while preserving lecturer ownership', async () => {
      offeringFindMany.mockResolvedValue([]);

      await service.findOwnedByLecturer(20n, {
        search: 'data',
        academic_year_id: '70',
        semester_id: '60',
        year_level: 4,
        class_type: class_type.TD,
      });

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lecturer_id: 20n,
            semester_id: 60n,
            year_level: 4,
            class_type: class_type.TD,

            semesters: {
              academic_year_id: 70n,
            },

            OR: expect.arrayContaining([
              expect.objectContaining({
                courses: {
                  is: {
                    course_code: {
                      contains: 'data',
                      mode: 'insensitive',
                    },
                  },
                },
              }),

              expect.objectContaining({
                courses: {
                  is: {
                    course_name: {
                      contains: 'data',
                      mode: 'insensitive',
                    },
                  },
                },
              }),

              expect.objectContaining({
                section_code: {
                  contains: 'data',
                  mode: 'insensitive',
                },
              }),
            ]),
          }),
        }),
      );
    });

    it('ignores blank search text without broadening lecturer ownership', async () => {
      offeringFindMany.mockResolvedValue([]);

      await service.findOwnedByLecturer(20n, {
        search: '   ',
      });

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lecturer_id: 20n,
            OR: undefined,
          }),
        }),
      );
    });

    it('loads evaluation metadata without requiring an evaluation to exist', async () => {
      offeringFindMany.mockResolvedValue([]);

      await service.findOwnedByLecturer(20n, {});

      expect(offeringFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            courses: true,

            semesters: {
              include: {
                academic_years: true,
              },
            },

            evaluations: {
              select: {
                id: true,
                status: true,
                start_at: true,
                end_at: true,
                survey_version_id: true,

                group_targets: {
                  include: {
                    academic_years: {
                      select: {
                        id: true,
                        name: true,
                        start_year: true,
                        is_active: true,
                      },
                    },

                    student_generations: {
                      select: {
                        major_id: true,
                        generation_number: true,
                        majors: {
                          select: {
                            id: true,
                            code: true,
                            name: true,
                            department_id: true,
                          },
                        },
                        id: true,
                        name: true,
                      },
                    },

                    majors: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                      },
                    },
                  },

                  orderBy: [
                    {
                      generation_id: 'asc',
                    },
                    {
                      major_id: 'asc',
                    },
                    {
                      year_level: 'asc',
                    },
                    {
                      class_group: 'asc',
                    },
                  ],
                },
              },

              orderBy: {
                created_at: 'desc',
              },
            },
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns an existing course offering', async () => {
      const offering = {
        id: 1n,
        course_id: 10n,
        lecturer_id: 20n,
        semester_id: 30n,
        section_code: 'A',
        year_level: 4,
        class_type: class_type.COURSE,
      };

      offeringFindUnique.mockResolvedValue(offering);

      await expect(service.findOne(1n)).resolves.toBe(offering);
    });

    it('throws when course offering does not exist', async () => {
      offeringFindUnique.mockResolvedValue(null);

      await expect(service.findOne(999n)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      courseFindUnique.mockResolvedValue({
        id: 10n,
      });

      userFindUnique.mockResolvedValue({
        role: 'LECTURER',
        status: 'ACTIVE',
      });

      semesterFindUnique.mockResolvedValue({
        id: 30n,
      });

      offeringFindFirst.mockResolvedValue(null);
    });

    it('creates an offering with year level and class type', async () => {
      const created = {
        id: 1n,
        course_id: 10n,
        lecturer_id: 20n,
        semester_id: 30n,
        section_code: 'A',
        year_level: 4,
        class_type: class_type.TD,
      };

      offeringCreate.mockResolvedValue(created);

      const result = await service.create({
        course_id: '10',
        lecturer_id: '20',
        semester_id: '30',
        section_code: ' A ',
        year_level: 4,
        class_type: class_type.TD,
      });

      expect(result).toBe(created);

      expect(offeringCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            course_id: 10n,
            lecturer_id: 20n,
            semester_id: 30n,
            section_code: 'A',
            year_level: 4,
            class_type: class_type.TD,
          }),
        }),
      );
    });

    it('creates explicit normalized group scopes for multiple class groups', async () => {
      const created = {
        id: 1n,
        course_id: 10n,
        lecturer_id: 20n,
        semester_id: 30n,
        section_code: 'TD-01',
        year_level: 4,
        class_type: class_type.TD,
      };

      offeringCreate.mockResolvedValue(created);

      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      academicYearFindUnique.mockResolvedValue({
        id: 40n,
      });

      generationFindUnique.mockResolvedValue({
        id: 50n,
      });

      majorFindUnique.mockResolvedValue({
        id: 60n,
      });

      await service.create({
        course_id: '10',
        lecturer_id: '20',
        semester_id: '30',
        section_code: 'TD-01',
        year_level: 4,
        class_type: class_type.TD,
        group_scopes: [
          {
            academic_year_id: '40',
            generation_id: '50',
            major_id: '60',
            year_level: 4,
            class_groups: [' a ', 'b'],
          },
        ],
      });

      expect(groupScopeCreateMany).toHaveBeenCalledWith({
        data: [
          {
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 4,
            class_group: 'A',
            curriculum_revision_id: 1n,
          },
          {
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 4,
            class_group: 'B',
            curriculum_revision_id: 1n,
          },
        ],
      });
    });

    it('rejects a group scope from a different academic year than the offering semester', async () => {
      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          year_level: 4,
          class_type: class_type.TD,
          group_scopes: [
            {
              academic_year_id: '99',
              generation_id: '50',
              major_id: '60',
              year_level: 4,
              class_groups: ['A'],
            },
          ],
        }),
      ).rejects.toThrow(
        'Every audience scope must match the semester academic year and course student year',
      );

      expect(groupScopeCreateMany).not.toHaveBeenCalled();

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects a group scope whose year level does not match the offering year level', async () => {
      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          year_level: 4,
          class_type: class_type.TD,
          group_scopes: [
            {
              academic_year_id: '40',
              generation_id: '50',
              major_id: '60',
              year_level: 3,
              class_groups: ['A'],
            },
          ],
        }),
      ).rejects.toThrow(
        'Every audience scope must match the semester academic year and course student year',
      );

      expect(groupScopeCreateMany).not.toHaveBeenCalled();

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects an omitted student year without writing an offering', async () => {
      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toThrow('approved course student year');
      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects an unknown course', async () => {
      courseFindUnique.mockResolvedValue(null);

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toThrow('course_id does not match any course');

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects an unknown semester', async () => {
      semesterFindUnique.mockResolvedValue(null);

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toThrow('semester_id does not match any semester');

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects a user who is not a lecturer', async () => {
      userFindUnique.mockResolvedValue({
        role: 'STUDENT',
        status: 'ACTIVE',
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toThrow('lecturer_id must refer to a user with role LECTURER');

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects an inactive lecturer', async () => {
      userFindUnique.mockResolvedValue({
        role: 'LECTURER',
        status: 'INACTIVE',
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toThrow('lecturer_id must refer to an ACTIVE lecturer');

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('rejects a duplicate offering', async () => {
      offeringFindFirst.mockResolvedValue({
        id: 99n,
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          year_level: 4,
          section_code: 'A',
          class_type: class_type.COURSE,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(offeringCreate).not.toHaveBeenCalled();
    });

    it('converts a database unique conflict to ConflictException', async () => {
      offeringCreate.mockRejectedValue({
        code: 'P2002',
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          year_level: 4,
          class_type: class_type.COURSE,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('converts a database foreign-key error to BadRequestException', async () => {
      offeringCreate.mockRejectedValue({
        code: 'P2003',
      });

      await expect(
        service.create({
          course_id: '10',
          lecturer_id: '20',
          semester_id: '30',
          class_type: class_type.COURSE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    const existingOffering = {
      id: 1n,
      course_id: 10n,
      lecturer_id: 20n,
      semester_id: 30n,
      section_code: 'A',
      year_level: 3,
      class_type: class_type.COURSE,
      group_scopes: [],
    };

    beforeEach(() => {
      offeringFindUnique.mockResolvedValue(existingOffering);

      courseFindUnique.mockResolvedValue({
        id: 10n,
      });

      userFindUnique.mockResolvedValue({
        role: 'LECTURER',
        status: 'ACTIVE',
      });

      semesterFindUnique.mockResolvedValue({
        id: 30n,
      });

      offeringFindFirst.mockResolvedValue(null);
    });

    it('updates year level and class type', async () => {
      const updated = {
        ...existingOffering,
        year_level: 4,
        class_type: class_type.TP,
      };

      offeringUpdate.mockResolvedValue(updated);

      const result = await service.update(1n, {
        year_level: 4,
        class_type: class_type.TP,
      });

      expect(result).toBe(updated);

      expect(offeringUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1n,
          },
          data: expect.objectContaining({
            course_id: 10n,
            lecturer_id: 20n,
            semester_id: 30n,
            section_code: 'A',
            year_level: 4,
            class_type: class_type.TP,
          }),
        }),
      );
    });

    it('preserves existing values when fields are omitted', async () => {
      offeringUpdate.mockResolvedValue(existingOffering);

      await service.update(1n, {});

      expect(offeringUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            course_id: 10n,
            lecturer_id: 20n,
            semester_id: 30n,
            section_code: 'A',
            year_level: 3,
            class_type: class_type.COURSE,
          }),
        }),
      );
    });

    it('preserves existing group scopes when group_scopes is omitted', async () => {
      const existingWithScopes = {
        ...existingOffering,
        year_level: 4,
        group_scopes: [
          {
            id: 100n,
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 4,
            class_group: 'A',
          },
        ],
      };

      offeringFindUnique.mockResolvedValue(existingWithScopes);

      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      academicYearFindUnique.mockResolvedValue({
        id: 40n,
      });

      generationFindUnique.mockResolvedValue({
        id: 50n,
      });

      majorFindUnique.mockResolvedValue({
        id: 60n,
      });

      offeringUpdate.mockResolvedValue(existingWithScopes);

      await service.update(1n, {
        section_code: 'TD-01',
      });

      expect(groupScopeDeleteMany).not.toHaveBeenCalled();

      expect(groupScopeCreateMany).not.toHaveBeenCalled();

      expect(offeringUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1n,
          },
          data: expect.objectContaining({
            section_code: 'TD-01',
          }),
        }),
      );
    });

    it('clears existing group scopes when group_scopes is an empty array', async () => {
      const existingWithScopes = {
        ...existingOffering,
        group_scopes: [
          {
            id: 100n,
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 3,
            class_group: 'A',
          },
        ],
      };

      offeringFindUnique.mockResolvedValue(existingWithScopes);

      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      offeringUpdate.mockResolvedValue({
        ...existingWithScopes,
        group_scopes: [],
      });

      await service.update(1n, {
        group_scopes: [],
      });

      expect(groupScopeDeleteMany).toHaveBeenCalledWith({
        where: {
          course_offering_id: 1n,
        },
      });

      expect(groupScopeCreateMany).not.toHaveBeenCalled();
    });

    it('replaces existing group scopes when new group_scopes are provided', async () => {
      const existingWithScopes = {
        ...existingOffering,
        year_level: 3,
        group_scopes: [
          {
            id: 100n,
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 3,
            class_group: 'A',
          },
        ],
      };

      offeringFindUnique.mockResolvedValue(existingWithScopes);

      semesterFindUnique.mockResolvedValue({
        id: 30n,
        academic_year_id: 40n,
      });

      academicYearFindUnique.mockResolvedValue({
        id: 40n,
      });

      generationFindUnique.mockResolvedValue({
        id: 50n,
      });

      majorFindUnique.mockResolvedValue({
        id: 60n,
      });

      offeringUpdate.mockResolvedValue({
        ...existingWithScopes,
      });

      await service.update(1n, {
        group_scopes: [
          {
            academic_year_id: '40',
            generation_id: '50',
            major_id: '60',
            year_level: 3,
            class_groups: [' b ', 'C'],
          },
        ],
      });

      expect(groupScopeDeleteMany).toHaveBeenCalledWith({
        where: {
          course_offering_id: 1n,
        },
      });

      expect(groupScopeCreateMany).toHaveBeenCalledWith({
        data: [
          {
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 3,
            class_group: 'B',
            curriculum_revision_id: 1n,
          },
          {
            course_offering_id: 1n,
            academic_year_id: 40n,
            generation_id: 50n,
            major_id: 60n,
            year_level: 3,
            class_group: 'C',
            curriculum_revision_id: 1n,
          },
        ],
      });
    });

    it('preserves the assignment identity when editing only its display label', async () => {
      offeringUpdate.mockResolvedValue(existingOffering);

      await service.update(1n, {
        section_code: 'B',
      });

      expect(offeringFindFirst).not.toHaveBeenCalled();
    });

    it('rejects an inactive lecturer during update', async () => {
      userFindUnique.mockResolvedValue({
        role: 'LECTURER',
        status: 'INACTIVE',
      });

      await expect(
        service.update(1n, {
          year_level: 4,
        }),
      ).rejects.toThrow('lecturer_id must refer to an ACTIVE lecturer');

      expect(offeringUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing unused offering', async () => {
      offeringFindUnique.mockResolvedValue({
        id: 1n,
      });

      offeringDelete.mockResolvedValue({
        id: 1n,
      });

      await service.remove(1n);

      expect(offeringDelete).toHaveBeenCalledWith({
        where: {
          id: 1n,
        },
      });
    });

    it('rejects deletion when the offering is in use', async () => {
      offeringFindUnique.mockResolvedValue({
        id: 1n,
      });

      offeringDelete.mockRejectedValue({
        code: 'P2003',
      });

      await expect(service.remove(1n)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects deletion when the offering does not exist', async () => {
      offeringFindUnique.mockResolvedValue(null);

      await expect(service.remove(999n)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(offeringDelete).not.toHaveBeenCalled();
    });
  });
});
