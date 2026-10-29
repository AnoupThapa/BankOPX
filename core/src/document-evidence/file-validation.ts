import { createHash } from 'crypto';

export type Mime = 'image/jpeg' | 'image/png' | 'application/pdf';
export const ALL_MIMES: Mime[] = ['image/jpeg', 'image/png', 'application/pdf'];
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const HARD_MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<Mime, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'application/pdf': ['pdf'] };

export type Rejection = 'empty' | 'too_large' | 'unsupported_type' | 'type_mismatch' | 'suspicious_content' | 'not_allowed_here';

/** Type from the file's own signature, never from the client's claim (DOC-01). */
export function detectMime(b: Buffer): Mime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

// Active-content markers that have no place in an ID photo or a scanned PDF. Conservative on purpose; a hit is rejected, not "cleaned".
const MARKERS = [/<script/i, /<\?php/i, /<html/i, /<%/, /javascript:/i, /\/JavaScript/, /\/JS\b/, /\/Launch/, /\/EmbeddedFile/, /\/OpenAction/, /\/AA\b/, /^MZ/, /\x7fELF/];

export function validateFile(bytes: Buffer, declaredMime: string | undefined, fileName: string, accept: Mime[], maxBytes: number): { ok: true; mime: Mime } | { ok: false; reason: Rejection } {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > Math.min(maxBytes, HARD_MAX_BYTES)) return { ok: false, reason: 'too_large' };
  const mime = detectMime(bytes);
  if (!mime) return { ok: false, reason: 'unsupported_type' };
  if (!accept.includes(mime)) return { ok: false, reason: 'not_allowed_here' };
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  // Declared type and extension must agree with the real signature (executable renamed .jpg, double extensions such as a.jpg.exe).
  if ((declaredMime && declaredMime.split(';')[0]!.trim() !== mime && declaredMime !== 'application/octet-stream') || !EXT[mime].includes(ext)) return { ok: false, reason: 'type_mismatch' };
  const text = bytes.toString('latin1');
  if (MARKERS.some((m) => m.test(text))) return { ok: false, reason: 'suspicious_content' };
  return { ok: true, mime };
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Display name only; never used as a storage path (path traversal, control characters, length). */
export function safeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'file';
  const clean = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\.{2,}/g, '.').slice(0, 80).trim();
  return clean || 'file';
}
