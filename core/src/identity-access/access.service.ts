import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit';
import { decide, Principal, Resource } from './policy';
import { Permission } from './permissions';

/** Object-level authorisation entry point used by every controller (SEC-01, SEC-02). Denials are audited. */
@Injectable()
export class AccessService {
  constructor(private readonly audit: AuditService) {}

  async authorize(p: Principal, permission: Permission, resource: Resource): Promise<void> {
    const d = decide(p, permission, resource);
    if (d.allow) return;
    await this.audit.recordStandalone({
      institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'access.denied',
      detail: { permission, reason: d.reason },
    });
    throw new ForbiddenException('forbidden');
  }
}
