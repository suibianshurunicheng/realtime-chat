import { Module } from '@nestjs/common';

// Phase 0 root module — intentionally empty.
// Feature modules (auth, friends, chat, presence, ...) are imported in later phases.
@Module({})
export class AppModule {}
