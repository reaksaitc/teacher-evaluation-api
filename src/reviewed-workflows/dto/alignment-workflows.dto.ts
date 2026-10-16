import { IsDatabaseId } from '../../common/validators/database-id.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsString,
  IsInt,
  Min,
  Max,
  Matches,
  IsUUID,
  ValidateNested,
  IsOptional,
  IsIn,
} from 'class-validator';
import { CreateEvaluationDto } from '../../evaluations/dto/create-evaluation.dto';
import { CreateCourseOfferingDto } from '../../course-offerings/dto/create-course-offering.dto';

export class AssignmentRowsDto {
  @ApiProperty({ type: [CreateCourseOfferingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateCourseOfferingDto)
  rows!: CreateCourseOfferingDto[];
}
export class AssignmentConfirmationDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(49)
  row_index!: number;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9]\d*$/, { each: true })
  @IsDatabaseId({ each: true })
  confirmed_student_ids!: string[];
}
export class ConfirmAssignmentsDto extends AssignmentRowsDto {
  @ApiProperty() @IsUUID('4') review_id!: string;
  @ApiProperty({ type: [AssignmentConfirmationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AssignmentConfirmationDto)
  confirmations!: AssignmentConfirmationDto[];
}
export class BulkEvaluationRowDto extends CreateEvaluationDto {
  @ApiProperty({ type: String }) declare survey_id: string;
  @ApiProperty({ type: String }) declare survey_version_id: string;
  @ApiProperty({ format: 'date-time' }) declare start_at: string;
  @ApiProperty({ format: 'date-time' }) declare end_at: string;
  @ApiProperty({ enum: ['ALL_ENROLLED'] })
  @IsIn(['ALL_ENROLLED'])
  declare participant_scope: 'ALL_ENROLLED';
}
export class BulkEvaluationsDto {
  @ApiProperty({ type: [BulkEvaluationRowDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkEvaluationRowDto)
  evaluations!: BulkEvaluationRowDto[];
}
export class BulkEvaluationConfirmationDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @IsDatabaseId()
  course_offering_id!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9]\d*$/, { each: true })
  @IsDatabaseId({ each: true })
  confirmed_student_ids!: string[];
}
export class ConfirmBulkEvaluationsDto extends BulkEvaluationsDto {
  @ApiProperty() @IsUUID('4') review_id!: string;
  @ApiProperty({ type: [BulkEvaluationConfirmationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkEvaluationConfirmationDto)
  confirmations!: BulkEvaluationConfirmationDto[];
}
export class EvaluationActivityQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({
    description: 'Opaque keyset cursor returned by the previous page',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,512}$/)
  cursor?: string;
}
