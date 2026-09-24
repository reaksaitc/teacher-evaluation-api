import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('evaluations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('evaluations')
export class EvaluationsController {
  constructor(private evaluationsService: EvaluationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List evaluations, optionally filtered by status',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluations returned successfully',
  })
  findAll(@Query() query: ListEvaluationsQueryDto) {
    return this.evaluationsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one evaluation with its context and counts',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation returned successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.evaluationsService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a DRAFT evaluation for a course offering + survey version',
  })
  @ApiResponse({
    status: 201,
    description: 'Evaluation created',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input, unknown offering/version, or archived version',
  })
  @ApiResponse({
    status: 409,
    description:
      'Offering already has an evaluation with this version',
  })
  create(
    @Body() dto: CreateEvaluationDto,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.evaluationsService.create(dto, currentUser.id);
  }

  @Put(':id/schedule')
  @ApiOperation({
    summary: 'Set the start/end time (DRAFT only)',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
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
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.evaluationsService.updateSchedule(id, dto);
  }

  @Post(':id/open')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Open a DRAFT evaluation: locks the version and registers enrolled students',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation opened successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Not ready: missing dates, past end, no questions, or no students',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not a DRAFT',
  })
  open(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.evaluationsService.open(id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close an OPEN evaluation',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation closed successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not OPEN',
  })
  close(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.evaluationsService.close(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a DRAFT evaluation',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 204,
    description: 'Evaluation deleted successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Evaluation is not a DRAFT',
  })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.evaluationsService.remove(id);
  }
}