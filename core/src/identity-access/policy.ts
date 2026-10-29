import { ActorType, Permission, ROLES, isReadPermission } from './permissions';

export interface Assignment {
  role: string;
  branchIds: string[];
  departments: string[];
  products: string[];
  maxAmount: number | null;
  validFrom: Date;
  validTo: Date | null;
  revokedAt?: Date | null;
  grantedBy?: string | null;
  approvedBy?: string | null;
  userId?: string;
}

export interface DelegationGrant {
  fromUser: string;
  role: string;
  branchIds: string[];
  maxAmount: number | null;
  validFrom: Date;
  validTo: Date;
  revokedAt?: Date | null;
}

export interface Principal {
  userId: string;
  institutionId: string;
  actorType: ActorType;
  mfaVerified: boolean;
  assignments: Assignment[];
  delegations: DelegationGrant[];
}

export interface Resource {
  institutionId: string;
  branchId?: string;
  department?: string;
  product?: string;
  amount?: number;
  /** The customer/applicant the object belongs to — used for self-approval and IDOR checks. */
  applicantId?: string;
  /** For maker-checker: who authored the thing being approved. */
  makerId?: string;
}

export interface Decision { allow: boolean; reason: string }
const deny = (reason: string): Decision => ({ allow: false, reason });

const live = (a: { validFrom: Date; validTo?: Date | null; revokedAt?: Date | null }, now: Date) =>
  !a.revokedAt && a.validFrom <= now && (!a.validTo || a.validTo > now);

/**
 * Central policy decision point (ADR-011). Pure and deterministic: RBAC + ABAC + separation-of-duties.
 * Rules: SEC-01, SEC-02, SEC-07, SEC-11, SEC-12, IDN-08, APR-01, APR-02, APR-03, APR-04, APR-11, CFG-01.
 */
export function decide(p: Principal, permission: Permission, r: Resource, now: Date = new Date()): Decision {
  if (r.institutionId !== p.institutionId) return deny('tenant_mismatch');                       // SEC-02
  if ((p.actorType === 'staff' || p.actorType === 'admin') && !p.mfaVerified) return deny('mfa_required'); // IDN-08
  if (p.actorType === 'auditor' && !isReadPermission(permission)) return deny('auditor_read_only');     // SEC-11

  // Maker-checker / self-approval separation (APR-01, APR-02, CFG-01)
  if (permission === 'config.approve' && r.makerId === p.userId) return deny('maker_cannot_approve');
  if (permission === 'case.approve' && r.applicantId === p.userId) return deny('applicant_cannot_approve');

  type Grant = { role: string; branchIds: string[]; departments: string[]; products: string[]; maxAmount: number | null };
  const grants: Grant[] = [];
  for (const a of p.assignments) {
    if (!live(a, now)) continue;
    const def = ROLES[a.role];
    if (!def) continue;
    if (def.highRisk && (!a.approvedBy || a.approvedBy === a.userId || a.approvedBy === a.grantedBy)) continue; // APR-11
    grants.push(a);
  }
  for (const d of p.delegations) {
    if (!live(d, now)) continue;                                                              // APR-04
    grants.push({ role: d.role, branchIds: d.branchIds, departments: [], products: [], maxAmount: d.maxAmount });
  }

  let sawRole = false;
  for (const g of grants) {
    const def = ROLES[g.role];
    if (!def || !def.permissions.includes(permission)) continue;
    if (!def.actorTypes.includes(p.actorType)) continue;                                      // SEC-07
    sawRole = true;
    if (def.scoped.includes(permission)) {
      // Empty scope list means "nothing", never "everything" (SEC-12).
      if (!r.branchId || !g.branchIds.includes(r.branchId)) continue;
      if (g.departments.length && (!r.department || !g.departments.includes(r.department))) continue;
      if (g.products.length && (!r.product || !g.products.includes(r.product))) continue;
      // Authority limits govern decisions only: an approver with a limit can still open and read cases (APR-03).
      if (permission === 'case.approve' && g.maxAmount !== null && (r.amount === undefined || r.amount > g.maxAmount)) continue;
    }
    return { allow: true, reason: 'granted' };
  }
  return deny(sawRole ? 'out_of_scope' : 'no_permission');
}

/** A delegation can never exceed what the delegator holds (APR-04). */
export function validateDelegation(delegator: Assignment[], d: DelegationGrant, now: Date = new Date()): Decision {
  if (d.validTo <= d.validFrom) return deny('invalid_window');
  const held = delegator.filter((a) => live(a, now) && a.role === d.role);
  if (!held.length) return deny('delegator_lacks_role');
  const covers = held.some((a) =>
    d.branchIds.every((b) => a.branchIds.includes(b)) &&
    (a.maxAmount === null || (d.maxAmount !== null && d.maxAmount <= a.maxAmount)) &&
    (a.validTo === null || a.validTo >= d.validTo));
  return covers ? { allow: true, reason: 'ok' } : deny('exceeds_delegator_authority');
}

/**
 * Coarse check used by the guard for scoped permissions: does the principal hold the permission through ANY live,
 * valid grant, ignoring scope? Object-level scope is still enforced per object by `decide` (SEC-01, SEC-12).
 */
export function holdsPermission(p: Principal, permission: Permission, now: Date = new Date()): boolean {
  if ((p.actorType === 'staff' || p.actorType === 'admin') && !p.mfaVerified) return false;
  if (p.actorType === 'auditor' && !isReadPermission(permission)) return false;
  const grants = [
    ...p.assignments.filter((a) => live(a, now) && !(ROLES[a.role]?.highRisk && (!a.approvedBy || a.approvedBy === a.userId || a.approvedBy === a.grantedBy))).map((a) => a.role),
    ...p.delegations.filter((d) => live(d, now)).map((d) => d.role),
  ];
  return grants.some((r) => ROLES[r]?.permissions.includes(permission) && ROLES[r]?.actorTypes.includes(p.actorType));
}

/**
 * Branch ids a principal may use for a scoped permission, for filtering lists at query level (ADR-011). Empty means none, never all.
 * Mirrors `decide`: live assignments and delegations of roles that grant the permission with that scope.
 */
export function scopedBranchIds(p: Principal, permission: Permission, now: Date = new Date()): string[] {
  if (!holdsPermission(p, permission, now)) return [];
  const ids = new Set<string>();
  const roleOk = (role: string) => !!ROLES[role]?.permissions.includes(permission) && !!ROLES[role]?.actorTypes.includes(p.actorType) && !!ROLES[role]?.scoped.includes(permission);
  for (const a of p.assignments) if (live(a, now) && roleOk(a.role) && !(ROLES[a.role]?.highRisk && (!a.approvedBy || a.approvedBy === a.userId || a.approvedBy === a.grantedBy))) a.branchIds.forEach((b) => ids.add(b));
  for (const d of p.delegations) if (live(d, now) && roleOk(d.role)) d.branchIds.forEach((b) => ids.add(b));
  return [...ids];
}
