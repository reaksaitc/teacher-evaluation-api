import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { class_type } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CourseOfferingGroupScopeDto } from './course-offering-group-scope.dto';

export class CreateCourseOfferingDto {
  @ApiProperty({
    example: '1',
    description: 'ID of an existing course',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  course_id!: string;

  @ApiProperty({
    example: '2',
    description: 'ID of a user with role LECTURER',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  lecturer_id!: string;

  @ApiProperty({
    example: '1',
    description: 'ID of an existing semester',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  semester_id!: string;

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description: 'Student year level intended for this course offering',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  year_level?: number;

  @ApiProperty({
    example: class_type.COURSE,
    enum: class_type,
    description: 'Required class type for a new course offering',
  })
  @IsEnum(class_type)
  class_type!: class_type;

  @ApiPropertyOptional({
    maxLength: 50,
    example: 'A',
    description: 'Optional section or class code',
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  section_code?: string;

  @ApiPropertyOptional({
    type: [CourseOfferingGroupScopeDto],
    description: 'Explicit student group scopes served by this offering',
    example: [
      {
        academic_year_id: '1',
        generation_id: '2',
        major_id: '3',
        year_level: 4,
        class_groups: ['A', 'B'],
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseOfferingGroupScopeDto)
  group_scopes?: CourseOfferingGroupScopeDto[];
}
