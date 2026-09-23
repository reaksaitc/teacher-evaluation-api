import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSurveyDto {
  @ApiProperty({ maxLength: 200, example: 'Teaching Quality Evaluation 2026-2027' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'Standard department evaluation form' })
  @IsOptional()
  @IsString()
  description?: string;
}