import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { user_role, user_status } from '@prisma/client';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: user_role })
  @IsOptional()
  @IsEnum(user_role)
  role?: user_role;

  @ApiPropertyOptional({ enum: user_status })
  @IsOptional()
  @IsEnum(user_status)
  status?: user_status;
}