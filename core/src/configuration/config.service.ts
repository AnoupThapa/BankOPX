import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../audit';
import { AccessService, Principal } from '../identity-access';
import { Db, Idempotency, Tx } from '../platform';
import { ConfigValidatorRegistry, ImpactProvider } from './validators';

const stable = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
export const contentHash = (c: unknown) => createHash('sha256').update(stable(c)).digest('hex');

function diff(prev: Record<string, unknown> | undefined, next: Record<string, unknown>) {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) if (stable(prev?.[k]) !== stable(next[k])) out[k] = { from: prev?.[k] ?? null, to: next[k] ?? null };
  return out;
}

export interface VersionView { id: string; definitionId: string; version: number; status: string; contentHash: string; makerId: string; checkerId: string | null }

/** Versioned, immutable configuration with maker-checker (ADR-005, CFG-01..08, FRM-03, WFL-07). */
@Injectable()
export class ConfigService {
  private impact: ImpactProvider = async () => 0;
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly access: AccessService,
    private readonly validators: ConfigValidatorRegistry, private readonly idem: Idempotency,
  ) {}

  setImpactProvider(p: ImpactProvider): void { this.impact = p; }

  private async record(tx: Tx, p: Principal, definitionId: string, versionId: string | null, event: string, reason: string, d: object = {}) {
    await tx.query('INSERT INTO config_change_event (institution_id, definition_id, version_id, event, actor_id, reason, diff) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [p.institutionId, definitionId, versionId, event, p.userId, reason, JSON.stringify(d)]);
    await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: `config.${event}`,
      objectType: 'config_version', objectId: versionId ?? definitionId, reason });
  }

  async createDraft(p: Principal, kind: string, key: string, content: Record<string, unknown>, reason: string, idempotencyKey?: string) {
    await this.access.authorize(p, 'config.draft', { institutionId: p.institutionId });
    if (!reason?.trim()) throw new BadRequestException('change reason required (CFG-02)');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const effect = async () => {
        const def = (await tx.query(
          `INSERT INTO config_definition (institution_id, kind, key) VALUES ($1,$2,$3)
           ON CONFLICT (institution_id, kind, key) DO UPDATE SET kind = EXCLUDED.kind RETURNING id`, [p.institutionId, kind, key])).rows[0].id;
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cfg:${def}`]);
        const latest = (await tx.query(`SELECT version, content, status FROM config_version WHERE definition_id=$1 ORDER BY version DESC LIMIT 1`, [def])).rows[0];
        const pub = (await tx.query(`SELECT content FROM config_version WHERE definition_id=$1 AND status='published'`, [def])).rows[0];
        const id = (await tx.query(
          `INSERT INTO config_version (institution_id, definition_id, version, status, content, content_hash, change_reason, maker_id)
           VALUES ($1,$2,$3,'draft',$4,$5,$6,$7) RETURNING id, version`,
          [p.institutionId, def, (latest?.version ?? 0) + 1, JSON.stringify(content), contentHash(content), reason, p.userId])).rows[0];
        await this.record(tx, p, def, id.id, 'draft_created', reason, diff(pub?.content, content));
        return { id: id.id as string, definitionId: def as string, version: id.version as number };
      };
      return idempotencyKey ? (await this.idem.run(tx, p.institutionId, 'config.draft', idempotencyKey, { kind, key, content, reason }, effect)).result : effect();
    });
  }

  private async load(tx: Tx, id: string) {
    const v = (await tx.query('SELECT v.*, d.kind, d.key FROM config_version v JOIN config_definition d ON d.id = v.definition_id WHERE v.id=$1', [id])).rows[0];
    if (!v) throw new NotFoundException(); // also what other tenants see (RLS)
    return v;
  }

  async submit(p: Principal, versionId: string, reason: string) {
    await this.access.authorize(p, 'config.submit', { institutionId: p.institutionId });
    return this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      if (v.status !== 'draft') throw new ConflictException(`cannot submit from ${v.status}`);
      await tx.query(`UPDATE config_version SET status='in_review' WHERE id=$1`, [versionId]);
      await this.record(tx, p, v.definition_id, versionId, 'submitted', reason);
      return { status: 'in_review' };
    });
  }

  /** Checker publishes. CFG-01: maker may not approve. CFG-03: validators must pass. CFG-05: impact reported. */
  async approve(p: Principal, versionId: string, reason: string, effectiveFrom?: Date) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      await this.access.authorize(p, 'config.approve', { institutionId: p.institutionId, makerId: v.maker_id });
      if (v.status !== 'in_review') throw new ConflictException(`cannot approve from ${v.status}`);
      const res = this.validators.run(v.kind, v.content);
      if (!res.ok) throw new BadRequestException({ message: 'validation failed', errors: res.errors });
      const impactedCases = await this.impact(v.kind, v.key);
      await tx.query(`UPDATE config_version SET status='retired' WHERE definition_id=$1 AND status='published'`, [v.definition_id]);
      await tx.query(`UPDATE config_version SET status='published', checker_id=$2, published_at=now(), effective_from=$3 WHERE id=$1`, [versionId, p.userId, effectiveFrom ?? new Date()]);
      await this.record(tx, p, v.definition_id, versionId, 'published', reason, { impactedCases });
      return { status: 'published', impactedCases };
    });
  }

  async reject(p: Principal, versionId: string, reason: string) {
    await this.access.authorize(p, 'config.approve', { institutionId: p.institutionId });
    return this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      if (v.status !== 'in_review') throw new ConflictException(`cannot reject from ${v.status}`);
      await tx.query(`UPDATE config_version SET status='draft' WHERE id=$1`, [versionId]);
      await this.record(tx, p, v.definition_id, versionId, 'rejected', reason);
      return { status: 'draft' };
    });
  }

  /** Rollback publishes a NEW version whose content equals a prior one; it still passes review (CFG-04). */
  async rollback(p: Principal, definitionId: string, toVersion: number, reason: string) {
    await this.access.authorize(p, 'config.draft', { institutionId: p.institutionId });
    return this.db.withTenant(p.institutionId, async (tx) => {
      const prior = (await tx.query('SELECT * FROM config_version WHERE definition_id=$1 AND version=$2', [definitionId, toVersion])).rows[0];
      if (!prior) throw new NotFoundException();
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cfg:${definitionId}`]);
      const next = ((await tx.query('SELECT max(version) m FROM config_version WHERE definition_id=$1', [definitionId])).rows[0].m as number) + 1;
      const id = (await tx.query(
        `INSERT INTO config_version (institution_id, definition_id, version, status, content, content_hash, change_reason, maker_id, rollback_of)
         VALUES ($1,$2,$3,'in_review',$4,$5,$6,$7,$8) RETURNING id`,
        [p.institutionId, definitionId, next, JSON.stringify(prior.content), prior.content_hash, reason, p.userId, prior.id])).rows[0].id;
      await this.record(tx, p, definitionId, id, 'rollback_requested', reason, { toVersion });
      return { id, version: next, status: 'in_review' };
    });
  }

  /** Emergency-disable switch (CFG-04): immediately stops the config being served; fully audited. */
  async setDisabled(p: Principal, definitionId: string, disabled: boolean, reason: string) {
    await this.access.authorize(p, 'config.disable', { institutionId: p.institutionId });
    if (!reason?.trim()) throw new BadRequestException('reason required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const r = await tx.query('UPDATE config_definition SET disabled=$2 WHERE id=$1 RETURNING id', [definitionId, disabled]);
      if (!r.rowCount) throw new NotFoundException();
      await this.record(tx, p, definitionId, null, disabled ? 'emergency_disabled' : 'reenabled', reason);
      return { disabled };
    });
  }

  /** Runtime read used by other modules: the published, not-disabled version, or null. */
  async getPublished(institutionId: string, kind: string, key: string): Promise<(VersionView & { content: Record<string, unknown> }) | null> {
    return this.db.withTenant(institutionId, async (tx) => {
      const r = (await tx.query(
        `SELECT v.* FROM config_version v JOIN config_definition d ON d.id=v.definition_id
         WHERE d.kind=$1 AND d.key=$2 AND d.disabled=false AND v.status='published' AND (v.effective_from IS NULL OR v.effective_from <= now())`, [kind, key])).rows[0];
      return r ? { id: r.id, definitionId: r.definition_id, version: r.version, status: r.status, contentHash: r.content_hash, makerId: r.maker_id, checkerId: r.checker_id, content: r.content } : null;
    });
  }

  async getVersion(p: Principal, id: string) {
    await this.access.authorize(p, 'config.read', { institutionId: p.institutionId });
    return this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, id);
      return { id: v.id, version: v.version, status: v.status, content: v.content, contentHash: v.content_hash, makerId: v.maker_id, checkerId: v.checker_id };
    });
  }
}
