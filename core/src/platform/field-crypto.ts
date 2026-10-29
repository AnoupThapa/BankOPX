import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Field-level encryption using the platform's AES-256-GCM primitive. No custom cryptography (SEC-05, ADR-010).
// The key is supplied by the secrets manager through FIELD_ENCRYPTION_KEY (64 hex chars). Never committed.
function key(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('FIELD_ENCRYPTION_KEY (64 hex chars) is required');
  return Buffer.from(hex, 'hex');
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptField(packed: string): string {
  const [iv, tag, enc] = packed.split('.').map((s) => Buffer.from(s, 'base64'));
  if (!iv || !tag || !enc) throw new Error('malformed ciphertext');
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// Keyed lookup hashes (HMAC-SHA256) for contact values and abuse counters. The key is separate from the encryption key.
import { createHmac } from 'crypto';
function hmacKey(): Buffer {
  const hex = process.env.LOOKUP_HMAC_KEY;
  if (!hex || hex.length !== 64) throw new Error('LOOKUP_HMAC_KEY (64 hex chars) is required');
  return Buffer.from(hex, 'hex');
}
export function keyedHash(scope: string, value: string): string {
  return createHmac('sha256', hmacKey()).update(`${scope}|${value}`).digest('hex');
}
