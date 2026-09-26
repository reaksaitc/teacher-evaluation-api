import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LecturerDashboardModule } from '../lecturer-dashboard/lecturer-dashboard.module';

@Module({
  imports: [LecturerDashboardModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}