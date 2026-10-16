import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { evaluation_participant_scope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { EvaluationGroupScopeDto } from './evaluation-group-scope.dto';
import { OptionalReviewDto } from '../../common/dto/optional-review.dto';

export class EvaluationTargetingDto extends OptionalReviewDto {
  @ApiPropertyOptional({
    enum: evaluation_participant_scope,
    example: evaluation_participant_scope.ALL_ENROLLED,
    default: evaluation_participant_scope.ALL_ENROLLED,
    description:
      'Controls the base enrolled-student scope. Group scope, when supplied, further restricts this enrolled population.',
  })
  @IsOptional()
  @IsEnum(evaluation_participant_scope)
  participant_scope?: evaluation_participant_scope;

  @ApiPropertyOptional({
    type: [String],
    example: ['1', '2'],
    description:
      'Required when participant_scope is SELECTED_GENERATIONS. Each value must be a valid generation ID.',
  })
  @ValidateIf(
    (dto: EvaluationTargetingDto) =>
      dto.participant_scope ===
      evaluation_participant_scope.SELECTED_GENERATIONS,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({
    each: true,
  })
  @Matches(/^[1-9]\d*$/, {
    each: true,
    message: 'Each generation_id must be a positive integer',
  })
  @IsDatabaseId({ each: true })
  generation_ids?: string[];

  @ApiPropertyOptional({
    type: EvaluationGroupScopeDto,
    description:
      'Optional explicit class-group restriction. The group is interpreted only within the supplied academic year, generation, major, and year level.',
    example: {
      academic_year_id: '10',
      generation_id: '5',
      major_id: '2',
      year_level: 4,
      class_groups: ['A'],
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EvaluationGroupScopeDto)
  group_scope?: EvaluationGroupScopeDto;

  @ApiPropertyOptional({
    type: [EvaluationGroupScopeDto],
    description:
      'Union of explicit group contexts, intersected with offering enrollment and other audience restrictions. Do not combine with group_scope.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => EvaluationGroupScopeDto)
  group_scopes?: EvaluationGroupScopeDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Independent major restriction. Omit for all eligible enrolled majors; an empty array is invalid.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9]\d*$/, { each: true })
  @IsDatabaseId({ each: true })
  major_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['21', '24', '30'],
    description:
      'Exact eligible student user IDs returned by preview. Confirmation uses these IDs to detect eligibility drift after preview.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({
    each: true,
  })
  @Matches(/^[1-9]\d*$/, {
    each: true,
    message: 'Each confirmed_student_id must be a positive integer',
  })
  @IsDatabaseId({ each: true })
  confirmed_student_ids?: string[];
}
