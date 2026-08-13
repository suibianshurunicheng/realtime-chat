import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@Req() req: Request) {
    const userId = (req.user as { sub: string }).sub;
    return this.users.getPublicById(userId);
  }

  @Get('search')
  search(@Req() req: Request, @Query('q') q: string) {
    const me = (req.user as { sub: string }).sub;
    return this.users.search(me, q ?? '');
  }
}
