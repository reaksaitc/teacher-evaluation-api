import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LecturerDashboardService } from './lecturer-dashboard.service';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('lecturer')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('LECTURER')
@Controller('lecturer/evaluations')
export class LecturerDashboardController {
  constructor(private dashboardService: LecturerDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'My evaluations (open or closed) with response counts' })
  findMine(@CurrentUser() currentUser: { id: bigint }) {
    return this.dashboardService.findMyEvaluations(currentUser.id);
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Aggregated, anonymous results of one of my closed evaluations' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 403, description: 'Not my evaluation' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 409, description: 'Evaluation is not closed yet' })
  getDashboard(@Param('id', ParseBigIntPipe) id: bigint, @CurrentUser() currentUser: { id: bigint }) {
    return this.dashboardService.getDashboard(id, currentUser.id);
  }
}