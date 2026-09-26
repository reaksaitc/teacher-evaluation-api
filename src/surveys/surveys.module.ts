import { Module } from '@nestjs/common';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  controllers: [SurveysController],
  providers: [SurveysService]
})
export class SurveysModule {}
