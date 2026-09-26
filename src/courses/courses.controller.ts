import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

const courseExample = {
  id: '1',
  course_code: 'CS101',
  course_name: 'Intro to Computer Science',
  description: 'Fundamentals of programming and computer science',
  created_at: '2026-01-15T08:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
};

@ApiTags('courses')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('courses')
export class CoursesController {
  constructor(private coursesService: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'List all courses' })
  @ApiResponse({
    status: 200,
    description: 'Array of courses',
    schema: { example: [courseExample] },
  })
  findAll() {
    return this.coursesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course by id' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'The course', schema: { example: courseExample } })
  @ApiResponse({
    status: 404,
    description: 'Course not found',
    schema: { example: { statusCode: 404, message: 'Course not found', error: 'Not Found' } },
  })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.coursesService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a course' })
  @ApiResponse({ status: 201, description: 'Course created', schema: { example: courseExample } })
  @ApiResponse({
    status: 409,
    description: 'course_code already exists',
    schema: { example: { statusCode: 409, message: 'course_code already exists', error: 'Conflict' } },
  })
  create(@Body() dto: CreateCourseDto) {
    return this.coursesService.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a course' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Course updated',
    schema: { example: { ...courseExample, updated_at: '2026-01-16T10:30:00.000Z' } },
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found',
    schema: { example: { statusCode: 404, message: 'Course not found', error: 'Not Found' } },
  })
  @ApiResponse({
    status: 409,
    description: 'course_code already exists',
    schema: { example: { statusCode: 409, message: 'course_code already exists', error: 'Conflict' } },
  })
  update(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateCourseDto) {
    return this.coursesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a course' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 204, description: 'Course deleted' })
  @ApiResponse({
    status: 404,
    description: 'Course not found',
    schema: { example: { statusCode: 404, message: 'Course not found', error: 'Not Found' } },
  })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.coursesService.remove(id);
  }
}