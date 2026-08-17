import type { Attachment } from './entities/attachment.entity';

/**
 * Wire view of an attachment. The `url` is OPAQUE and auth-gated
 * (`/attachments/:id`) — it MUST never expose `storageKey`, the server path, or
 * any internal directory. `fileName` is the sanitized original, used only for
 * display / as the download filename.
 */
export interface AttachmentView {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  url: string;
}

export function toAttachmentView(a: Attachment): AttachmentView {
  return {
    id: a.id,
    kind: a.kind,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    width: a.width ?? null,
    height: a.height ?? null,
    // Opaque, authorized endpoint (full path incl. global /api prefix). Never
    // leaks the storage key / filesystem path.
    url: `/api/attachments/${a.id}`,
  };
}
