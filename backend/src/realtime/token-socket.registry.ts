import { Injectable, Logger } from '@nestjs/common';

/** A revoker closure installed by the gateway (the only component holding the
 *  Socket.IO `Server`); given a batch of socket ids it force-disconnects them. */
export type SocketRevoker = (socketIds: string[]) => void;

/**
 * In-process reverse index: jti → set of live Socket.IO socket ids.
 *
 * Single-instance only (no Redis, no Pub/Sub — deliberately out of scope until
 * multi-instance lands). It lets a logout revoke EVERY socket that authenticated
 * with a given access token, which is the token-level, multi-device-safe scope
 * required by the Phase 1 multi-session model (logging out one device's jti must
 * not touch another device's jti).
 *
 * The registry is a PURE index. The actual disconnect is performed by the gateway
 * via `setRevoker`, because only the gateway owns the `Server`. Presence state is
 * intentionally NOT stored here — that lives in `PresenceService`
 * (`userId → Set<socketId>`), and the two indexes are kept strictly separate.
 *
 * All mutations are idempotent: re-registering the same socket is a no-op;
 * unregistering an unknown/absent socket never throws; `clear` is safe to call
 * repeatedly. A stale/absent socketId during `revoke` is skipped silently.
 */
@Injectable()
export class TokenSocketRegistry {
  private readonly logger = new Logger(TokenSocketRegistry.name);
  private readonly jtiToSockets = new Map<string, Set<string>>();
  private readonly socketToJti = new Map<string, string>();
  private revoker: SocketRevoker | null = null;

  /** Installed once by the gateway after its `Server` is ready. */
  setRevoker(fn: SocketRevoker): void {
    this.revoker = fn;
  }

  /** Bind a live socket to its access token's jti. Idempotent. */
  register(jti: string, socketId: string): void {
    let set = this.jtiToSockets.get(jti);
    if (!set) {
      set = new Set<string>();
      this.jtiToSockets.set(jti, set);
    }
    set.add(socketId);
    this.socketToJti.set(socketId, jti);
  }

  /** Remove a socket from a jti's set (and the reverse index). Idempotent. */
  unregister(jti: string, socketId: string): void {
    const set = this.jtiToSockets.get(jti);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) this.jtiToSockets.delete(jti);
    }
    if (this.socketToJti.get(socketId) === jti) {
      this.socketToJti.delete(socketId);
    }
  }

  /** Drop a socket by id regardless of which jti it was bound to (used on disconnect). */
  clear(socketId: string): void {
    const jti = this.socketToJti.get(socketId);
    if (jti) this.unregister(jti, socketId);
  }

  getSocketIds(jti: string): string[] {
    const set = this.jtiToSockets.get(jti);
    return set ? [...set] : [];
  }

  /**
   * Revoke every socket bound to `jti` by invoking the gateway's disconnect
   * revoker. Returns how many sockets were asked to disconnect.
   *
   * The access blacklist (handled by the caller BEFORE this) is the security
   * source of truth; this is best-effort teardown and must never throw — a
   * missing/stale socket is skipped, and a revoker failure is logged, never
   * propagated to the logout HTTP request.
   */
  revoke(jti: string): number {
    const ids = this.getSocketIds(jti);
    if (ids.length && this.revoker) {
      try {
        this.revoker(ids);
      } catch (err) {
        this.logger.error(
          `revoke failed for jti=${jti}: ${err instanceof Error ? err.stack : String(err)}`,
        );
      }
    }
    return ids.length;
  }
}
