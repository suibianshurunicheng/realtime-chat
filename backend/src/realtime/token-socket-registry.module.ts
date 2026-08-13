import { Module } from '@nestjs/common';
import { TokenSocketRegistry } from './token-socket.registry';

/**
 * Dependency-free module exposing the in-process `TokenSocketRegistry` so it can
 * be shared as a single instance. Both `AuthModule` (to revoke sockets on logout)
 * and `RealtimeModule` (to register / unregister on connect / disconnect) import
 * it. Single-instance scope only — when multi-instance support lands, this module
 * is swapped for a Redis-backed registry + Socket.IO adapter; the public API stays.
 */
@Module({
  providers: [TokenSocketRegistry],
  exports: [TokenSocketRegistry],
})
export class TokenSocketRegistryModule {}
