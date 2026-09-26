import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { user_role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ maxLength: 255, example: 'newlecturer@itc.edu.kh' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ minLength: 6, maxLength: 72, example: 'Password123' })
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ maxLength: 150, example: 'Keo Sophal' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  full_name!: string;

  @ApiProperty({ enum: user_role, example: 'LECTURER' })
  @IsEnum(user_role)
  role!: user_role;
}