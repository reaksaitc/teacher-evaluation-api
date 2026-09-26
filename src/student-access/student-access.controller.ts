import {
  Controller,
  Get,
  Param,
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

import { StudentAccessService } from './student-access.service';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('student')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('STUDENT')
@Controller('student/evaluations')
export class StudentAccessController {
  constructor(private studentAccessService: StudentAccessService) {}

  @Get()
  @ApiOperation({
    summary: 'Evaluations I can answer right now',
  })
  @ApiResponse({
    status: 200,
    description: 'Available evaluations returned successfully',
  })
  findAvailable(@CurrentUser() currentUser: { id: bigint }) {
    return this.studentAccessService.findAvailable(currentUser.id);
  }

  @Get(':id/survey')
  @ApiOperation({
    summary:
      'Course context and questions for an evaluation I can answer',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation survey returned successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Not eligible (not a participant or not enrolled)',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Not open right now, or already submitted',
  })
  getSurvey(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.studentAccessService.getSurvey(
      id,
      currentUser.id,
    );
  }

  @Get(':id/submission-status')
  @ApiOperation({
    summary: 'Whether I have already submitted this evaluation',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission status returned successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Not a participant',
  })
  @ApiResponse({
    status: 404,
    description: 'Evaluation not found',
  })
  getSubmissionStatus(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.studentAccessService.getSubmissionStatus(
      id,
      currentUser.id,
    );
  }
}