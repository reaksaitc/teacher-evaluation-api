import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

const enrollmentExample = {
  id: '1',
  student_id: '4',
  course_offering_id: '1',
  enrolled_at: '2026-09-13T06:15:49.001Z',
  users: { id: '4', full_name: 'Student 1', email: 'student1@itc.edu.kh' },
};

@ApiTags('enrollments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiParam({ name: 'offeringId', type: String, example: '1' })
@Controller('course-offerings/:offeringId/enrollments')
export class EnrollmentsController {
  constructor(private enrollmentsService: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List students enrolled in a course offering' })
  @ApiResponse({ status: 200, description: 'Array of enrollments', schema: { example: [enrollmentExample] } })
  @ApiResponse({ status: 404, description: 'Course offering not found' })
  findAll(@Param('offeringId', ParseBigIntPipe) offeringId: bigint) {
    return this.enrollmentsService.findAllForOffering(offeringId);
  }

  @Post()
  @ApiOperation({ summary: 'Enroll a student in a course offering' })
  @ApiResponse({ status: 201, description: 'Student enrolled', schema: { example: enrollmentExample } })
  @ApiResponse({ status: 400, description: 'Invalid input or student_id is not a STUDENT' })
  @ApiResponse({ status: 404, description: 'Course offering not found' })
  @ApiResponse({ status: 409, description: 'Student is already enrolled in this course offering' })
  create(
    @Param('offeringId', ParseBigIntPipe) offeringId: bigint,
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollmentsService.create(offeringId, dto);
  }

  @Delete(':studentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a student from a course offering' })
  @ApiParam({ name: 'studentId', type: String, example: '4' })
  @ApiResponse({ status: 204, description: 'Student removed' })
  @ApiResponse({ status: 404, description: 'Course offering not found, or student is not enrolled' })
  async remove(
    @Param('offeringId', ParseBigIntPipe) offeringId: bigint,
    @Param('studentId', ParseBigIntPipe) studentId: bigint,
  ) {
    await this.enrollmentsService.remove(offeringId, studentId);
  }
}