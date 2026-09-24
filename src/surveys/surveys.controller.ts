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

import { SurveysService } from './surveys.service';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('surveys')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('surveys')
export class SurveysController {
  constructor(private surveysService: SurveysService) {}

  @Get()
  @ApiOperation({ summary: 'List survey templates with their versions' })
  @ApiResponse({
    status: 200,
    description: 'Survey templates returned successfully',
  })
  findAll() {
    return this.surveysService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a survey template with its versions' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Survey returned successfully',
  })
  @ApiResponse({ status: 404, description: 'Survey not found' })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.surveysService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a survey template (creator is taken from the token)',
  })
  @ApiResponse({ status: 201, description: 'Survey created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  create(
    @Body() dto: CreateSurveyDto,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.surveysService.create(dto, currentUser.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a survey template' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Survey updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Survey not found' })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateSurveyDto,
  ) {
    return this.surveysService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a survey template that has no versions',
  })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 204,
    description: 'Survey deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Survey not found' })
  @ApiResponse({
    status: 409,
    description: 'Survey has versions and cannot be deleted',
  })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.surveysService.remove(id);
  }
}