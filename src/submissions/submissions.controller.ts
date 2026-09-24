import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('student')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('STUDENT')
@Controller('student/evaluations')
export class SubmissionsController {
  constructor(private submissionsService: SubmissionsService) {}

  @Post(':id/responses')
  @HttpCode(201)
  @ApiOperation({ summary: 'Submit my answers once, anonymously' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 201, description: 'Submitted' })
  @ApiResponse({ status: 400, description: 'Invalid answers (wrong question, out of range, missing required)' })
  @ApiResponse({ status: 403, description: 'Not eligible' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 409, description: 'Not open, or already submitted' })
  submit(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: SubmitResponseDto,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.submissionsService.submit(id, currentUser.id, dto);
  }
}