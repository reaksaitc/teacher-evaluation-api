import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const userExample = {
  id: '9',
  email: 'newlecturer@itc.edu.kh',
  full_name: 'Keo Sophal',
  role: 'LECTURER',
  status: 'ACTIVE',
  created_at: '2026-09-23T08:00:00.000Z',
  updated_at: '2026-09-23T08:00:00.000Z',
};

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users, optionally filtered by role and/or status' })
  @ApiResponse({ status: 200, description: 'Array of users (never includes password_hash)', schema: { example: [userExample] } })
  @ApiResponse({ status: 400, description: 'Invalid role or status filter' })
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiParam({ name: 'id', type: String, example: '1' })
  @ApiResponse({ status: 200, description: 'The user', schema: { example: userExample } })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.usersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a user account' })
  @ApiResponse({ status: 201, description: 'User created', schema: { example: userExample } })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Email is already in use' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a user (name, email, status, or password). Role cannot be changed.' })
  @ApiParam({ name: 'id', type: String, example: '9' })
  @ApiResponse({ status: 200, description: 'User updated', schema: { example: userExample } })
  @ApiResponse({ status: 400, description: 'Invalid input, or trying to deactivate your own account' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email is already in use' })
  update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: { id: bigint },
  ) {
    return this.usersService.update(id, dto, currentUser.id);
  }
}