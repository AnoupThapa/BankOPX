import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthService, SessionInfo } from './auth.service';
import { PERMISSION_KEY, PUBLIC_KEY } from './decorators';
import { Permission } from './permissions';
import { ROLES } from './permissions';
import { decide } from './policy';

export const COOKIE_NAME = 'bbjp_session';
export type AuthedRequest = Request & { session$?: SessionInfo };
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global default-deny guard: authentication, session rules and CSRF (IDN-09), plus the coarse permission check for
 * unscoped permissions. Scoped permissions are enforced per object by the controller through AccessService.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly audit: AuditService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    const pendingMfaOk = req.path === '/auth/mfa/verify' || req.path === '/auth/logout';
    const info = await this.auth.authenticate(req.cookies?.[COOKIE_NAME], { allowPendingMfa: pendingMfaOk });
    if (!SAFE.has(req.method) && !this.auth.verifyCsrf(info, req.header('x-csrf-token'))) throw new ForbiddenException('csrf');
    req.session$ = info;
    if (!permission && !pendingMfaOk && req.path !== '/auth/me') throw new UnauthorizedException(); // default deny: undeclared route
    if (permission) {
      const scoped = Object.values(ROLES).some((r) => r.scoped.includes(permission));
      const d = scoped ? { allow: true, reason: '' } : decide(info.principal, permission, { institutionId: info.principal.institutionId });
      if (!d.allow) {
        // Denied attempts are themselves audit events (WFL-03 spirit, SEC-13 alerting input).
        await this.audit.recordStandalone({ institutionId: info.principal.institutionId, actorId: info.principal.userId, actorType: info.principal.actorType,
          action: 'access.denied', detail: { permission, reason: d.reason } });
        throw new ForbiddenException('forbidden');
      }
    }
    return true;
  }
}
