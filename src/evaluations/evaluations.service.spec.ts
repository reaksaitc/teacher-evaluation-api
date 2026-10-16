import { jest } from '@jest/globals';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { evaluation_participant_scope, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EvaluationsService } from './evaluations.service';

describe('EvaluationsService', () => {
  let service: EvaluationsService;

  const courseOfferingFindUniqueMock = jest.fn<() => Promise<any>>();

  const surveyFindUniqueMock = jest.fn<() => Promise<any>>();

  const surveyVersionFindFirstMock = jest.fn<() => Promise<any>>();

  const surveyVersionUpdateMock = jest.fn<() => Promise<any>>();

  const evaluationFindUniqueMock = jest.fn<() => Promise<any>>();

  const evaluationFindManyMock = jest.fn<() => Promise<any[]>>();

  const evaluationCreateMock = jest.fn<() => Promise<any>>();

  const evaluationUpdateMock = jest.fn<() => Promise<any>>();

  const evaluationUpdateManyMock = jest.fn<() => Promise<{ count: number }>>();

  const evaluationDeleteMock = jest.fn<() => Promise<any>>();

  const enrollmentFindManyMock = jest.fn<() => Promise<any[]>>();

  const participantCreateManyMock = jest.fn<() => Promise<{ count: number }>>();

  const participantDeleteManyMock = jest.fn<() => Promise<{ count: number }>>();

  const generationTargetCreateManyMock =
    jest.fn<() => Promise<{ count: number }>>();

  const generationTargetDeleteManyMock =
    jest.fn<() => Promise<{ count: number }>>();

  const groupTargetCreateManyMock = jest.fn<() => Promise<{ count: number }>>();

  const groupTargetDeleteManyMock = jest.fn<() => Promise<{ count: number }>>();

  const studentGenerationFindManyMock = jest.fn<() => Promise<any[]>>();

  type TransactionCallback = (tx: any) => Promise<any>;

  const transactionMock =
    jest.fn<(callback: TransactionCallback) => Promise<any>>();

  const prismaMock: any = {
    users: {
      findUnique: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({
          role: 'ADMIN',
          status: 'ACTIVE',
          full_name: 'Test admin',
        }),
    },
    user_departments: {
      findMany: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([]),
    },
    evaluation_activity: {
      create: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({}),
    },

    course_offerings: {
      findUniqueOrThrow: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ courses: { department_id: 1n } }),
      findUnique: async (...args: any[]) => {
        const value = await (courseOfferingFindUniqueMock as any)(...args);
        return value
          ? { ...value, courses: { department_id: 1n, ...value.courses } }
          : value;
      },
    },

    surveys: {
      findUnique: surveyFindUniqueMock,
    },

    survey_versions: {
      findFirst: surveyVersionFindFirstMock,

      update: surveyVersionUpdateMock,
    },

    evaluations: {
      findFirst: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(null),
      findUnique: evaluationFindUniqueMock,

      findMany: evaluationFindManyMock,

      create: evaluationCreateMock,

      update: evaluationUpdateMock,

      updateMany: evaluationUpdateManyMock,

      delete: evaluationDeleteMock,
    },

    enrollments: {
      findMany: enrollmentFindManyMock,
    },

    evaluation_participants: {
      findMany: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([]),
      createMany: participantCreateManyMock,

      deleteMany: participantDeleteManyMock,
    },

    evaluation_generation_targets: {
      createMany: generationTargetCreateManyMock,

      deleteMany: generationTargetDeleteManyMock,
    },

    evaluation_group_targets: {
      createMany: groupTargetCreateManyMock,

      deleteMany: groupTargetDeleteManyMock,
    },

    student_generations: {
      findUnique: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ id: 1n, major_id: 2n }),
      findMany: studentGenerationFindManyMock,
    },
    academic_years: {
      findUnique: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ id: 10n, name: '2026-2027', start_year: 2026 }),
    },
    majors: {
      findMany: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([
          { id: 2n, code: 'AMS', name: 'AMS', department_id: 1n },
        ]),
      findUnique: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({
          id: 2n,
          name: 'AMS',
          code: 'AMS',
          department_id: 1n,
        }),
    },

    $transaction: transactionMock,
  };

  const evaluationResult = {
    id: BigInt(50),
    course_offering_id: BigInt(1),
    survey_version_id: BigInt(3),

    participant_scope: evaluation_participant_scope.ALL_ENROLLED,

    status: 'DRAFT',

    start_at: null,
    end_at: null,

    course_offerings: {
      courses: { department_id: 1n },
      semesters: { academic_year_id: 10n, semester_number: 1 },
    },
    created_by: BigInt(10),

    created_at: new Date('2026-10-01T00:00:00.000Z'),

    updated_at: new Date('2026-10-01T00:00:00.000Z'),
  };

  const eligibleOffering = {
    id: BigInt(1),
    year_level: 4,

    semesters: {
      academic_year_id: BigInt(10),

      academic_years: {
        id: BigInt(10),
        name: '2026-2027',
        start_year: 2026,
      },
    },
  };

  const eligibleEnrollment = {
    student_id: BigInt(21),

    users: {
      id: BigInt(21),
      full_name: 'Student One',
      role: 'STUDENT',
      status: 'ACTIVE',

      student: {
        id: BigInt(101),
        student_code: 'e20230001',
        generation_id: BigInt(5),

        student_generations: {
          id: BigInt(5),
          name: 'Generation 2023',
          starting_year_level: 1,

          entry_academic_year: {
            id: BigInt(7),
            start_year: 2023,
          },
        },

        student_academic_records: [
          {
            academic_year_id: BigInt(10),

            year_level: 4,
            major_id: BigInt(2),
            class_group: 'A',
          },
        ],
      },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,

        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<EvaluationsService>(EvaluationsService);

    courseOfferingFindUniqueMock.mockResolvedValue({
      id: BigInt(1),
    });

    surveyFindUniqueMock.mockResolvedValue({
      id: BigInt(2),
      archived_at: null,
    });

    surveyVersionFindFirstMock.mockResolvedValue({
      id: BigInt(3),
      survey_id: BigInt(2),
      status: 'DRAFT',

      surveys: {
        archived_at: null,
      },

      _count: {
        questions: 5,
      },
    });

    surveyVersionUpdateMock.mockResolvedValue({});

    evaluationCreateMock.mockResolvedValue({
      id: BigInt(50),
    });

    evaluationFindManyMock.mockResolvedValue([]);

    evaluationFindUniqueMock.mockResolvedValue(evaluationResult);

    evaluationUpdateMock.mockResolvedValue(evaluationResult);

    evaluationUpdateManyMock.mockResolvedValue({
      count: 1,
    });

    evaluationDeleteMock.mockResolvedValue(evaluationResult);

    enrollmentFindManyMock.mockResolvedValue([]);

    participantCreateManyMock.mockResolvedValue({
      count: 0,
    });

    participantDeleteManyMock.mockResolvedValue({
      count: 0,
    });

    generationTargetCreateManyMock.mockResolvedValue({
      count: 0,
    });

    generationTargetDeleteManyMock.mockResolvedValue({
      count: 0,
    });

    groupTargetCreateManyMock.mockResolvedValue({
      count: 0,
    });

    groupTargetDeleteManyMock.mockResolvedValue({
      count: 0,
    });

    studentGenerationFindManyMock.mockResolvedValue([]);

    transactionMock.mockImplementation(async (callback) =>
      callback(prismaMock),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should validate the latest version from the selected named question set', async () => {
      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',
        },
        BigInt(10),
      );

      expect(surveyFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(2),
        },

        select: {
          id: true,
          archived_at: true,
        },
      });

      expect(surveyVersionFindFirstMock).toHaveBeenCalledWith({
        where: {
          survey_id: BigInt(2),
        },

        orderBy: {
          version_no: 'desc',
        },

        select: {
          id: true,
          status: true,
          _count: { select: { questions: true } },
        },
      });

      expect(evaluationCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            course_offering_id: BigInt(1),

            survey_version_id: BigInt(3),

            participant_scope: evaluation_participant_scope.ALL_ENROLLED,

            status: 'DRAFT',

            created_by: BigInt(10),
          }),
        }),
      );
    });

    it('should never search another survey when resolving the latest version', async () => {
      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',
        },
        BigInt(10),
      );

      expect(surveyVersionFindFirstMock).toHaveBeenCalledTimes(1);

      expect(surveyVersionFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            survey_id: BigInt(2),
          }),
        }),
      );
    });

    it('should reject an unknown named question set', async () => {
      surveyFindUniqueMock.mockResolvedValue(null);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '999',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'survey_id does not match any named question set',
        ),
      );

      expect(surveyVersionFindFirstMock).not.toHaveBeenCalled();

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject a named question set with no usable version', async () => {
      surveyVersionFindFirstMock.mockResolvedValue(null);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'The selected question set has no survey version',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should preserve explicit survey_version_id selection for backward compatibility', async () => {
      await service.create(
        {
          course_offering_id: '1',
          survey_version_id: '3',
        },
        BigInt(10),
      );

      expect(surveyVersionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(3),
        },

        select: {
          id: true,
          survey_id: true,
          status: true,

          surveys: {
            select: {
              archived_at: true,
            },
          },

          _count: {
            select: {
              questions: true,
            },
          },
        },
      });

      expect(evaluationCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            survey_version_id: BigInt(3),

            participant_scope: evaluation_participant_scope.ALL_ENROLLED,
          }),
        }),
      );
    });

    it('should validate that an explicit version belongs to the selected survey', async () => {
      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',
          survey_version_id: '3',
        },
        BigInt(10),
      );

      expect(surveyVersionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(3),
          survey_id: BigInt(2),
        },

        select: {
          id: true,
          survey_id: true,
          status: true,

          surveys: {
            select: {
              archived_at: true,
            },
          },

          _count: {
            select: {
              questions: true,
            },
          },
        },
      });
    });

    it('should reject an explicit version that belongs to another survey', async () => {
      surveyVersionFindFirstMock.mockResolvedValue(null);

      surveyFindUniqueMock.mockResolvedValue({
        id: BigInt(2),
      });

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',
            survey_version_id: '99',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'survey_version_id does not belong to the selected survey',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should report an unknown survey before reporting a version mismatch', async () => {
      surveyVersionFindFirstMock.mockResolvedValue(null);

      surveyFindUniqueMock.mockResolvedValue(null);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '999',
            survey_version_id: '3',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'survey_id does not match any named question set',
        ),
      );
    });

    it('should reject an unknown explicit survey version', async () => {
      surveyVersionFindFirstMock.mockResolvedValue(null);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_version_id: '999',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'survey_version_id does not match any survey version',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject an archived explicit version', async () => {
      surveyVersionFindFirstMock.mockResolvedValue({
        id: BigInt(3),
        survey_id: BigInt(2),
        status: 'ARCHIVED',

        surveys: {
          archived_at: null,
        },

        _count: {
          questions: 5,
        },
      });

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_version_id: '3',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'An archived survey version cannot be used for a new evaluation',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject an explicit version with no questions', async () => {
      surveyVersionFindFirstMock.mockResolvedValue({
        id: BigInt(3),
        survey_id: BigInt(2),
        status: 'DRAFT',

        surveys: {
          archived_at: null,
        },

        _count: {
          questions: 0,
        },
      });

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_version_id: '3',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException('The survey version has no questions'),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should allow a LOCKED explicit version when it is not archived and has questions', async () => {
      surveyVersionFindFirstMock.mockResolvedValue({
        id: BigInt(3),
        survey_id: BigInt(2),
        status: 'LOCKED',

        surveys: {
          archived_at: null,
        },

        _count: {
          questions: 5,
        },
      });

      await service.create(
        {
          course_offering_id: '1',
          survey_version_id: '3',
        },
        BigInt(10),
      );

      expect(evaluationCreateMock).toHaveBeenCalled();
    });

    it('should reject creation when neither survey_id nor survey_version_id is provided', async () => {
      await expect(
        service.create(
          {
            course_offering_id: '1',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Either survey_id or survey_version_id is required',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject an unknown course offering', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(null);

      await expect(
        service.create(
          {
            course_offering_id: '999',
            survey_id: '2',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'course_offering_id does not match any course offering',
        ),
      );

      expect(surveyFindUniqueMock).not.toHaveBeenCalled();

      expect(surveyVersionFindFirstMock).not.toHaveBeenCalled();

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject an invalid schedule window', async () => {
      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',

            start_at: '2026-10-14T00:00:00.000Z',

            end_at: '2026-10-01T00:00:00.000Z',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException('end_at must be after start_at'),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should map duplicate evaluation creation to ConflictException', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
        },
      );

      evaluationCreateMock.mockRejectedValue(prismaError);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new ConflictException(
          'This course offering already has an evaluation using this survey version',
        ),
      );
    });

    it('should rethrow non-duplicate database errors', async () => {
      evaluationCreateMock.mockRejectedValue(new Error('Database unavailable'));

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',
          },
          BigInt(10),
        ),
      ).rejects.toThrow('Database unavailable');
    });

    it('should freeze confirmed ALL_ENROLLED participants during creation', async () => {
      courseOfferingFindUniqueMock
        .mockResolvedValueOnce({
          id: BigInt(1),
        })
        .mockResolvedValueOnce(eligibleOffering)
        .mockResolvedValueOnce(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',

          participant_scope: evaluation_participant_scope.ALL_ENROLLED,

          confirmed_student_ids: ['21'],
        },
        BigInt(10),
      );

      expect(participantCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            evaluation_id: BigInt(50),

            student_id: BigInt(21),

            has_submitted: false,
          }),
        ],
      });
    });

    it('should create generation targets and freeze selected-generation participants', async () => {
      courseOfferingFindUniqueMock
        .mockResolvedValueOnce({
          id: BigInt(1),
        })
        .mockResolvedValueOnce(eligibleOffering)
        .mockResolvedValueOnce(eligibleOffering);

      studentGenerationFindManyMock.mockResolvedValue([
        {
          id: BigInt(5),
          name: 'Generation 2023',
          starting_year_level: 1,
          entry_academic_year: { id: 1n, name: '2023-2024', start_year: 2023 },
        },
      ]);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',

          participant_scope: evaluation_participant_scope.SELECTED_GENERATIONS,

          generation_ids: ['5'],

          confirmed_student_ids: ['21'],
        },
        BigInt(10),
      );

      expect(generationTargetCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            evaluation_id: BigInt(50),

            generation_id: BigInt(5),
          }),
        ],
      });

      expect(participantCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            evaluation_id: BigInt(50),

            student_id: BigInt(21),
          }),
        ],
      });
    });

    it('should reject SELECTED_GENERATIONS creation without confirmed student IDs', async () => {
      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',

            participant_scope:
              evaluation_participant_scope.SELECTED_GENERATIONS,

            generation_ids: ['5'],
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'confirmed_student_ids is required after previewing the selected participant scope',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject creation when confirmed participants changed after preview', async () => {
      courseOfferingFindUniqueMock
        .mockResolvedValueOnce({
          id: BigInt(1),
        })
        .mockResolvedValueOnce(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',

            participant_scope: evaluation_participant_scope.ALL_ENROLLED,

            confirmed_student_ids: ['999'],
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Eligible students changed after the preview. Preview and review the participant list again before creating the evaluation.',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();
    });

    it('should reject group-targeted creation when eligible students change after preview', async () => {
      const groupScopedOffering = {
        ...eligibleOffering,

        group_scopes: [
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'A',
          },
        ],
      };

      courseOfferingFindUniqueMock
        .mockResolvedValueOnce({
          id: BigInt(1),
        })
        .mockResolvedValueOnce(groupScopedOffering)
        .mockResolvedValueOnce(groupScopedOffering);

      enrollmentFindManyMock
        .mockResolvedValueOnce([eligibleEnrollment])
        .mockResolvedValueOnce([
          {
            ...eligibleEnrollment,

            users: {
              ...eligibleEnrollment.users,

              student: {
                ...eligibleEnrollment.users.student,

                student_academic_records: [
                  {
                    academic_year_id: BigInt(10),

                    year_level: 4,

                    major_id: BigInt(2),

                    class_group: 'B',
                  },
                ],
              },
            },
          },
        ]);

      await expect(
        service.create(
          {
            course_offering_id: '1',
            survey_id: '2',

            participant_scope: evaluation_participant_scope.ALL_ENROLLED,

            group_scope: {
              academic_year_id: '10',
              generation_id: '5',
              major_id: '2',
              year_level: 4,
              class_groups: ['A'],
            },

            confirmed_student_ids: ['21'],
          },
          BigInt(10),
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Eligible students changed after the preview. Preview and review the participant list again before creating the evaluation.',
        ),
      );

      expect(evaluationCreateMock).not.toHaveBeenCalled();

      expect(participantCreateManyMock).not.toHaveBeenCalled();

      expect(groupTargetCreateManyMock).not.toHaveBeenCalled();
    });

    it('should freeze group targets and confirmed participants for a group-targeted evaluation', async () => {
      studentGenerationFindManyMock.mockResolvedValue([
        {
          id: 5n,
          name: 'Generation 2023',
          starting_year_level: 1,
          entry_academic_year: { id: 1n, name: '2023-2024', start_year: 2023 },
        },
      ]);
      const groupScopedOffering = {
        ...eligibleOffering,

        group_scopes: [
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'A',
          },
        ],
      };

      courseOfferingFindUniqueMock
        .mockResolvedValueOnce({
          id: BigInt(1),
        })
        .mockResolvedValueOnce(groupScopedOffering)
        .mockResolvedValueOnce(groupScopedOffering);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      await service.create(
        {
          course_offering_id: '1',
          survey_id: '2',

          participant_scope: evaluation_participant_scope.ALL_ENROLLED,

          group_scope: {
            academic_year_id: '10',
            generation_id: '5',
            major_id: '2',
            year_level: 4,
            class_groups: ['A'],
          },

          confirmed_student_ids: ['21'],
        },
        BigInt(10),
      );

      expect(groupTargetCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            evaluation_id: BigInt(50),

            academic_year_id: BigInt(10),

            generation_id: BigInt(5),

            major_id: BigInt(2),

            year_level: 4,

            class_group: 'A',
          }),
        ],
      });

      expect(participantCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            evaluation_id: BigInt(50),

            student_id: BigInt(21),

            survey_version_id: BigInt(3),

            has_submitted: false,
          }),
        ],
      });
    });
  });

  describe('previewParticipants', () => {
    it('should preview eligible enrolled students', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      const result = await service.previewParticipants({
        course_offering_id: '1',

        participant_scope: evaluation_participant_scope.ALL_ENROLLED,
      });

      expect(result.enrolled_count).toBe(1);

      expect(result.eligible_count).toBe(1);

      expect(result.ineligible_count).toBe(0);

      expect(result.confirmed_student_ids).toEqual(['21']);

      expect(result.eligible_students).toEqual([
        expect.objectContaining({
          user_id: '21',
          student_id: '101',

          student_code: 'e20230001',

          full_name: 'Student One',

          generation_id: '5',

          generation_name: 'Generation 2023',

          effective_year_level: 4,

          year_level_source: 'ACADEMIC_RECORD',
        }),
      ]);
    });

    it('should include Group A and exclude Group B when both are enrolled in the same offering', async () => {
      const groupScopedOffering = {
        ...eligibleOffering,

        group_scopes: [
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'A',
          },
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'B',
          },
        ],
      };

      const groupBEnrollment = {
        ...eligibleEnrollment,

        student_id: BigInt(22),

        users: {
          ...eligibleEnrollment.users,

          id: BigInt(22),
          full_name: 'Student Two',

          student: {
            ...eligibleEnrollment.users.student,

            id: BigInt(102),
            student_code: 'e20230002',

            student_academic_records: [
              {
                academic_year_id: BigInt(10),

                year_level: 4,

                major_id: BigInt(2),

                class_group: 'B',
              },
            ],
          },
        },
      };

      courseOfferingFindUniqueMock.mockResolvedValue(groupScopedOffering);

      enrollmentFindManyMock.mockResolvedValue([
        eligibleEnrollment,
        groupBEnrollment,
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',

        participant_scope: evaluation_participant_scope.ALL_ENROLLED,

        group_scope: {
          academic_year_id: '10',
          generation_id: '5',
          major_id: '2',
          year_level: 4,
          class_groups: ['A'],
        },
      });

      expect(result.enrolled_count).toBe(2);

      expect(result.eligible_count).toBe(1);

      expect(result.ineligible_count).toBe(1);

      expect(result.confirmed_student_ids).toEqual(['21']);

      expect(result.eligible_students).toHaveLength(1);

      expect(result.eligible_students[0]).toEqual(
        expect.objectContaining({
          user_id: '21',
          student_id: '101',
          class_group: 'A',
          placement_academic_year_id: '10',
          placement_major_id: '2',
        }),
      );

      expect(result.ineligible_reasons.class_group_mismatch).toBe(1);

      expect(result.group_scope).toEqual({
        academic_year_id: '10',
        generation_id: '5',
        major_id: '2',
        year_level: 4,
        class_groups: ['A'],
      });
    });

    it('should normalize class-group values when matching evaluation group scope', async () => {
      const groupScopedOffering = {
        ...eligibleOffering,

        group_scopes: [
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'A',
          },
        ],
      };

      const studentWithUnnormalizedGroup = {
        ...eligibleEnrollment,

        users: {
          ...eligibleEnrollment.users,

          student: {
            ...eligibleEnrollment.users.student,

            student_academic_records: [
              {
                academic_year_id: BigInt(10),

                year_level: 4,

                major_id: BigInt(2),

                class_group: '  a  ',
              },
            ],
          },
        },
      };

      courseOfferingFindUniqueMock.mockResolvedValue(groupScopedOffering);

      enrollmentFindManyMock.mockResolvedValue([studentWithUnnormalizedGroup]);

      const result = await service.previewParticipants({
        course_offering_id: '1',

        group_scope: {
          academic_year_id: '10',
          generation_id: '5',
          major_id: '2',
          year_level: 4,

          class_groups: ['  a  '],
        },
      });

      expect(result.eligible_count).toBe(1);

      expect(result.confirmed_student_ids).toEqual(['21']);

      expect(result.group_scope?.class_groups).toEqual(['A']);

      expect(result.eligible_students[0].class_group).toBe('A');
    });

    it('should reject the same class-group name from a different generation or major scope', async () => {
      const groupScopedOffering = {
        ...eligibleOffering,

        group_scopes: [
          {
            academic_year_id: BigInt(10),
            generation_id: BigInt(5),
            major_id: BigInt(2),
            year_level: 4,
            class_group: 'A',
          },
        ],
      };

      courseOfferingFindUniqueMock.mockResolvedValue(groupScopedOffering);

      await expect(
        service.previewParticipants({
          course_offering_id: '1',

          group_scope: {
            academic_year_id: '10',
            generation_id: '6',
            major_id: '2',
            year_level: 4,
            class_groups: ['A'],
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'The course offering does not serve the requested group scope: A',
        ),
      );

      await expect(
        service.previewParticipants({
          course_offering_id: '1',

          group_scope: {
            academic_year_id: '10',
            generation_id: '5',
            major_id: '3',
            year_level: 4,
            class_groups: ['A'],
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Group generation does not belong to its major',
        ),
      );

      expect(enrollmentFindManyMock).not.toHaveBeenCalled();
    });

    it('should intersect selected generations with actual enrollments', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      studentGenerationFindManyMock.mockResolvedValue([
        {
          id: BigInt(6),
        },
      ]);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      const result = await service.previewParticipants({
        course_offering_id: '1',

        participant_scope: evaluation_participant_scope.SELECTED_GENERATIONS,

        generation_ids: ['6'],
      });

      expect(result.enrolled_count).toBe(1);

      expect(result.eligible_count).toBe(0);

      expect(result.confirmed_student_ids).toEqual([]);

      expect(result.ineligible_reasons.generation_not_selected).toBe(1);
    });

    it('should not widen an empty selected generation to all enrolled students', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      studentGenerationFindManyMock.mockResolvedValue([
        {
          id: BigInt(6),
        },
      ]);

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      const result = await service.previewParticipants({
        course_offering_id: '1',

        participant_scope: evaluation_participant_scope.SELECTED_GENERATIONS,

        generation_ids: ['6'],
      });

      expect(result.eligible_count).toBe(0);

      expect(result.eligible_students).toEqual([]);
    });

    it('should reject an unknown generation', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      studentGenerationFindManyMock.mockResolvedValue([]);

      await expect(
        service.previewParticipants({
          course_offering_id: '1',

          participant_scope: evaluation_participant_scope.SELECTED_GENERATIONS,

          generation_ids: ['999'],
        }),
      ).rejects.toThrow(
        new NotFoundException('Student generation not found: 999'),
      );

      expect(enrollmentFindManyMock).not.toHaveBeenCalled();
    });

    it('should exclude inactive students', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([
        {
          ...eligibleEnrollment,

          users: {
            ...eligibleEnrollment.users,
            status: 'INACTIVE',
          },
        },
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(0);

      expect(result.ineligible_reasons.not_active_student).toBe(1);
    });

    it('should exclude enrolled users without a student profile', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([
        {
          student_id: BigInt(21),

          users: {
            id: BigInt(21),

            full_name: 'Student One',

            role: 'STUDENT',
            status: 'ACTIVE',
            student: null,
          },
        },
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(0);

      expect(result.ineligible_reasons.missing_student_profile).toBe(1);
    });

    it('should exclude a student whose effective year does not match the offering', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue({
        ...eligibleOffering,
        year_level: 5,
      });

      enrollmentFindManyMock.mockResolvedValue([eligibleEnrollment]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(0);

      expect(result.ineligible_reasons.year_level_mismatch).toBe(1);
    });

    it('should calculate effective year from the generation when no academic record exists', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue(eligibleOffering);

      enrollmentFindManyMock.mockResolvedValue([
        {
          ...eligibleEnrollment,

          users: {
            ...eligibleEnrollment.users,

            student: {
              ...eligibleEnrollment.users.student,

              student_academic_records: [],
            },
          },
        },
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(0);
      expect(result.eligible_students).toEqual([]);
      expect(result.ineligible_reasons.missing_yearly_group).toBe(1);
    });

    it('should treat automatic progression beyond year 5 as unavailable for year-specific evaluation eligibility', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue({
        ...eligibleOffering,

        semesters: {
          ...eligibleOffering.semesters,

          academic_years: {
            ...eligibleOffering.semesters.academic_years,

            start_year: 2030,
          },
        },

        year_level: 5,
      });

      enrollmentFindManyMock.mockResolvedValue([
        {
          ...eligibleEnrollment,

          users: {
            ...eligibleEnrollment.users,

            student: {
              ...eligibleEnrollment.users.student,

              student_academic_records: [],
            },
          },
        },
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(0);

      expect(result.eligible_students).toEqual([]);

      expect(result.ineligible_reasons.missing_yearly_group).toBe(1);
    });

    it('should allow an explicit year 5 academic record to override beyond-program automatic progression', async () => {
      courseOfferingFindUniqueMock.mockResolvedValue({
        ...eligibleOffering,

        semesters: {
          ...eligibleOffering.semesters,

          academic_years: {
            ...eligibleOffering.semesters.academic_years,

            start_year: 2030,
          },
        },

        year_level: 5,
      });

      enrollmentFindManyMock.mockResolvedValue([
        {
          ...eligibleEnrollment,

          users: {
            ...eligibleEnrollment.users,

            student: {
              ...eligibleEnrollment.users.student,

              student_academic_records: [
                {
                  ...eligibleEnrollment.users.student
                    .student_academic_records[0],

                  year_level: 5,
                },
              ],
            },
          },
        },
      ]);

      const result = await service.previewParticipants({
        course_offering_id: '1',
      });

      expect(result.eligible_count).toBe(1);

      expect(result.ineligible_count).toBe(0);

      expect(result.eligible_students[0]).toEqual(
        expect.objectContaining({
          effective_year_level: 5,
          year_level_source: 'ACADEMIC_RECORD',
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an evaluation', async () => {
      const result = await service.findOne(BigInt(50));

      expect(result).toEqual(expect.objectContaining(evaluationResult));
    });

    it('should throw when the evaluation does not exist', async () => {
      evaluationFindUniqueMock.mockResolvedValue(null);

      await expect(service.findOne(BigInt(999))).rejects.toThrow(
        new NotFoundException('Evaluation not found'),
      );
    });
  });

  describe('updateSchedule', () => {
    it('should update the schedule of a DRAFT evaluation', async () => {
      evaluationFindUniqueMock.mockResolvedValue({
        ...evaluationResult,
        status: 'DRAFT',

        start_at: new Date('2026-10-01T00:00:00.000Z'),

        end_at: new Date('2026-10-14T00:00:00.000Z'),
      });

      await service.updateSchedule(BigInt(50), {
        start_at: '2026-10-02T00:00:00.000Z',

        end_at: '2026-10-15T00:00:00.000Z',
      });

      expect(evaluationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: BigInt(50),
          },

          data: expect.objectContaining({
            start_at: new Date('2026-10-02T00:00:00.000Z'),

            end_at: new Date('2026-10-15T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('should reject schedule changes after the evaluation leaves DRAFT', async () => {
      evaluationFindUniqueMock.mockResolvedValue({
        ...evaluationResult,
        status: 'OPEN',
      });

      await expect(
        service.updateSchedule(BigInt(50), {
          start_at: '2026-10-02T00:00:00.000Z',
        }),
      ).rejects.toThrow(
        new ConflictException(
          'Only DRAFT schedules or active OPEN deadlines can be changed',
        ),
      );

      expect(evaluationUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe('open', () => {
    it('should reject a group-targeted evaluation with no frozen participants instead of falling back to ALL_ENROLLED', async () => {
      evaluationFindUniqueMock.mockResolvedValue({
        id: BigInt(50),

        course_offering_id: BigInt(1),

        survey_version_id: BigInt(3),

        participant_scope: evaluation_participant_scope.ALL_ENROLLED,

        status: 'DRAFT',

        start_at: new Date('2099-10-01T00:00:00.000Z'),

        end_at: new Date('2099-10-14T00:00:00.000Z'),

        survey_versions: {
          id: BigInt(3),
          status: 'DRAFT',
          locked_at: null,

          _count: {
            questions: 5,
          },
        },

        generation_targets: [],

        group_targets: [
          {
            academic_year_id: BigInt(10),

            generation_id: BigInt(5),

            major_id: BigInt(2),

            year_level: 4,

            class_group: 'A',
          },
        ],

        _count: {
          evaluation_participants: 0,
        },
      });

      await expect(service.open(BigInt(50))).rejects.toThrow(
        new BadRequestException(
          'This targeted evaluation has no confirmed participants. Preview and confirm the eligible students before opening.',
        ),
      );

      expect(enrollmentFindManyMock).not.toHaveBeenCalled();

      expect(participantCreateManyMock).not.toHaveBeenCalled();

      expect(evaluationUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete a DRAFT evaluation and its frozen targeting rows', async () => {
      evaluationFindUniqueMock.mockResolvedValue({
        ...evaluationResult,
        status: 'DRAFT',
      });

      await service.remove(BigInt(50));

      expect(participantDeleteManyMock).toHaveBeenCalledWith({
        where: {
          evaluation_id: BigInt(50),
        },
      });

      expect(generationTargetDeleteManyMock).toHaveBeenCalledWith({
        where: {
          evaluation_id: BigInt(50),
        },
      });

      expect(groupTargetDeleteManyMock).toHaveBeenCalledWith({
        where: {
          evaluation_id: BigInt(50),
        },
      });

      expect(evaluationDeleteMock).toHaveBeenCalledWith({
        where: {
          id: BigInt(50),
        },
      });
    });

    it('should reject deletion after the evaluation leaves DRAFT', async () => {
      evaluationFindUniqueMock.mockResolvedValue({
        ...evaluationResult,
        status: 'OPEN',
      });

      await expect(service.remove(BigInt(50))).rejects.toThrow(
        new ConflictException('Only a DRAFT evaluation can be deleted'),
      );

      expect(participantDeleteManyMock).not.toHaveBeenCalled();

      expect(generationTargetDeleteManyMock).not.toHaveBeenCalled();

      expect(evaluationDeleteMock).not.toHaveBeenCalled();
    });
  });
});
