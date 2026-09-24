import { Module } from '@nestjs/common';
import { LecturerDashboardController } from './lecturer-dashboard.controller';
import { LecturerDashboardService } from './lecturer-dashboard.service';

@Module({
  controllers: [LecturerDashboardController],
  providers: [LecturerDashboardService],
  exports: [LecturerDashboardService],
})
export class LecturerDashboardModule {}