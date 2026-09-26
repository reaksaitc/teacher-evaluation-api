import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { evaluation_status } from '@prisma/client';

export class ListEvaluationsQueryDto {
  @ApiPropertyOptional({ enum: evaluation_status })
  @IsOptional()
  @IsEnum(evaluation_status)
  status?: evaluation_status;
}