import { CurrentUser } from '../common/decorators/current-user.decorator';
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

import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';

import { CourseOfferingsService } from './course-offerings.service';
import { CreateCourseOfferingDto } from './dto/create-course-offering.dto';
import { UpdateCourseOfferingDto } from './dto/update-course-offering.dto';

const offeringExample = {
  id: '1',
  course_id: '1',
  lecturer_id: '2',
  semester_id: '1',
  section_code: 'A',
  year_level: 4,
  class_type: 'COURSE',
  group_scopes: [
    {
      id: '1',
      academic_year_id: '1',
      generation_id: '1',
      major_id: '1',
      year_level: 4,
      class_group: 'A',
      curriculum_revision_id: '12',
      curriculum_revision: {
        id: '12',
        rule_id: '3',
        revision_no: 1,
        effective_academic_year_id: '1',
        effective_start_year: 2025,
        enabled: true,
      },
    },
  ],
  created_at: '2026-09-13T06:15:49.001Z',
  updated_at: '2026-09-13T06:15:49.001Z',

  courses: {
    id: '1',
    course_code: 'CS301',
    course_name: 'Database Systems',
  },

  semesters: {
    id: '1',
    semester_name: 'Semester 1',
    semester_number: 1,
    academic_year_id: '1',

    academic_years: {
      id: '1',
      name: '2025-2026',
      start_year: 2025,
      is_active: true,
    },
  },

  users: {
    id: '2',
    full_name: 'Sok Dara',
    email: 'sokdara@itc.edu.kh',
  },
};

@ApiTags('course-offerings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('course-offerings')
export class CourseOfferingsController {
  constructor(
    private readonly courseOfferingsService: CourseOfferingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all course offerings',
    description:
      'Returns course offerings with course, lecturer, semester, academic year, student year level, and class type information.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of course offerings',
    schema: {
      example: [offeringExample],
    },
  })
  findAll(@CurrentUser() actor: { id: bigint }) {
    return this.courseOfferingsService.findAll(actor.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a course offering by id',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'The course offering',
    schema: {
      example: offeringExample,
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Course offering not found',
  })
  findOne(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.courseOfferingsService.findOne(id, actor.id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Assign a lecturer to a course in a semester',
    description:
      'Creates a course offering. For revisioned course/major curricula, each explicit group scope must have an enabled applicable academic-year revision. An optional curriculum_revision_id detects stale selection; omission resolves automatically. Untracked legacy scopes remain unversioned. Class type is COURSE, TD or TP.',
  })
  @ApiResponse({
    status: 201,
    description: 'Course offering created',
    schema: {
      example: offeringExample,
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input, unknown course/semester, lecturer_id is not a LECTURER, or lecturer is inactive',
  })
  @ApiResponse({
    status: 409,
    description:
      'Duplicate offering, no applicable enabled curriculum revision, or obsolete/mismatched selected revision',
  })
  create(
    @Body() dto: CreateCourseOfferingDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.courseOfferingsService.create(dto, actor.id);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Update a course offering',
    description:
      'An offering with any evaluation (including DRAFT) retains its course, lecturer and semester; a changed teaching assignment requires a new offering. Unchanged IDs and permitted display metadata remain editable. Curriculum-bound offerings also retain year level, groups and saved revisions. Resending identical groups keeps saved rows and does not revalidate against a later withdrawal.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Course offering updated',
    schema: {
      example: offeringExample,
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input, unknown course/semester, lecturer_id is not a LECTURER, or lecturer is inactive',
  })
  @ApiResponse({
    status: 404,
    description: 'Course offering not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'OFFERING_HISTORY_PROTECTED for changed course/lecturer/semester on an evaluated offering; duplicate offering, protected curriculum context, or obsolete/inapplicable curriculum revision',
  })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateCourseOfferingDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.courseOfferingsService.update(id, dto, actor.id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a course offering',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: '1',
  })
  @ApiResponse({
    status: 204,
    description: 'Course offering deleted',
  })
  @ApiResponse({
    status: 404,
    description: 'Course offering not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Course offering has enrollments or evaluations',
  })
  async remove(
    @Param('id', ParseBigIntPipe) id: bigint,
    @CurrentUser() actor: { id: bigint },
  ) {
    await this.courseOfferingsService.remove(id, actor.id);
  }
}
