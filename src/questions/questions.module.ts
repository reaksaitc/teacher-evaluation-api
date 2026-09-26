import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { SurveyVersionsModule } from '../survey-versions/survey-versions.module';

@Module({
  imports: [SurveyVersionsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
})
export class QuestionsModule {}