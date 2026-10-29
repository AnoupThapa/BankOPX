import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Tx } from './db';

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/**
 * Idempotency (FRM-10, INT-02). Same key + same payload returns the stored result and runs nothing again;
 * same key + different payload is rejected. Runs inside the caller's transaction so the record and the effect commit together.
 */
@Injectable()
export class Idempotency {
  async run<T>(tx: Tx, institutionId: string, scope: string, key: string, payload: unknown, effect: () => Promise<T>): Promise<{ replayed: boolean; result: T }> {
    const requestHash = hashPayload(payload);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${institutionId}:${scope}:${key}`]);
    const existing = await tx.query('SELECT request_hash, response FROM idempotency_record WHERE institution_id=$1 AND scope=$2 AND key=$3', [institutionId, scope, key]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new ConflictException('idempotency key reused with a different payload');
      return { replayed: true, result: existing.rows[0].response as T };
    }
    const result = await effect();
    await tx.query('INSERT INTO idempotency_record(institution_id, scope, key, request_hash, response) VALUES ($1,$2,$3,$4,$5)', [institutionId, scope, key, requestHash, JSON.stringify(result)]);
    return { replayed: false, result };
  }
}
