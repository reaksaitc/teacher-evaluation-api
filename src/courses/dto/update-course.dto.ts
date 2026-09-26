import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCourseDto {
  @ApiPropertyOptional({ maxLength: 30, example: 'CS101' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  course_code?: string;

  @ApiPropertyOptional({ maxLength: 150, example: 'Intro to Computer Science' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  course_name?: string;

  @ApiPropertyOptional({ example: 'Fundamentals of programming and computer science' })
  @IsOptional()
  @IsString()
  description?: string;
}