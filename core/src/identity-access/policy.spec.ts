import { decide, Principal, validateDelegation } from './policy';

const INST = 'i1';
const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 86_400_000);
const base = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1', institutionId: INST, actorType: 'staff', mfaVerified: true, delegations: [],
  assignments: [{ role: 'branch_officer', branchIds: ['A'], departments: [], products: [], maxAmount: null, validFrom: past, validTo: null, userId: 'u1' }],
  ...over,
});

describe('policy decision point', () => {
  it('SEC-12: a role name alone does not grant access to every branch', () => {
    expect(decide(base(), 'case.read', { institutionId: INST, branchId: 'A' }).allow).toBe(true);
    expect(decide(base(), 'case.read', { institutionId: INST, branchId: 'B' })).toEqual({ allow: false, reason: 'out_of_scope' });
    expect(decide(base(), 'case.read', { institutionId: INST }).allow).toBe(false); // no branch on resource => deny, not allow-all
  });
  it('SEC-12: empty scope means nothing, not everything', () => {
    const p = base({ assignments: [{ ...base().assignments[0]!, branchIds: [] }] });
    expect(decide(p, 'case.read', { institutionId: INST, branchId: 'A' }).allow).toBe(false);
  });
  it('SEC-02: other tenant is denied', () => {
    expect(decide(base(), 'case.read', { institutionId: 'other', branchId: 'A' })).toEqual({ allow: false, reason: 'tenant_mismatch' });
  });
  it('IDN-08: staff without MFA are denied everything', () => {
    expect(decide(base({ mfaVerified: false }), 'case.read', { institutionId: INST, branchId: 'A' }).reason).toBe('mfa_required');
  });
  it('SEC-11: auditor is read-only even if given a write-capable role', () => {
    const a = base({ actorType: 'auditor', assignments: [
      { role: 'auditor', branchIds: [], departments: [], products: [], maxAmount: null, validFrom: past, validTo: null },
    ] });
    expect(decide(a, 'audit.read', { institutionId: INST }).allow).toBe(true);
    expect(decide(a, 'config.approve', { institutionId: INST }).reason).toBe('auditor_read_only');
    expect(decide(a, 'case.approve', { institutionId: INST, branchId: 'A' }).reason).toBe('auditor_read_only');
  });
  it('SEC-07: a role cannot be exercised by the wrong identity type', () => {
    const p = base({ actorType: 'customer', assignments: [{ role: 'branch_officer', branchIds: ['A'], departments: [], products: [], maxAmount: null, validFrom: past, validTo: null }] });
    expect(decide(p, 'case.read', { institutionId: INST, branchId: 'A' }).allow).toBe(false);
  });
  it('APR-01: applicant cannot approve their own application', () => {
    const p = base({ assignments: [{ role: 'approver', branchIds: ['A'], departments: [], products: [], maxAmount: 1000, validFrom: past, validTo: null }] });
    expect(decide(p, 'case.approve', { institutionId: INST, branchId: 'A', amount: 500, applicantId: 'u1' }).reason).toBe('applicant_cannot_approve');
    expect(decide(p, 'case.approve', { institutionId: INST, branchId: 'A', amount: 500, applicantId: 'cust' }).allow).toBe(true);
  });
  it('APR-03: authority limit is checked at decision time, boundary inclusive', () => {
    const p = base({ assignments: [{ role: 'approver', branchIds: ['A'], departments: [], products: [], maxAmount: 1000, validFrom: past, validTo: null }] });
    const r = (amount?: number) => decide(p, 'case.approve', { institutionId: INST, branchId: 'A', amount, applicantId: 'c' }).allow;
    expect(r(1000)).toBe(true);
    expect(r(1000.01)).toBe(false);
    expect(r(undefined)).toBe(false);
  });
  it('APR-03: an authority limit applies to decisions only; an approver with a limit can still read cases that carry no amount', () => {
    const p = base({ assignments: [{ role: 'approver', branchIds: ['A'], departments: [], products: [], maxAmount: 1000, validFrom: past, validTo: null }] });
    expect(decide(p, 'case.read', { institutionId: INST, branchId: 'A' }).allow).toBe(true);
    expect(decide(p, 'case.approve', { institutionId: INST, branchId: 'A' }).allow).toBe(false);          // no amount known: no decision
    expect(decide(p, 'case.approve', { institutionId: INST, branchId: 'A', amount: 999 }).allow).toBe(true);
  });
  it('APR-04: expired or revoked delegations grant nothing; live ones are limited by their own scope', () => {
    const none = base({ assignments: [] });
    const mk = (validFrom: Date, validTo: Date, revokedAt: Date | null = null, maxAmount: number | null = 100) =>
      ({ ...none, delegations: [{ fromUser: 'x', role: 'approver', branchIds: ['A'], maxAmount, validFrom, validTo, revokedAt }] });
    const res = { institutionId: INST, branchId: 'A', amount: 50, applicantId: 'c' };
    expect(decide(mk(past, future), 'case.approve', res).allow).toBe(true);
    expect(decide(mk(past, new Date(Date.now() - 1000)), 'case.approve', res).allow).toBe(false);
    expect(decide(mk(past, future, new Date()), 'case.approve', res).allow).toBe(false);
    expect(decide(mk(past, future), 'case.approve', { ...res, amount: 101 }).allow).toBe(false);
    expect(decide(mk(past, future), 'case.approve', { ...res, branchId: 'B' }).allow).toBe(false);
  });
  it('APR-04: a delegation cannot exceed the delegator authority', () => {
    const held = [{ role: 'approver', branchIds: ['A'], departments: [], products: [], maxAmount: 1000, validFrom: past, validTo: null }];
    const d = { fromUser: 'x', role: 'approver', branchIds: ['A'], maxAmount: 500, validFrom: new Date(), validTo: future };
    expect(validateDelegation(held, d).allow).toBe(true);
    expect(validateDelegation(held, { ...d, maxAmount: 5000 }).reason).toBe('exceeds_delegator_authority');
    expect(validateDelegation(held, { ...d, maxAmount: null }).allow).toBe(false);
    expect(validateDelegation(held, { ...d, branchIds: ['A', 'B'] }).allow).toBe(false);
    expect(validateDelegation(held, { ...d, role: 'config_checker' }).reason).toBe('delegator_lacks_role');
    expect(validateDelegation(held, { ...d, validTo: past }).reason).toBe('invalid_window');
  });
  it('APR-11: high-risk role is inert until a different second approver signs', () => {
    const mk = (approvedBy: string | null, grantedBy = 'g'): Principal => base({ actorType: 'admin', assignments: [
      { role: 'config_checker', branchIds: [], departments: [], products: [], maxAmount: null, validFrom: past, validTo: null, userId: 'u1', grantedBy, approvedBy }] });
    const r = { institutionId: INST };
    expect(decide(mk(null), 'config.approve', r).allow).toBe(false);
    expect(decide(mk('u1'), 'config.approve', r).allow).toBe(false);   // self-approved
    expect(decide(mk('g'), 'config.approve', r).allow).toBe(false);    // approved by grantor only
    expect(decide(mk('other'), 'config.approve', r).allow).toBe(true);
  });
  it('CFG-01: a maker cannot approve their own change', () => {
    const p = base({ actorType: 'admin', assignments: [
      { role: 'config_checker', branchIds: [], departments: [], products: [], maxAmount: null, validFrom: past, validTo: null, userId: 'u1', grantedBy: 'g', approvedBy: 'o' }] });
    expect(decide(p, 'config.approve', { institutionId: INST, makerId: 'u1' }).reason).toBe('maker_cannot_approve');
    expect(decide(p, 'config.approve', { institutionId: INST, makerId: 'u2' }).allow).toBe(true);
  });
});

describe('holdsPermission (guard pre-check for scoped permissions)', () => {
  const { holdsPermission } = jest.requireActual('./policy') as typeof import('./policy');
  it('ignores scope but still honours identity type, MFA, expiry and revocation', () => {
    expect(holdsPermission(base(), 'case.read')).toBe(true);
    expect(holdsPermission(base({ mfaVerified: false }), 'case.read')).toBe(false);
    expect(holdsPermission(base({ actorType: 'customer' }), 'case.read')).toBe(false);          // SEC-07
    expect(holdsPermission(base({ assignments: [{ ...base().assignments[0]!, validTo: past }] }), 'case.read')).toBe(false);
    expect(holdsPermission(base({ assignments: [{ ...base().assignments[0]!, revokedAt: new Date() }] }), 'case.read')).toBe(false);
    expect(holdsPermission(base(), 'config.approve')).toBe(false);
  });
});
