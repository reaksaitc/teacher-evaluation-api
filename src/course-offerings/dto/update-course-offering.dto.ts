import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCourseOfferingDto {
  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  course_id?: string;

  @ApiPropertyOptional({ example: '2' })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  lecturer_id?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  semester_id?: string;

  @ApiPropertyOptional({ maxLength: 50, example: 'A' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  section_code?: string;
}