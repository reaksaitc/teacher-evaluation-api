import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class UpdateScheduleDto {
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  start_at?: string;

  @ApiPropertyOptional({ example: '2026-10-14T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  end_at?: string;
}