import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCourseDto {
  @ApiPropertyOptional({
    maxLength: 30,
    example: 'CS101',
    description: 'Omit to allocate a department-prefixed code atomically',
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  course_code?: string;

  @ApiPropertyOptional({
    description:
      'Stable 8–128 character retry key. Reuse with unchanged input after a lost response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotency_key?: string;

  @ApiProperty({
    maxLength: 150,
    example: 'Intro to Computer Science',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  course_name!: string;

  @ApiPropertyOptional({
    example: 'Fundamentals of programming and computer science',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 1,
    description: 'Owning department ID',
  })
  @IsInt()
  @Min(1)
  department_id!: number;
}
