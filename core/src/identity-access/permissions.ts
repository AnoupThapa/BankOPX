// Role -> permission catalogue. Roles are never sufficient alone; scope attributes apply (SEC-12).
export type ActorType = 'customer' | 'staff' | 'admin' | 'integration' | 'auditor';

export const PERMISSIONS = [
  'case.read', 'case.review', 'case.approve',
  'config.draft', 'config.submit', 'config.approve', 'config.disable', 'config.read',
  'audit.read',
  'admin.role.grant', 'admin.role.approve', 'admin.delegation.create',
  'integration.invoke',
  'self.read', 'profile.read', 'profile.write', 'consent.write', 'profile.link', 'draft.write', 'catalogue.read',
  'customer.lookup', 'application.write', 'application.read', 'document.read',
  'case.clear', 'case.assign', 'workflow.read', 'tat.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDef {
  permissions: Permission[];
  /** Which identity types may hold the role (SEC-07 separate identities). */
  actorTypes: ActorType[];
  /** Permissions that are constrained by branch/department/product/amount scope. */
  scoped: Permission[];
  /** High-risk roles need a second approver before they take effect (APR-11). */
  highRisk: boolean;
}

export const ROLES: Record<string, RoleDef> = {
  branch_officer: { permissions: ['case.read', 'case.review', 'customer.lookup', 'document.read', 'tat.read'], actorTypes: ['staff'], scoped: ['case.read', 'case.review', 'customer.lookup', 'document.read', 'tat.read'], highRisk: false },
  approver: { permissions: ['case.read', 'case.approve', 'document.read', 'tat.read'], actorTypes: ['staff'], scoped: ['case.read', 'case.approve', 'document.read', 'tat.read'], highRisk: false },
  // Compliance and legal clearances: a separate duty from branch review (WFL-02).
  compliance_officer: { permissions: ['case.read', 'case.clear', 'document.read'], actorTypes: ['staff'], scoped: ['case.read', 'case.clear', 'document.read'], highRisk: false },
  // Team leads assign and reassign work inside their branches; they do not decide (DEC-02).
  team_lead: { permissions: ['case.read', 'case.review', 'case.assign', 'document.read', 'tat.read'], actorTypes: ['staff'], scoped: ['case.read', 'case.review', 'case.assign', 'document.read', 'tat.read'], highRisk: false },
  config_maker: { permissions: ['config.draft', 'config.submit', 'config.read', 'workflow.read'], actorTypes: ['admin'], scoped: [], highRisk: false },
  config_checker: { permissions: ['config.approve', 'config.disable', 'config.read', 'workflow.read'], actorTypes: ['admin'], scoped: [], highRisk: true },
  security_admin: { permissions: ['admin.role.grant', 'admin.role.approve', 'admin.delegation.create'], actorTypes: ['admin'], scoped: [], highRisk: true },
  auditor: { permissions: ['audit.read', 'config.read'], actorTypes: ['auditor'], scoped: [], highRisk: false },
  integration_service: { permissions: ['integration.invoke'], actorTypes: ['integration'], scoped: [], highRisk: false },
  customer: { permissions: ['self.read', 'profile.read', 'profile.write', 'consent.write', 'profile.link', 'draft.write', 'catalogue.read', 'application.write', 'application.read', 'document.read'], actorTypes: ['customer'], scoped: [], highRisk: false },
};

/** Permissions that mutate state or release information needing approval. Auditors can never hold these (SEC-11). */
export const isReadPermission = (p: Permission): boolean => p.endsWith('.read');
