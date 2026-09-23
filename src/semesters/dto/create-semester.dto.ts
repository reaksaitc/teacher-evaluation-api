import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSemesterDto {
  @ApiProperty({ maxLength: 50, example: 'Semester 1' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  semester_name!: string;

  @ApiProperty({ maxLength: 20, example: '2025-2026' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  academic_year!: string;

  @ApiPropertyOptional({ example: '2025-10-01' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ example: '2026-02-28' })
  @IsOptional()
  @IsDateString()
  end_date?: string;
}