import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CreateSurveyVersionDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Copy all questions from the latest existing version into the new one',
  })
  @IsOptional()
  @IsBoolean()
  copy_questions?: boolean;
}