// Public interface of the identity-access module. Other modules import only from here (ADR-002).
export { IdentityAccessModule } from './identity-access.module';
export { AccessService } from './access.service';
export { AuthService, SessionInfo } from './auth.service';
export { RequirePermission, Public } from './decorators';
export { AuthedRequest, COOKIE_NAME } from './auth.guard';
export { decide, holdsPermission, scopedBranchIds, validateDelegation, Principal, Resource, Assignment, DelegationGrant, Decision } from './policy';
export { PERMISSIONS, ROLES, Permission, ActorType } from './permissions';
export { hashPassword } from './password';
export { DirectoryService } from './directory.service';
