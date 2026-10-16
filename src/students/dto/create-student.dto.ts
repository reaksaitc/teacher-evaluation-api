import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { gender } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStudentDto {
  @ApiProperty({
    example: 'e20221111',
    description: 'Unique student code',
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  student_code!: string;

  @ApiProperty({
    example: 'DIN Reaksa',
    description: 'Student full name',
    maxLength: 150,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  full_name!: string;

  @ApiPropertyOptional({
    example: 'student@itc.edu.kh',
    description: 'Optional email address for the student',
    maxLength: 255,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    enum: gender,
    example: 'MALE',
    description: 'Student gender',
  })
  @IsOptional()
  @IsEnum(gender)
  gender?: gender;

  @ApiProperty({
    example: 'Password123',
    minLength: 6,
    maxLength: 72,
    description: 'Initial student password',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    example: '1',
    description: 'Student generation ID',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'generation_id must be a positive integer',
  })
  @IsDatabaseId()
  generation_id!: string;

  @ApiProperty({
    example: '1',
    description: 'Academic year ID for the initial academic placement',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'academic_year_id must be a positive integer',
  })
  @IsDatabaseId()
  academic_year_id!: string;

  @ApiProperty({
    example: 1,
    description: 'Student year level for the initial academic placement',
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  year_level!: number;

  @ApiProperty({
    example: '1',
    description: 'Major ID for the initial academic placement',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'major_id must be a positive integer',
  })
  @IsDatabaseId()
  major_id!: string;

  @ApiPropertyOptional({
    example: 'AMS1-A',
    description: 'Optional class/group for the initial academic placement',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  class_group?: string;

  @ApiPropertyOptional({
    example: 'Imported from 2026 student list',
    description: 'Optional administrative notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
