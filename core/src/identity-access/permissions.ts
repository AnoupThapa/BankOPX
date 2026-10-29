// Role -> permission catalogue. Roles are never sufficient alone; scope attributes apply (SEC-12).
export type ActorType = 'customer' | 'staff' | 'admin' | 'integration' | 'auditor';

export const PERMISSIONS = [
  'case.read', 'case.review', 'case.approve',
  'config.draft', 'config.submit', 'config.approve', 'config.disable', 'config.read',
  'audit.read',
  'admin.role.grant', 'admin.role.approve', 'admin.delegation.create',
  'integration.invoke',
  'self.read', 'profile.read', 'profile.write', 'consent.write', 'profile.link', 'draft.write', 'catalogue.read',
  'customer.lookup',
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
  branch_officer: { permissions: ['case.read', 'case.review', 'customer.lookup'], actorTypes: ['staff'], scoped: ['case.read', 'case.review', 'customer.lookup'], highRisk: false },
  approver: { permissions: ['case.read', 'case.approve'], actorTypes: ['staff'], scoped: ['case.read', 'case.approve'], highRisk: false },
  config_maker: { permissions: ['config.draft', 'config.submit', 'config.read'], actorTypes: ['admin'], scoped: [], highRisk: false },
  config_checker: { permissions: ['config.approve', 'config.disable', 'config.read'], actorTypes: ['admin'], scoped: [], highRisk: true },
  security_admin: { permissions: ['admin.role.grant', 'admin.role.approve', 'admin.delegation.create'], actorTypes: ['admin'], scoped: [], highRisk: true },
  auditor: { permissions: ['audit.read', 'config.read'], actorTypes: ['auditor'], scoped: [], highRisk: false },
  integration_service: { permissions: ['integration.invoke'], actorTypes: ['integration'], scoped: [], highRisk: false },
  customer: { permissions: ['self.read', 'profile.read', 'profile.write', 'consent.write', 'profile.link', 'draft.write', 'catalogue.read'], actorTypes: ['customer'], scoped: [], highRisk: false },
};

/** Permissions that mutate state or release information needing approval. Auditors can never hold these (SEC-11). */
export const isReadPermission = (p: Permission): boolean => p.endsWith('.read');
