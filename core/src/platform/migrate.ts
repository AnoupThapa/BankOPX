import { Client } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', '..', 'migrations');

/** Minimal, auditable SQL migration runner. Every migration has an .up.sql and a .down.sql (reversible where feasible). */
export async function migrate(ownerUrl: string, direction: 'up' | 'down' = 'up'): Promise<string[]> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migration')).rows.map((r) => r.name as string));
    const names = readdirSync(DIR).filter((f) => f.endsWith('.up.sql')).map((f) => f.replace('.up.sql', '')).sort();
    if (direction === 'up') {
      for (const name of names.filter((n) => !done.has(n))) {
        await client.query('BEGIN');
        await client.query(readFileSync(join(DIR, `${name}.up.sql`), 'utf8'));
        await client.query('INSERT INTO schema_migration(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      }
    } else {
      const last = names.filter((n) => done.has(n)).pop();
      if (last) {
        await client.query('BEGIN');
        await client.query(readFileSync(join(DIR, `${last}.down.sql`), 'utf8'));
        await client.query('DELETE FROM schema_migration WHERE name = $1', [last]);
        await client.query('COMMIT');
        applied.push(last);
      }
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
  return applied;
}
