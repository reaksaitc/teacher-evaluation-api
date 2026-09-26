import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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

import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('questions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller()
export class QuestionsController {
  constructor(private questionsService: QuestionsService) {}

  @Get('survey-versions/:versionId/questions')
  @ApiOperation({
    summary: 'List questions of a survey version in display order',
  })
  @ApiParam({ name: 'versionId', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Questions returned successfully',
  })
  @ApiResponse({ status: 404, description: 'Survey version not found' })
  findAll(@Param('versionId', ParseBigIntPipe) versionId: bigint) {
    return this.questionsService.findAllForVersion(versionId);
  }

  @Post('survey-versions/:versionId/questions')
  @ApiOperation({ summary: 'Add a question to a DRAFT survey version' })
  @ApiParam({ name: 'versionId', type: String, example: '1' })
  @ApiResponse({ status: 201, description: 'Question created' })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or invalid rating range',
  })
  @ApiResponse({ status: 404, description: 'Survey version not found' })
  @ApiResponse({
    status: 409,
    description: 'Version is locked, or display_order already used',
  })
  create(
    @Param('versionId', ParseBigIntPipe) versionId: bigint,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionsService.create(versionId, dto);
  }

  @Put('questions/:questionId')
  @ApiOperation({
    summary: 'Edit a question (only while its version is editable)',
  })
  @ApiParam({ name: 'questionId', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Question updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or invalid rating range',
  })
  @ApiResponse({ status: 404, description: 'Question not found' })
  @ApiResponse({
    status: 409,
    description: 'Version is locked, or display_order already used',
  })
  update(
    @Param('questionId', ParseBigIntPipe) questionId: bigint,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionsService.update(questionId, dto);
  }

  @Delete('questions/:questionId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a question (only while its version is editable)',
  })
  @ApiParam({ name: 'questionId', type: String, example: '1' })
  @ApiResponse({
    status: 204,
    description: 'Question deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Question not found' })
  @ApiResponse({ status: 409, description: 'Version is locked' })
  async remove(
    @Param('questionId', ParseBigIntPipe) questionId: bigint,
  ) {
    await this.questionsService.remove(questionId);
  }
}