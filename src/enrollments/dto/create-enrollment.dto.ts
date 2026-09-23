import { ApiProperty } from '@nestjs/swagger';
import { IsNumberString } from 'class-validator';

export class CreateEnrollmentDto {
  @ApiProperty({ example: '5', description: 'id of a user with role STUDENT' })
  @IsNumberString({ no_symbols: true })
  student_id!: string;
}