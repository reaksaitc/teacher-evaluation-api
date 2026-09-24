import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('lecturer')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('LECTURER')
@Controller('lecturer/evaluations')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Get(':id/comments')
  @ApiOperation({ summary: 'Anonymous written comments from one of my closed evaluations' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 403, description: 'Not my evaluation' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 409, description: 'Evaluation is not closed yet' })
  getComments(@Param('id', ParseBigIntPipe) id: bigint, @CurrentUser() currentUser: { id: bigint }) {
    return this.commentsService.getComments(id, currentUser.id);
  }
}