import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional } from 'class-validator';

export class CreateEvaluationDto {
  @ApiProperty({ example: '1' })
  @IsNumberString({ no_symbols: true })
  course_offering_id!: string;

  @ApiProperty({ example: '1' })
  @IsNumberString({ no_symbols: true })
  survey_version_id!: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  start_at?: string;

  @ApiPropertyOptional({ example: '2026-10-14T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  end_at?: string;
}