import { BadRequestException } from '@nestjs/common';

export type Channel = 'email' | 'mobile';

/** Canonical form so the same person always maps to the same lookup hash. Validation is syntactic only; it proves nothing about ownership (IDN-02). */
export function normaliseDestination(channel: Channel, raw: string): string {
  const v = String(raw ?? '').trim();
  if (channel === 'email') {
    const e = v.toLowerCase();
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BadRequestException('invalid destination');
    return e;
  }
  const digits = v.replace(/[\s-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(digits)) throw new BadRequestException('invalid destination');
  return digits.replace(/^\+/, '');
}

/** Masked form for staff and customer display; never the full value (PRV-03). */
export function maskDestination(channel: Channel, value: string): string {
  if (channel === 'mobile') return `${'*'.repeat(Math.max(value.length - 3, 0))}${value.slice(-3)}`;
  const [local = '', domain = ''] = value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
