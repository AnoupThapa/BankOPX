import { Controller, Get, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { AuditService } from './audit.service';

/** Read-only, scoped audit access (SEC-11). There is intentionally no write endpoint. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() @RequirePermission('audit.read')
  list(@Req() req: AuthedRequest, @Query('limit') limit?: string) { return this.audit.list(req.session$!.principal.institutionId, Number(limit) || 100); }
  @Get('verify') @RequirePermission('audit.read')
  verify(@Req() req: AuthedRequest) { return this.audit.verifyChain(req.session$!.principal.institutionId); }
}
