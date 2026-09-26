import { Module } from '@nestjs/common';
import { StudentAccessController } from './student-access.controller';
import { StudentAccessService } from './student-access.service';

@Module({
  controllers: [StudentAccessController],
  providers: [StudentAccessService],
  exports: [StudentAccessService],
})
export class StudentAccessModule {}