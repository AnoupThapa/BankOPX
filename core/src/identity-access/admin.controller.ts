import { BadRequestException, Body, Controller, Param, Post, Req } from '@nestjs/common';
import { AuditService } from '../audit';
import { Db } from '../platform';
import { AccessService } from './access.service';
import { AuthedRequest } from './auth.guard';
import { RequirePermission } from './decorators';
import { ROLES } from './permissions';
import { validateDelegation } from './policy';

@Controller('admin')
export class AdminController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly access: AccessService) {}

  /** APR-11: high-risk roles are inert until a second, different admin approves. */
  @Post('role-assignments') @RequirePermission('admin.role.grant')
  async grant(@Req() req: AuthedRequest, @Body() b: { userId: string; role: string; branchIds?: string[]; maxAmount?: number | null; reason: string }) {
    const p = req.session$!.principal;
    const def = ROLES[b.role];
    if (!def || !b.reason) throw new BadRequestException('unknown role or missing reason');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const target = (await tx.query('SELECT actor_type FROM user_account WHERE id=$1', [b.userId])).rows[0];
      if (!target || !def.actorTypes.includes(target.actor_type)) throw new BadRequestException('role not permitted for this identity type'); // SEC-07
      const id = (await tx.query(
        `INSERT INTO role_assignment (institution_id, user_id, role, branch_ids, max_amount, granted_by, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.institutionId, b.userId, b.role, b.branchIds ?? [], b.maxAmount ?? null, p.userId, def.highRisk ? null : p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'role.granted',
        objectType: 'role_assignment', objectId: id, reason: b.reason, newState: def.highRisk ? 'pending_second_approval' : 'active', detail: { role: b.role, userId: b.userId } });
      return { id, status: def.highRisk ? 'pending_second_approval' : 'active' };
    });
  }

  @Post('role-assignments/:id/approve') @RequirePermission('admin.role.approve')
  async approve(@Req() req: AuthedRequest, @Param('id') id: string) {
    const p = req.session$!.principal;
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ra = (await tx.query('SELECT * FROM role_assignment WHERE id=$1', [id])).rows[0];
      if (!ra) throw new BadRequestException('not found');
      if (ra.granted_by === p.userId || ra.user_id === p.userId) {
        await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'access.denied', objectType: 'role_assignment', objectId: id, detail: { reason: 'second_approver_must_differ' } });
        return { denied: true } as const;
      }
      await tx.query('UPDATE role_assignment SET approved_by=$2 WHERE id=$1 AND approved_by IS NULL', [id, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'role.approved', objectType: 'role_assignment', objectId: id, priorState: 'pending_second_approval', newState: 'active' });
      return { denied: false } as const;
    }).then((r) => { if (r.denied) { throw new BadRequestException('second approver must differ from grantor and grantee'); } return { status: 'active' }; });
  }

  /** APR-04: delegation is time-limited and cannot exceed the delegator's own authority. */
  @Post('delegations') @RequirePermission('admin.delegation.create')
  async delegate(@Req() req: AuthedRequest, @Body() b: { fromUser: string; toUser: string; role: string; branchIds: string[]; maxAmount: number | null; validFrom: string; validTo: string; reason: string }) {
    const p = req.session$!.principal;
    return this.db.withTenant(p.institutionId, async (tx) => {
      const rows = (await tx.query('SELECT * FROM role_assignment WHERE user_id=$1 AND revoked_at IS NULL AND approved_by IS NOT NULL', [b.fromUser])).rows;
      const delegator = rows.map((r) => ({ role: r.role, branchIds: r.branch_ids as string[], departments: [], products: [],
        maxAmount: r.max_amount === null ? null : Number(r.max_amount), validFrom: r.valid_from as Date, validTo: r.valid_to as Date | null }));
      const d = { fromUser: b.fromUser, role: b.role, branchIds: b.branchIds ?? [], maxAmount: b.maxAmount, validFrom: new Date(b.validFrom), validTo: new Date(b.validTo) };
      const v = validateDelegation(delegator, d);
      if (!v.allow) throw new BadRequestException(v.reason);
      const id = (await tx.query(
        `INSERT INTO delegation (institution_id, from_user, to_user, role, branch_ids, max_amount, valid_from, valid_to, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [p.institutionId, d.fromUser, b.toUser, d.role, d.branchIds, d.maxAmount, d.validFrom, d.validTo, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'delegation.created', objectType: 'delegation', objectId: id, reason: b.reason });
      return { id };
    });
  }
}
