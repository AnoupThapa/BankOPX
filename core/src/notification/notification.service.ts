import { Injectable, NotFoundException } from '@nestjs/common';
import { Db, Tx } from '../platform';
import { SessionInfo } from '../identity-access';
import { Template } from './templates';

/** In-app notification centre (NOT-02). Outbound SMS and email through a provider are Phase 5 outbox work; the renderer in templates.ts is what they must use. */
@Injectable()
export class NotificationService {
  constructor(private readonly db: Db) {}

  async notify(tx: Tx, institutionId: string, n: { profileId: string; caseId: string; template: Template; code: string }): Promise<void> {
    await tx.query(`INSERT INTO notification (institution_id, profile_id, case_id, template, params) VALUES ($1,$2,$3,$4,$5)`, [institutionId, n.profileId, n.caseId, n.template, JSON.stringify({ code: n.code })]);
  }

  async listMine(s: SessionInfo, profileId: string) {
    return this.db.withTenant(s.principal.institutionId, async (tx) =>
      (await tx.query('SELECT id, case_id, template, params, created_at, read_at FROM notification WHERE profile_id=$1 ORDER BY created_at DESC LIMIT 100', [profileId])).rows
        .map((r) => ({ id: r.id, caseId: r.case_id, template: r.template, code: r.params.code, at: r.created_at, read: !!r.read_at })));
  }

  async markRead(s: SessionInfo, profileId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new NotFoundException();
    const r = await this.db.withTenant(s.principal.institutionId, (tx) => tx.query('UPDATE notification SET read_at = coalesce(read_at, now()) WHERE id=$1 AND profile_id=$2', [id, profileId]));
    if (!r.rowCount) throw new NotFoundException();
  }
}
