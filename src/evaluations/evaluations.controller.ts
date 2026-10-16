import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Optional,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '@nestjs/passport';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { EvaluationsService } from './evaluations.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ListEvaluationsQueryDto } from './dto/list-evaluations-query.dto';
import { PreviewEvaluationParticipantsDto } from './dto/preview-evaluation-participants.dto';

import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReviewedWorkflowsService } from '../reviewed-workflows/reviewed-workflows.service';
import { requireReviewAtCutover } from '../reviewed-workflows/reviewed-operation.store';
import {
  capturedTargetLabelExample,
  legacyTargetLabelExample,
  targetLabelDescription,
} from '../common/swagger/target-label.example';

@ApiTags('evaluations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('evaluations')
export class EvaluationsController {
  constructor(
    private readonly evaluationsService: EvaluationsService,
    @Optional() private readonly reviewedWorkflows?: ReviewedWorkflowsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List evaluations, optionally filtered by status',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluations returned successfully',
  })
  findAll(
    @Query()
    query: ListEvaluationsQueryDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.findAll(query, actor.id);
  }

  @Post('participants/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview eligible students for an evaluation',
    description:
      'Resolves eligible students from the actual course-offering enrollments. SELECTED_GENERATIONS is intersected with those enrollments and never falls back to all enrolled students.',
  })
  @ApiResponse({
    status: 200,
    description: 'Eligible students previewed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid participant scope or generation selection',
  })
  @ApiResponse({
    status: 404,
    description: 'Course offering or selected generation not found',
  })
  previewParticipants(
    @Body()
    dto: PreviewEvaluationParticipantsDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.previewParticipants(dto, actor.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one evaluation with its context, targeting, and counts',
    description: targetLabelDescription,
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation returned successfully',
    schema: {
      example: {
        id: '10',
        generation_targets: [],
        group_targets: [capturedTargetLabelExample, legacyTargetLabelExample],
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  findOne(
    @Param('id', ParseBigIntPipe)
    id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.findOne(id, actor.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a DRAFT evaluation and confirm its participant group',
    description:
      'For full review, call /evaluations/create-preview with an explicit latest survey_version_id and complete creation input; send unchanged fields, confirmed_student_ids and review_id here. Binds questionnaire, schedule, exact placement/membership context and target labels. A selected label rename before confirmation requires re-review. Snapshots are server-authored at confirmation; do not submit historical_labels. Retry returns the original evaluation, labels and already_applied=true. Participant-only preview and set-only creation remain legacy compatibility until REQUIRE_REVIEWED_CONFIRMATION=true. Actual latest has no empty-version fallback.',
  })
  @ApiResponse({
    status: 201,
    description: 'Evaluation created successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid offering, question set, survey version, schedule, participant scope, generation selection, or empty eligible group',
  })
  @ApiResponse({
    status: 409,
    description:
      'The course offering already has an evaluation using the selected survey version, or the eligible student group changed after preview',
  })
  create(
    @Body()
    dto: CreateEvaluationDto,

    @CurrentUser()
    currentUser: {
      id: bigint;
    },
  ) {
    if (dto.publish && !dto.review_id)
      throw new BadRequestException({
        code: 'REVIEW_REQUIRED',
        message:
          'Atomic publication requires a full creation preview and review_id',
      });
    if (dto.review_id && this.reviewedWorkflows)
      return this.reviewedWorkflows.confirmCreate(dto, currentUser.id);
    requireReviewAtCutover();
    return this.evaluationsService.create(dto, currentUser.id);
  }

  @Put(':id/schedule')
  @ApiOperation({
    summary:
      'Edit a DRAFT schedule or extend only the deadline of an active OPEN evaluation',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation schedule updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'end_at is not after start_at',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not a DRAFT',
  })
  updateSchedule(
    @Param('id', ParseBigIntPipe)
    id: bigint,

    @Body()
    dto: UpdateScheduleDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.updateSchedule(id, dto, actor.id);
  }

  @Post(':id/open')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Open a DRAFT evaluation and lock its question-set version',
    description:
      'Uses the frozen participant list. A newer question version returns 409 and preserves the draft assignment for re-review. Existing assignments may continue after their named set is archived. Opening never silently substitutes versions or adds later enrollments.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation opened successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Evaluation is not ready: missing dates, past end date, archived version, no questions, or no confirmed participants',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Evaluation is not a DRAFT, a newer question version requires re-review, or a concurrent operation conflicted',
  })
  open(
    @Param('id', ParseBigIntPipe)
    id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.open(id, actor.id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close an OPEN evaluation',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation closed successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not OPEN',
  })
  close(
    @Param('id', ParseBigIntPipe)
    id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.evaluationsService.close(id, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a DRAFT evaluation',
    description:
      'Deletes the DRAFT together with its frozen participant assignments and generation targets.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 204,
    description: 'Evaluation deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not a DRAFT',
  })
  async remove(
    @Param('id', ParseBigIntPipe)
    id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    await this.evaluationsService.remove(id, actor.id);
  }
}
