import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Node's built-in scrypt KDF; parameters are the library defaults. No hand-rolled crypto (SEC-05).
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the work, even for unknown users, to keep timing uniform (IDN-05 spirit).
  const [, s, h] = (stored ?? `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`).split('$');
  const dk = await scrypt(pw, Buffer.from(s ?? '', 'base64'), 64);
  const ok = timingSafeEqual(dk, Buffer.from(h ?? '', 'base64'));
  return stored !== null && ok;
}
