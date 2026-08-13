import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { FriendsService } from '../friends/friends.service';
import { PresenceService, UserPresence } from './presence.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/**
 * REST read of friend presence. Lives in the realtime module (not FriendsModule)
 * so the dependency is one-directional: RealtimeModule → FriendsModule. Friendship
 * queries come from FriendsService; online state comes from PresenceService.
 *
 * Returns ONLY the caller's friends — a non-friend can never learn another user's
 * presence through this endpoint. No new DB table; purely an in-memory projection.
 */
@Controller('friends')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(
    private readonly friends: FriendsService,
    private readonly presence: PresenceService,
  ) {}

  private me(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  @Get('presence')
  async presenceOfFriends(@Req() req: Request): Promise<UserPresence[]> {
    const me = this.me(req);
    const friendIds = await this.friends.listFriendIds(me);
    return this.presence.getStatuses(friendIds);
  }
}
