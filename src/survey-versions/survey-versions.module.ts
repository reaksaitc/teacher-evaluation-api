import { Module } from '@nestjs/common';
import { SurveyVersionsController } from './survey-versions.controller';
import { SurveyVersionsService } from './survey-versions.service';

@Module({
  controllers: [SurveyVersionsController],
  providers: [SurveyVersionsService],
  exports: [SurveyVersionsService],
})
export class SurveyVersionsModule {}