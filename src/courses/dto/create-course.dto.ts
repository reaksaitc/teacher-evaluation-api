import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty({ maxLength: 30, example: 'CS101' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  course_code!: string;

  @ApiProperty({ maxLength: 150, example: 'Intro to Computer Science' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  course_name!: string;

  @ApiPropertyOptional({ example: 'Fundamentals of programming and computer science' })
  @IsOptional()
  @IsString()
  description?: string;
}