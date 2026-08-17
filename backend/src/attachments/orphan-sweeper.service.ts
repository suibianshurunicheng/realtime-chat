import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

/**
 * Periodically purges orphaned attachments — files that were uploaded but never
 * bound to a message (their `expiresAt` elapsed). The actual delete logic lives
 * in `AttachmentsService.sweepOrphans` (file-then-row, failure-tolerant). Tests
 * call `sweepOnce()` directly for determinism instead of waiting on the timer.
 */
@Injectable()
export class OrphanSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrphanSweeperService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly attachments: AttachmentsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweepOnce().catch((err) => {
        this.logger.error(`sweep failed: ${err instanceof Error ? err.stack : String(err)}`);
      });
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run one purge pass. Safe to call manually (used by e2e). */
  sweepOnce(): Promise<number> {
    return this.attachments.sweepOrphans();
  }
}
