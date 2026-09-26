import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCourseOfferingDto {
  @ApiProperty({ example: '1', description: 'id of an existing course' })
  @IsNumberString({ no_symbols: true })
  course_id!: string;

  @ApiProperty({ example: '2', description: 'id of a user with role LECTURER' })
  @IsNumberString({ no_symbols: true })
  lecturer_id!: string;

  @ApiProperty({ example: '1', description: 'id of an existing semester' })
  @IsNumberString({ no_symbols: true })
  semester_id!: string;

  @ApiPropertyOptional({ maxLength: 50, example: 'A' })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  section_code?: string;
}