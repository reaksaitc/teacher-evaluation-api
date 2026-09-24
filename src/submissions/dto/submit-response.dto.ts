import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @ApiProperty({ example: '12' })
  @IsNumberString({ no_symbols: true })
  question_id!: string;

  @ApiPropertyOptional({ example: 5, description: 'For RATING questions' })
  @IsOptional()
  @IsInt()
  rating_value?: number;

  @ApiPropertyOptional({ example: 'Clear explanations.', description: 'For TEXT questions' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text_value?: string;
}

export class SubmitResponseDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}