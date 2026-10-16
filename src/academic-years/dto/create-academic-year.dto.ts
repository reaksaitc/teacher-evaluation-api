import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';

export class SetupSemesterDatesDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  start_date?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  end_date?: string | null;
}

export class CreateAcademicYearDto {
  @ApiPropertyOptional({
    description:
      'Stable retry key; required by atomic setup/recovery endpoints',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotency_key?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Explicitly create missing Semester 1 and 2 in the same transaction',
  })
  @IsOptional()
  @IsBoolean()
  create_semesters?: boolean;

  @ApiPropertyOptional({
    type: [SetupSemesterDatesDto],
    description: 'Optional Semester 1 and 2 dates in number order',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => SetupSemesterDatesDto)
  semesters?: SetupSemesterDatesDto[];
  @ApiProperty({
    maxLength: 20,
    example: '2026-2027',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  name!: string;

  @ApiPropertyOptional({
    example: 2026,
    description:
      'Numeric starting year used for generation year-level calculation',
  })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  start_year?: number;

  @ApiPropertyOptional({
    example: '2026-10-01',
    type: String,
    nullable: true,
    description:
      'Stored as a UTC calendar date. ISO datetimes without an offset also mean UTC; time of day is discarded.',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string | null;

  @ApiPropertyOptional({
    example: '2027-07-31',
    type: String,
    nullable: true,
    description:
      'Stored as a UTC calendar date; must follow start_date when both dates are supplied. Null clears this optional date.',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string | null;

  @ApiPropertyOptional({
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
