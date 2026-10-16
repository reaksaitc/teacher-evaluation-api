import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { StudentGenerationsService } from './student-generations.service';
import { CreateStudentGenerationDto } from './dto/create-student-generation.dto';
import { UpdateStudentGenerationDto } from './dto/update-student-generation.dto';

import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';

const studentGenerationExample = {
  id: '1',
  name: 'Gen 43',
  entry_academic_year_id: '1',
  starting_year_level: 1,
  created_at: '2026-10-04T06:30:00.000Z',
  updated_at: '2026-10-04T06:30:00.000Z',
  entry_academic_year: {
    id: '1',
    name: '2025-2026',
    start_year: 2025,
  },
  _count: {
    students: 0,
    evaluation_targets: 0,
  },
};

@ApiTags('student-generations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('student-generations')
export class StudentGenerationsController {
  constructor(
    private readonly studentGenerationsService: StudentGenerationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all student generations',
  })
  @ApiResponse({
    status: 200,
    description: 'List of student generations',
    schema: {
      example: [studentGenerationExample],
    },
  })
  findAll() {
    return this.studentGenerationsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a student generation by ID',
  })
  @ApiParam({
    name: 'id',
    example: '1',
    description: 'Student generation ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Student generation found',
    schema: {
      example: studentGenerationExample,
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Student generation not found',
  })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.studentGenerationsService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create a student generation',
  })
  @ApiBody({
    type: CreateStudentGenerationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Student generation created successfully',
    schema: {
      example: studentGenerationExample,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input; starting_year_level must be between 1 and 5',
  })
  @ApiResponse({
    status: 404,
    description: 'Academic year not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Student generation already exists',
  })
  create(
    @Body()
    createStudentGenerationDto: CreateStudentGenerationDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.studentGenerationsService.create(
      createStudentGenerationDto,
      actor.id,
    );
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Update a student generation',
  })
  @ApiParam({
    name: 'id',
    example: '1',
    description: 'Student generation ID',
  })
  @ApiBody({
    type: UpdateStudentGenerationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Student generation updated successfully',
    schema: {
      example: studentGenerationExample,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input; starting_year_level must be between 1 and 5',
  })
  @ApiResponse({
    status: 404,
    description: 'Student generation or academic year not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Student generation already exists or is currently in use',
  })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body()
    updateStudentGenerationDto: UpdateStudentGenerationDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.studentGenerationsService.update(
      id,
      updateStudentGenerationDto,
      actor.id,
    );
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Delete a student generation',
  })
  @ApiParam({
    name: 'id',
    example: '1',
    description: 'Student generation ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Student generation deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Student generation not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Student generation has students or evaluation references and cannot be deleted',
  })
  remove(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.studentGenerationsService.remove(id);
  }
}
