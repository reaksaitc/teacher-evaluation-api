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

import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

const academicYearExample = {
  id: '1',
  name: '2026-2027',
  start_date: '2026-10-01T00:00:00.000Z',
  end_date: '2027-07-31T00:00:00.000Z',
  is_active: true,
  created_at: '2026-09-29T10:00:00.000Z',
  updated_at: '2026-09-29T10:00:00.000Z',
};

@ApiTags('academic-years')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Get()
  @ApiOperation({ summary: 'List all academic years' })
  @ApiResponse({
    status: 200,
    description: 'Array of academic years',
    schema: { example: [academicYearExample] },
  })
  findAll() {
    return this.academicYearsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an academic year by id' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Academic year',
    schema: { example: academicYearExample },
  })
  @ApiResponse({
    status: 404,
    description: 'Academic year not found',
  })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.academicYearsService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create an academic year' })
  @ApiResponse({
    status: 201,
    description: 'Academic year created',
    schema: { example: academicYearExample },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or end_date is not after start_date',
  })
  @ApiResponse({
    status: 409,
    description:
      'Academic year already exists or activation conflicts with another change',
  })
  create(
    @Body() dto: CreateAcademicYearDto,
    @CurrentUser() actor: { id: bigint },
  ) {
    return this.academicYearsService.create(dto, actor.id);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update an academic year' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 200,
    description: 'Academic year updated',
    schema: { example: academicYearExample },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or end_date is not after start_date',
  })
  @ApiResponse({
    status: 404,
    description: 'Academic year not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Academic year already exists, activation conflicts, or curriculum protects start_year',
  })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateAcademicYearDto,
  ) {
    return this.academicYearsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an academic year' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({
    status: 204,
    description: 'Academic year deleted',
  })
  @ApiResponse({
    status: 404,
    description: 'Academic year not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Academic year is used by semesters',
  })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.academicYearsService.remove(id);
  }
}
