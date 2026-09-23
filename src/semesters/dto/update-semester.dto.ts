import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSemesterDto {
  @ApiPropertyOptional({ maxLength: 50, example: 'Semester 1' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  semester_name?: string;

  @ApiPropertyOptional({ maxLength: 20, example: '2025-2026' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  academic_year?: string;

  @ApiPropertyOptional({ example: '2025-10-01' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ example: '2026-02-28' })
  @IsOptional()
  @IsDateString()
  end_date?: string;
}