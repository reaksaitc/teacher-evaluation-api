import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { question_type } from '@prisma/client';

export class CreateQuestionDto {
  @ApiProperty({ example: 'The lecturer explains concepts clearly.' })
  @IsNotEmpty()
  @IsString()
  question_text!: string;

  @ApiProperty({ enum: question_type, example: 'RATING' })
  @IsEnum(question_type)
  question_type!: question_type;

  @ApiPropertyOptional({ maxLength: 100, example: 'Teaching' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true' })
  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'RATING only; defaults to 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  min_rating?: number;

  @ApiPropertyOptional({ example: 5, description: 'RATING only; defaults to 5' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  max_rating?: number;

  @ApiPropertyOptional({ example: 1, description: 'Defaults to the end of the list' })
  @IsOptional()
  @IsInt()
  @Min(1)
  display_order?: number;
}