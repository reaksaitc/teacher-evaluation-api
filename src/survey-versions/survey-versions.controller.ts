import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SurveyVersionsService } from './survey-versions.service';
import { CreateSurveyVersionDto } from './dto/create-survey-version.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('survey-versions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiParam({ name: 'surveyId', type: String, example: '1' })
@Controller('surveys/:surveyId/versions')
export class SurveyVersionsController {
  constructor(private versionsService: SurveyVersionsService) {}

  @Get()
  @ApiOperation({ summary: 'List versions of a survey' })
  @ApiResponse({ status: 404, description: 'Survey not found' })
  findAll(@Param('surveyId', ParseBigIntPipe) surveyId: bigint) {
    return this.versionsService.findAllForSurvey(surveyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create the next DRAFT version (optionally copying the latest questions)' })
  @ApiResponse({ status: 201, description: 'Version created' })
  @ApiResponse({ status: 404, description: 'Survey not found' })
  create(
    @Param('surveyId', ParseBigIntPipe) surveyId: bigint,
    @Body() dto: CreateSurveyVersionDto,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.versionsService.create(surveyId, dto, currentUser.id);
  }

  @Get(':versionId')
  @ApiOperation({ summary: 'Get one version with its questions' })
  @ApiParam({ name: 'versionId', type: String, example: '1' })
  @ApiResponse({ status: 404, description: 'Survey version not found' })
  findOne(
    @Param('surveyId', ParseBigIntPipe) surveyId: bigint,
    @Param('versionId', ParseBigIntPipe) versionId: bigint,
  ) {
    return this.versionsService.findOne(surveyId, versionId);
  }

  @Post(':versionId/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a version so it is no longer used' })
  @ApiParam({ name: 'versionId', type: String, example: '1' })
  @ApiResponse({ status: 404, description: 'Survey version not found' })
  @ApiResponse({ status: 409, description: 'Already archived' })
  archive(
    @Param('surveyId', ParseBigIntPipe) surveyId: bigint,
    @Param('versionId', ParseBigIntPipe) versionId: bigint,
  ) {
    return this.versionsService.archive(surveyId, versionId);
  }

  @Delete(':versionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a version that is not locked and not used by any evaluation' })
  @ApiParam({ name: 'versionId', type: String, example: '1' })
  @ApiResponse({ status: 404, description: 'Survey version not found' })
  @ApiResponse({ status: 409, description: 'Version is locked or used by evaluations' })
  async remove(
    @Param('surveyId', ParseBigIntPipe) surveyId: bigint,
    @Param('versionId', ParseBigIntPipe) versionId: bigint,
  ) {
    await this.versionsService.remove(surveyId, versionId);
  }
}