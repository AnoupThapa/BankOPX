import { Pool } from 'pg';
import { migrate } from '../src/platform/migrate';
import { AuditService } from '../src/audit';
import { Db } from '../src/platform';
import { asTenant, owner, seedInstitution } from './helpers';

const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
afterAll(async () => { await appPool.end(); });

describe('database integrity', () => {
  it('SEC-06/CFG-08: application role cannot UPDATE/DELETE/TRUNCATE audit or config-change events', async () => {
    const s = await seedInstitution([{ name: 'a1', actor: 'auditor' }]);
    const db = new Db(); const audit = new AuditService(db);
    await audit.recordStandalone({ institutionId: s.instId, actorType: 'staff', action: 'test.event' });
    const c = await appPool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.institution_id',$1,true)", [s.instId]);
      await expect(c.query("UPDATE audit_event SET action='x'")).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK'); await c.query('BEGIN'); await c.query("SELECT set_config('app.institution_id',$1,true)", [s.instId]);
      await expect(c.query('DELETE FROM audit_event')).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
      await expect(c.query('TRUNCATE audit_event')).rejects.toThrow(/permission denied/);
      await expect(c.query('DELETE FROM config_change_event')).rejects.toThrow(/permission denied/);
    } finally { c.release(); }
    await db.onModuleDestroy();
  });

  it('SEC-06: even the table owner is blocked by the append-only trigger', async () => {
    const s = await seedInstitution([]);
    const db = new Db(); const audit = new AuditService(db);
    await audit.recordStandalone({ institutionId: s.instId, actorType: 'staff', action: 'test.event' });
    await expect(asTenant(s.instId, (q) => q("UPDATE audit_event SET action='tampered'"))).rejects.toThrow(/append-only/);
    await expect(asTenant(s.instId, (q) => q('DELETE FROM audit_event'))).rejects.toThrow(/append-only/);
    await db.onModuleDestroy();
  });

  it('ADR-021: hash chain verifies, and detects out-of-band tampering', async () => {
    const s = await seedInstitution([]);
    const db = new Db(); const audit = new AuditService(db);
    for (let i = 0; i < 4; i++) await audit.recordStandalone({ institutionId: s.instId, actorType: 'staff', action: `e${i}`, detail: { i } });
    expect(await audit.verifyChain(s.instId)).toMatchObject({ intact: true, count: 4 });
    // Simulate a privileged attacker who disables the trigger and rewrites history.
    await asTenant(s.instId, async (q) => {
      await q('ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable');
      await q("UPDATE audit_event SET action='forged' WHERE action='e1'");
      await q('ALTER TABLE audit_event ENABLE TRIGGER audit_event_immutable');
    });
    const r = await audit.verifyChain(s.instId);
    expect(r.intact).toBe(false);
    expect(r.brokenAtSeq).not.toBeNull();
    await db.onModuleDestroy();
  });

  it('chain stays linear under concurrent writers', async () => {
    const s = await seedInstitution([]);
    const db = new Db(); const audit = new AuditService(db);
    await Promise.all(Array.from({ length: 12 }, (_, i) => audit.recordStandalone({ institutionId: s.instId, actorType: 'staff', action: `c${i}` })));
    expect(await audit.verifyChain(s.instId)).toMatchObject({ intact: true, count: 12 });
    await db.onModuleDestroy();
  });

  it('SEC-02/ADR-003: row-level security hides other tenants even with an unscoped query', async () => {
    const a = await seedInstitution([{ name: 'ua', actor: 'staff' }]);
    const b = await seedInstitution([{ name: 'ub', actor: 'staff' }]);
    const c = await appPool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.institution_id',$1,true)", [a.instId]);
      const own = await c.query('SELECT institution_id FROM user_account');
      expect(own.rows.every((r) => r.institution_id === a.instId)).toBe(true);
      expect(own.rowCount).toBe(1);
      await expect(c.query("INSERT INTO branch(institution_id, code, name) VALUES ($1,'X','X')", [b.instId])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
      // No tenant context at all => nothing visible.
      const none = await c.query('SELECT * FROM user_account');
      expect(none.rowCount).toBe(0);
    } finally { c.release(); }
  });

  it('TAT-01 foundation: timestamps are timestamptz (UTC)', async () => {
    const r = await owner.query("SELECT data_type FROM information_schema.columns WHERE table_name='audit_event' AND column_name='occurred_at'");
    expect(r.rows[0].data_type).toBe('timestamp with time zone');
  });

  it('migrations are reversible and re-appliable (scratch database, isolated from other suites)', async () => {
    const name = `bbjp_mig_${Date.now()}`;
    await owner.query(`CREATE DATABASE ${name}`);
    const url = process.env.MIGRATION_DATABASE_URL!.replace(/\/[^/]+$/, `/${name}`);
    try {
      expect(await migrate(url, 'up')).toEqual(['0001_foundation', '0002_customer']);
      expect(await migrate(url, 'down')).toEqual(['0002_customer']);
      expect(await migrate(url, 'down')).toEqual(['0001_foundation']);
      expect(await migrate(url, 'up')).toEqual(['0001_foundation', '0002_customer']);
    } finally { await owner.query(`DROP DATABASE ${name}`); }
  });
});
