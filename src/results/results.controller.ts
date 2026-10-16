import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { ResultsService } from './results.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { anonymousMajorFilter } from '../common/utils/anonymous-report-scope.util';
import {
  capturedTargetLabelExample,
  legacyTargetLabelExample,
  targetLabelDescription,
} from '../common/swagger/target-label.example';

// =========================================================
// ADMIN RESULTS
// =========================================================

@ApiTags('admin-results')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/results')
export class AdminResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  /**
   * GET /admin/results
   *
   * Returns anonymous aggregated results
   * for all evaluations.
   */
  @Get()
  @ApiOperation({
    summary: 'Get all anonymous evaluation results',
    description:
      'Returns aggregated evaluation results for all lecturers without exposing student identities. ' +
      targetLabelDescription,
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        {
          target_scope: {
            groups: [capturedTargetLabelExample, legacyTargetLabelExample],
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description: 'UNSUPPORTED_ANONYMOUS_SCOPE: query slicing is unsupported',
  })
  getAllResults(
    @Query() query: Record<string, unknown> = {},
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.resultsService.getAdminResults(
      anonymousMajorFilter(query),
      actor.id,
    );
  }

  @Get('export')
  @ApiOperation({
    summary:
      'Export the same authorized aggregate dataset with the same optional major_id filter and captured labels',
  })
  exportResults(
    @Query() query: Record<string, unknown> = {},
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.resultsService.getAdminResults(
      anonymousMajorFilter(query),
      actor.id,
    );
  }

  /**
   * GET /admin/results/:lecturerId
   *
   * Returns anonymous aggregated results
   * for one lecturer.
   */
  @Get(':lecturerId/export')
  @ApiOperation({
    summary:
      'Export one lecturer aggregate dataset with captured major filter labels',
  })
  exportLecturer(
    @Param('lecturerId', ParseBigIntPipe) lecturerId: bigint,
    @Query() query: Record<string, unknown> = {},
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.resultsService.getAdminResultsByLecturer(
      lecturerId,
      anonymousMajorFilter(query),
      actor.id,
    );
  }

  @Get(':lecturerId')
  @ApiOperation({
    summary: 'Get anonymous evaluation results for one lecturer',
    description:
      'Returns aggregated evaluation results for the selected lecturer without exposing student identities.',
  })
  @ApiParam({
    name: 'lecturerId',
    example: '2',
    description: 'Lecturer user ID',
  })
  getResultsByLecturer(
    @Param('lecturerId', ParseBigIntPipe)
    lecturerId: bigint,
    @Query() query: Record<string, unknown> = {},
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.resultsService.getAdminResultsByLecturer(
      lecturerId,
      anonymousMajorFilter(query),
      actor.id,
    );
  }
}

// =========================================================
// LECTURER RESULTS
// =========================================================

@ApiTags('lecturer-results')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('LECTURER')
@Controller('lecturer/results')
export class LecturerResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get('export')
  @ApiOperation({
    summary:
      'Export my released aggregate results with the same optional captured-major filter',
  })
  exportMine(
    @CurrentUser() actor: { id: bigint },
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.resultsService.getLecturerResults(
      actor.id,
      anonymousMajorFilter(query),
    );
  }

  /**
   * GET /lecturer/results
   *
   * Lecturer can only see their own
   * anonymous aggregated results.
   */
  @Get()
  @ApiOperation({
    summary: 'Get my anonymous evaluation results',
    description:
      'Returns only CLOSED evaluation results owned by the authenticated lecturer. OPEN/DRAFT evaluations have no released answers or comments here; an empty evaluations array is valid when none are closed. ' +
      targetLabelDescription,
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        evaluations: [
          {
            target_scope: {
              groups: [capturedTargetLabelExample, legacyTargetLabelExample],
            },
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'UNSUPPORTED_ANONYMOUS_SCOPE: query slicing is unsupported',
  })
  getMyResults(
    @CurrentUser()
    currentUser: { id: bigint },
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.resultsService.getLecturerResults(
      currentUser.id,
      anonymousMajorFilter(query),
    );
  }
}
