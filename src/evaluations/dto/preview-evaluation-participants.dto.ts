import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { EvaluationTargetingDto } from './evaluation-targeting.dto';

export class PreviewEvaluationParticipantsDto extends EvaluationTargetingDto {
  @ApiProperty({
    type: String,
    description:
      'Offering whose eligible enrollments are intersected with the audience',
  })
  @IsString()
  @Matches(/^[1-9]\d*$/)
  course_offering_id!: string;
}
