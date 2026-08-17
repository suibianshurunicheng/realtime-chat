import { Readable } from 'stream';

/**
 * Storage abstraction for attachment bytes. Phase 4 ships only
 * `LocalStorageService`; MinIO/S3 can be added later behind this same interface
 * without touching the attachments service, controller, or message model.
 */
export abstract class StorageService {
  /** Persist `buffer` and return an opaque, unpredictable storage key. */
  abstract save(buffer: Buffer): Promise<{ storageKey: string }>;

  /** Open a read stream for `storageKey`. Throws if the key does not exist. */
  abstract getStream(storageKey: string): Promise<Readable>;

  /** Best-effort delete of `storageKey`. Swallows "not found" (idempotent). */
  abstract delete(storageKey: string): Promise<void>;
}
