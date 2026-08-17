import client from './client';
import type { AttachmentView } from '../types/chat';

/**
 * Upload one file to `conversationId` (multipart). Returns the AttachmentView
 * with an opaque download URL. The file is staged but NOT yet attached — it is
 * bound to a message when the message is sent via `sendSocketMessage`.
 *
 * Upload and message-send are deliberately decoupled: a failed send can be
 * retried without re-uploading. The returned `id` is passed as `attachmentIds`.
 */
export async function uploadAttachment(
  conversationId: string,
  file: File,
  opts?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<AttachmentView> {
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('file', file);
  const resp = await client.post('/attachments', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (opts?.onProgress && e.total) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
    signal: opts?.signal,
  });
  return resp.data.data as AttachmentView;
}

/**
 * Download an attachment as a Blob, through the Axios interceptor (so the
 * access token is attached). We deliberately do NOT point `<img src>` directly
 * at the URL — that would bypass the JWT header. Instead we fetch the blob and
 * create an object URL for preview / download.
 */
export async function fetchAttachmentBlob(id: string): Promise<Blob> {
  const resp = await client.get(`/attachments/${id}`, { responseType: 'blob' });
  return resp.data as Blob;
}

/** Trigger a browser download for an attachment blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the click has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
