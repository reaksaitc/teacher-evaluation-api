import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CourseOfferingsService } from './course-offerings.service';
import { CreateCourseOfferingDto } from './dto/create-course-offering.dto';
import { UpdateCourseOfferingDto } from './dto/update-course-offering.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

const offeringExample = {
  id: '1',
  course_id: '1',
  lecturer_id: '2',
  semester_id: '1',
  section_code: 'A',
  created_at: '2026-09-13T06:15:49.001Z',
  updated_at: '2026-09-13T06:15:49.001Z',
  courses: { id: '1', course_code: 'CS301', course_name: 'Database Systems' },
  semesters: { id: '1', semester_name: 'Semester 1', academic_year: '2025-2026' },
  users: { id: '2', full_name: 'Sok Dara', email: 'sokdara@itc.edu.kh' },
};

@ApiTags('course-offerings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('course-offerings')
export class CourseOfferingsController {
  constructor(private courseOfferingsService: CourseOfferingsService) {}

  @Get()
  @ApiOperation({ summary: 'List all course offerings' })
  @ApiResponse({ status: 200, description: 'Array of course offerings', schema: { example: [offeringExample] } })
  findAll() {
    return this.courseOfferingsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course offering by id' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'The course offering', schema: { example: offeringExample } })
  @ApiResponse({ status: 404, description: 'Course offering not found' })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.courseOfferingsService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Assign a lecturer to a course in a semester' })
  @ApiResponse({ status: 201, description: 'Course offering created', schema: { example: offeringExample } })
  @ApiResponse({ status: 400, description: 'Invalid input, unknown course/semester, or lecturer_id is not a LECTURER' })
  @ApiResponse({ status: 409, description: 'This course offering already exists' })
  create(@Body() dto: CreateCourseOfferingDto) {
    return this.courseOfferingsService.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a course offering' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'Course offering updated', schema: { example: offeringExample } })
  @ApiResponse({ status: 400, description: 'Invalid input, unknown course/semester, or lecturer_id is not a LECTURER' })
  @ApiResponse({ status: 404, description: 'Course offering not found' })
  @ApiResponse({ status: 409, description: 'This course offering already exists' })
  update(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateCourseOfferingDto) {
    return this.courseOfferingsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a course offering' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 204, description: 'Course offering deleted' })
  @ApiResponse({ status: 404, description: 'Course offering not found' })
  @ApiResponse({ status: 409, description: 'Course offering has enrollments or evaluations' })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.courseOfferingsService.remove(id);
  }
}