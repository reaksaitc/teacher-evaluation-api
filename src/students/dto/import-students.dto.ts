import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { Transform } from 'class-transformer';
import { generationNumber } from '../../student-generations/generation-identity.util';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One student row parsed by the frontend from CSV/XLSX.
 *
 * Spreadsheet mapping:
 * ID     -> student_code
 * Name   -> full_name
 * Gender -> gender
 * Major  -> major
 * Other  -> notes
 *
 * The spreadsheet "No." column is intentionally ignored.
 */
export class ImportStudentRowDto {
  @ApiProperty({
    example: 'e20221111',
    description: 'Student ID/code from the imported spreadsheet',
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  student_code!: string;

  @ApiPropertyOptional({
    example: 'DIN Reaksa',
    description:
      'Optional student name. When omitted or blank, the normalized student code is used.',
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  full_name?: string;

  @ApiPropertyOptional({
    enum: gender,
    example: 'MALE',
    description: 'Optional student gender. When omitted, gender remains null.',
  })
  @IsOptional()
  @IsEnum(gender)
  gender?: gender;

  @ApiProperty({
    example: 'AMS',
    description: 'Existing major code or exact major name',
    maxLength: 150,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  major!: string;

  @ApiPropertyOptional({
    example: 'Imported from 2026 student list',
    description: 'Optional value from the spreadsheet Other column',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportStudentsDto {
  @ApiProperty({
    type: String,
    description: 'All rows must resolve to this major',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @IsDatabaseId()
  major_id!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647, type: Number })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : generationNumber(value)))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  generation_number?: number;
  @ApiPropertyOptional({
    example: 'Gen 43',
    description: 'Generation name applied to every student in this import',
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  generation?: string;

  @ApiPropertyOptional({
    example: '1',
    type: String,
    description:
      'Required when the generation does not already exist. Entry academic year used when creating the new generation.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/, {
    message: 'entry_academic_year_id must be a positive integer',
  })
  @IsDatabaseId()
  entry_academic_year_id?: string;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    maximum: 5,
    description:
      'Starting year level used when a new generation must be created',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starting_year_level?: number;

  @ApiProperty({
    example: '1',
    type: String,
    description:
      'Academic year for the initial academic placement of imported students',
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
    minimum: 1,
    maximum: 5,
    description: 'Initial year level applied to imported students',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  year_level!: number;

  @ApiPropertyOptional({
    example: 'AMS1-A',
    maxLength: 50,
    description:
      'Optional initial class/group applied to every imported student',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  class_group?: string;

  @ApiPropertyOptional({
    example: 'password@1235',
    default: 'password@1235',
    minLength: 6,
    maxLength: 72,
    description:
      'Initial password for newly created students. Omitted or blank uses password@1235.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(72)
  initial_password?: string;

  @ApiProperty({
    type: [ImportStudentRowDto],
    description:
      'Students parsed from the CSV/XLSX file by the frontend. Maximum 500 rows.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({
    each: true,
  })
  @Type(() => ImportStudentRowDto)
  students!: ImportStudentRowDto[];
}
