import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SemestersService } from './semesters.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

const semesterExample = {
  id: '1',
  semester_name: 'Semester 1',
  academic_year: '2025-2026',
  start_date: '2025-10-01T00:00:00.000Z',
  end_date: '2026-02-28T00:00:00.000Z',
  created_at: '2026-09-13T06:15:49.001Z',
  updated_at: '2026-09-13T06:15:49.001Z',
};

@ApiTags('semesters')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('semesters')
export class SemestersController {
  constructor(private semestersService: SemestersService) {}

  @Get()
  @ApiOperation({ summary: 'List all semesters' })
  @ApiResponse({ status: 200, description: 'Array of semesters', schema: { example: [semesterExample] } })
  findAll() {
    return this.semestersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a semester by id' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'The semester', schema: { example: semesterExample } })
  @ApiResponse({ status: 404, description: 'Semester not found' })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.semestersService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a semester' })
  @ApiResponse({ status: 201, description: 'Semester created', schema: { example: semesterExample } })
  @ApiResponse({ status: 400, description: 'Invalid input or end_date is not after start_date' })
  @ApiResponse({ status: 409, description: 'Semester already exists for that academic year' })
  create(@Body() dto: CreateSemesterDto) {
    return this.semestersService.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a semester' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'Semester updated', schema: { example: semesterExample } })
  @ApiResponse({ status: 400, description: 'Invalid input or end_date is not after start_date' })
  @ApiResponse({ status: 404, description: 'Semester not found' })
  @ApiResponse({ status: 409, description: 'Semester already exists for that academic year' })
  update(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateSemesterDto) {
    return this.semestersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a semester' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 204, description: 'Semester deleted' })
  @ApiResponse({ status: 404, description: 'Semester not found' })
  @ApiResponse({ status: 409, description: 'Semester is used by course offerings' })
  async remove(@Param('id', ParseBigIntPipe) id: bigint) {
    await this.semestersService.remove(id);
  }
}