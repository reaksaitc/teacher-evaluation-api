import { AlignmentWorkflowsController } from './alignment-workflows.controller';
import { Global, Module } from '@nestjs/common';
import { ReviewedWorkflowsController } from './reviewed-workflows.controller';
import { ReviewedWorkflowsService } from './reviewed-workflows.service';

@Global()
@Module({
  controllers: [AlignmentWorkflowsController, ReviewedWorkflowsController],
  providers: [ReviewedWorkflowsService],
  exports: [ReviewedWorkflowsService],
})
export class ReviewedWorkflowsModule {}
