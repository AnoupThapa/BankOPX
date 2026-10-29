import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, Public, RequirePermission } from '../identity-access';
import { IntegrationService } from './integration.service';

@Controller('staff/integration')
export class IntegrationStaffController {
  constructor(private readonly svc: IntegrationService) {}
  private p(req: AuthedRequest) { return req.session$!.principal; }
  @Get('requests') @RequirePermission('integration.operate')
  list(@Req() req: AuthedRequest, @Query('status') status?: string) { return this.svc.list(this.p(req), { status }); }
  @Get('requests/:id') @RequirePermission('integration.operate')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.svc.get(this.p(req), id); }
  @Post('requests/:id/confirm') @HttpCode(200) @RequirePermission('integration.operate')
  confirm(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { externalRef?: string; note?: string }) { return this.svc.confirmByOperator(this.p(req), id, b); }
  @Post('requests/:id/resolve') @HttpCode(200) @RequirePermission('integration.operate')
  resolve(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { decision?: string; externalRef?: string; note?: string }) { return this.svc.resolveAmbiguous(this.p(req), id, b); }
  @Post('requests/:id/retry') @HttpCode(200) @RequirePermission('integration.operate')
  retry(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { note?: string }) { return this.svc.retry(this.p(req), id, b); }
  @Get('health') @RequirePermission('integration.operate')
  health(@Req() req: AuthedRequest) { return this.svc.health(this.p(req)); }
  @Post('reconciliation') @HttpCode(200) @RequirePermission('integration.operate')
  reconcile(@Req() req: AuthedRequest, @Body() b: { records?: Array<{ correlationId: string; externalRef: string }> }) { return this.svc.reconcileWith(this.p(req), b.records ?? []); }
}

@Controller('ops/integration')
export class IntegrationOpsController {
  constructor(private readonly svc: IntegrationService) {}
  /** Run by the scheduler's integration identity; sends due hand-offs once. */
  @Post('dispatch') @HttpCode(200) @RequirePermission('integration.invoke')
  dispatch(@Req() req: AuthedRequest) { return this.svc.dispatchDue(req.session$!.principal.institutionId); }
}

/** The authoritative system calls back here. Authenticated by signature, not by a session (INT-03). */
@Controller('integration/callbacks')
export class IntegrationCallbackController {
  constructor(private readonly svc: IntegrationService) {}
  @Public() @Post(':institution/:connector') @HttpCode(200)
  callback(@Param('institution') inst: string, @Param('connector') connector: string, @Headers('x-bbjp-timestamp') timestamp: string, @Headers('x-bbjp-signature') signature: string, @Body() body: Record<string, string>) {
    return this.svc.handleCallback(inst, connector, { timestamp, signature }, body ?? {});
  }
}

@Controller('customer/cases')
export class IntegrationCustomerController {
  constructor(private readonly svc: IntegrationService) {}
  @Get(':id/fulfilment') @RequirePermission('application.read')
  fulfilment(@Req() req: AuthedRequest, @Param('id') id: string) { return this.svc.customerView(req.session$!, id); }
}
