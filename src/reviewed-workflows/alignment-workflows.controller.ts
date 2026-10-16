import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentCreationService } from './assignment-creation.service';
import { BulkEvaluationsService } from './bulk-evaluations.service';
import { AcademicYearSetupService } from '../academic-years/academic-year-setup.service';
import { CreateAcademicYearDto } from '../academic-years/dto/create-academic-year.dto';
import { EvaluationActivityService } from '../evaluations/evaluation-activity.service';
import {
  AssignmentRowsDto,
  ConfirmAssignmentsDto,
  BulkEvaluationsDto,
  ConfirmBulkEvaluationsDto,
  EvaluationActivityQueryDto,
} from './dto/alignment-workflows.dto';

@ApiTags('atomic-backend-workflows')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller()
export class AlignmentWorkflowsController {
  constructor(private readonly prisma: PrismaService) {}
  @Post('academic-years/setup')
  @ApiOperation({
    summary:
      'Atomically create a year, requested semesters and independent group/assignment rollover',
    description:
      'idempotency_key is required. Defaults create_semesters=true. Lost responses are retried with the same input/key. Existing separate CRUD remains available.',
  })
  setup(
    @Body() dto: CreateAcademicYearDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    if (!dto.idempotency_key)
      throw new BadRequestException('idempotency_key is required');
    return new AcademicYearSetupService(this.prisma).setup(
      { ...dto, create_semesters: dto.create_semesters ?? true },
      actor.id,
    );
  }
  @Post('academic-years/:id/setup')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recover missing setup for an existing year without overwriting semesters or reviewed placements/assignments',
  })
  finish(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: CreateAcademicYearDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    if (!dto.idempotency_key)
      throw new BadRequestException('idempotency_key is required');
    return new AcademicYearSetupService(this.prisma).setup(
      { ...dto, create_semesters: dto.create_semesters ?? true },
      actor.id,
      id,
    );
  }
  @Post('course-offerings/create-preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Review new teaching assignment rows and exact enrollment rosters without creating offerings',
  })
  assignmentPreview(
    @Body() dto: AssignmentRowsDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return new AssignmentCreationService(this.prisma).preview(dto, actor.id);
  }
  @Post('course-offerings/create-confirm')
  @ApiOperation({
    summary:
      'Atomically create all reviewed assignments and enroll exactly the confirmed students; durable idempotent receipt',
  })
  assignmentConfirm(
    @Body() dto: ConfirmAssignmentsDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return new AssignmentCreationService(this.prisma).confirm(dto, actor.id);
  }
  @Post('evaluations/bulk-create-preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Review up to 50 assignments with READY/SKIPPED/BLOCKED rosters; writes no evaluations',
  })
  bulkPreview(
    @Body() dto: BulkEvaluationsDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return new BulkEvaluationsService(this.prisma).preview(dto, actor.id);
  }
  @Post('evaluations/bulk-create')
  @ApiOperation({
    summary:
      'Create, freeze and publish every READY evaluation atomically, retaining SKIPPED assignments and a durable retry receipt',
  })
  bulkConfirm(
    @Body() dto: ConfirmBulkEvaluationsDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return new BulkEvaluationsService(this.prisma).confirm(dto, actor.id);
  }
  @Get('evaluations/:id/activity')
  @ApiOperation({
    summary:
      'Read immutable server-authored history with opaque keyset pagination; pre-logging actions are unavailable',
  })
  activity(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Query() query: EvaluationActivityQueryDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return new EvaluationActivityService(this.prisma).list(id, query, actor.id);
  }
}
