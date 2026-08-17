import { promises as fs, createReadStream, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Local-disk implementation of StorageService. Files live INSIDE the backend
 * directory under `dir` (default `<cwd>/.uploads`), never exposed as a public
 * static route. Clients reach bytes only through the authorized, membership-
 * checked `GET /api/attachments/:id` endpoint (which streams by storageKey).
 *
 * `storageKey` is a 64-hex random token — it is NOT derived from the filename,
 * so callers can never guess or traverse to another file.
 */
@Injectable()
export class LocalStorageService extends StorageService {
  private readonly dir: string;

  constructor(dir: string) {
    super();
    this.dir = dir;
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private pathOf(key: string): string {
    // storageKey is random hex, but defend against any stray separator.
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.dir, safe);
  }

  async save(buffer: Buffer): Promise<{ storageKey: string }> {
    this.ensureDir();
    const storageKey = randomBytes(32).toString('hex');
    await fs.writeFile(this.pathOf(storageKey), buffer);
    return { storageKey };
  }

  async getStream(storageKey: string): Promise<Readable> {
    return createReadStream(this.pathOf(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.pathOf(storageKey));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
