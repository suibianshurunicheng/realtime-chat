import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FriendsService } from './friends.service';
import { SendRequestDto } from './dto/send-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  private me(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  @Post('requests')
  send(@Req() req: Request, @Body() dto: SendRequestDto) {
    return this.friends.sendRequest(this.me(req), dto.addresseeId);
  }

  @Get('requests')
  received(@Req() req: Request) {
    return this.friends.listReceived(this.me(req));
  }

  @Post('requests/:id/accept')
  accept(@Req() req: Request, @Param('id') id: string) {
    return this.friends.accept(this.me(req), id);
  }

  @Post('requests/:id/reject')
  reject(@Req() req: Request, @Param('id') id: string) {
    return this.friends.reject(this.me(req), id);
  }

  @Delete('requests/:id')
  cancel(@Req() req: Request, @Param('id') id: string) {
    return this.friends.cancel(this.me(req), id);
  }

  @Get()
  list(@Req() req: Request) {
    return this.friends.listFriends(this.me(req));
  }

  @Delete(':userId')
  remove(@Req() req: Request, @Param('userId') userId: string) {
    return this.friends.removeFriend(this.me(req), userId);
  }
}
