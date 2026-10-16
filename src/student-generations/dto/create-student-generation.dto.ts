import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { Transform } from 'class-transformer';
import { generationNumber } from '../generation-identity.util';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class CreateStudentGenerationDto {
  @ApiProperty({
    type: String,
    description: 'Owning major ID; cohort numbers are independent per major',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @IsDatabaseId()
  major_id!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 2147483647 })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : generationNumber(value)))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  generation_number?: number;
  @ApiPropertyOptional({
    example: 'Gen 43',
    description:
      'Compatibility numeric alias (5, 05, Gen 5); requires explicit major_id. Prefer generation_number.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    example: '1',
    description:
      'Academic year ID when this generation entered the institution',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'entry_academic_year_id must be a positive integer',
  })
  @IsDatabaseId()
  entry_academic_year_id!: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Starting year level of the generation, normally 1',
    default: 1,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starting_year_level?: number;
}
