import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumberString,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EvaluationGroupScopeDto {
  @ApiProperty({
    example: '1',
    description:
      'Academic year of the student placement used for group targeting',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  academic_year_id!: string;

  @ApiProperty({
    example: '2',
    description: 'Generation whose student placements are targeted',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  generation_id!: string;

  @ApiProperty({
    example: '3',
    description: 'Major of the targeted student placements',
  })
  @IsNumberString({ no_symbols: true })
  @IsDatabaseId()
  major_id!: string;

  @ApiProperty({
    example: 4,
    minimum: 1,
    maximum: 5,
    description: 'Year level of the targeted student placements',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  year_level!: number;

  @ApiProperty({
    type: [String],
    example: ['A'],
    description: 'One or more class groups within this exact academic context',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  class_groups!: string[];
}
