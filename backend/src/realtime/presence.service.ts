import { Injectable } from '@nestjs/common';

export interface PresenceResult {
  /** True only when the user's online/offline state actually flipped. */
  changed: boolean;
  /** Current online state after the operation (Set.size > 0). */
  online: boolean;
}

export interface UserPresence {
  userId: string;
  online: boolean;
}

/**
 * In-process presence tracker for the single-instance Socket.IO deployment.
 *
 * State is a plain `Map<userId, Set<socketId>>` — no DB table, no Redis. A user
 * is "online" iff the set is non-empty, so a single user with multiple devices
 * (PC + phone + browser) is online as long as ANY socket is alive. Going offline
 * requires the LAST socket to drop. `disconnect` is idempotent: removing an
 * already-absent socket id never flips state or produces a negative count.
 *
 * When multi-instance support lands, this Map is the only thing that must move
 * to a Redis set/hash — the public API stays identical.
 */
@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, Set<string>>();

  /** Register a socket for a user. Returns changed=true only on the 0→1 transition. */
  connect(userId: string, socketId: string): PresenceResult {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set<string>();
      this.sockets.set(userId, set);
    }
    const wasEmpty = set.size === 0;
    set.add(socketId);
    return { changed: wasEmpty, online: true };
  }

  /**
   * Remove a socket for a user. Only the transition to 0 sockets flips `online`
   * to false. Removing an id that is not present is a no-op (idempotent).
   */
  disconnect(userId: string, socketId: string): PresenceResult {
    const set = this.sockets.get(userId);
    if (!set || !set.has(socketId)) {
      // Unknown user or already-removed socket — state is unchanged.
      return { changed: false, online: set ? set.size > 0 : false };
    }
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return { changed: true, online: false };
    }
    return { changed: false, online: true };
  }

  isOnline(userId: string): boolean {
    const set = this.sockets.get(userId);
    return !!set && set.size > 0;
  }

  getStatus(userId: string): UserPresence {
    return { userId, online: this.isOnline(userId) };
  }

  /** Batch status for a known list of user ids (e.g. a user's friends). */
  getStatuses(userIds: string[]): UserPresence[] {
    return userIds.map((userId) => this.getStatus(userId));
  }
}
