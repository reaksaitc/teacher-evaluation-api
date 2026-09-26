import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { question_type } from '@prisma/client';

export class UpdateQuestionDto {
  @ApiPropertyOptional({ example: 'The lecturer explains concepts clearly.' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  question_text?: string;

  @ApiPropertyOptional({ enum: question_type })
  @IsOptional()
  @IsEnum(question_type)
  question_type?: question_type;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  min_rating?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  max_rating?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  display_order?: number;
}