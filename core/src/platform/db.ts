import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { loadEnv } from './env';

export type Tx = PoolClient;

/**
 * Tenant-scoped database access (ADR-003, SEC-02). Every unit of work runs in a transaction with
 * `app.institution_id` set, which Postgres row-level security uses to hide other tenants' rows.
 * There is deliberately no unscoped query method for application code.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: loadEnv().databaseUrl, max: 10 });

  async withTenant<T>(institutionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.institution_id', $1, true)", [institutionId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Institution directory lookup (institution table is not tenant data). */
  async institutionByCode(code: string): Promise<{ id: string; code: string } | undefined> {
    const r = await this.pool.query('SELECT id, code FROM institution WHERE code = $1', [code]);
    return r.rows[0];
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
