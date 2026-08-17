import type { AttachmentKind } from './entities/attachment.entity';

/**
 * Phase 4 file-validation rules (server-truth, never client-declared).
 *
 * Three independent checks must ALL pass:
 *  1. extension whitelist (derived from the allowed MIME map below)
 *  2. magic-byte detection  (the real file content, not the declared type)
 *  3. extension <-> detected-MIME consistency (rejects e.g. `.exe` padded with
 *     PNG bytes, or a `.png` whose bytes are actually a script)
 *
 * The client-supplied `Content-Type` / `mimetype` is NEVER trusted — only the
 * bytes matter. `detectMime` returns a canonical allowed MIME or null.
 */

// Canonical allowed MIME -> the extensions that may carry it.
const ALLOWED: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip', 'docx', 'xlsx'], // docx/xlsx are ZIP containers
  'application/x-ole-storage': ['doc', 'xls'], // legacy OLE2 (pre-2007 Office)
};

const ALL_EXTS = new Set(Object.values(ALLOWED).flat());

/** Return the canonical allowed MIME for `buf`, or null if it's not a known type. */
export function detectMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF8')) return 'image/gif';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  )
    return 'application/zip';
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  )
    return 'application/x-ole-storage';
  return null;
}

export function kindOf(mime: string): AttachmentKind {
  return mime.startsWith('image/') ? 'image' : 'file';
}

/**
 * Validate a candidate upload by CONTENT. Returns the trusted MIME (and the
 * normalized extension) or null if the file must be rejected.
 */
export function validateFileContent(
  originalname: string,
  buf: Buffer,
): { mime: string; ext: string } | null {
  const dot = originalname.lastIndexOf('.');
  const ext = (dot >= 0 ? originalname.slice(dot + 1) : '').toLowerCase();
  if (!ext || !ALL_EXTS.has(ext)) return null;

  const detected = detectMime(buf);
  if (!detected) return null;

  const okExts = ALLOWED[detected] ?? [];
  if (!okExts.includes(ext)) return null; // extension <-> magic mismatch

  return { mime: detected, ext };
}

/** Keep only the basename and strip control/path characters. */
export function sanitizeFileName(name: string): string {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  return base.length > 255 ? base.slice(0, 255) : base;
}
