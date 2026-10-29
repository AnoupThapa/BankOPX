import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { CreditService } from './credit.service';

@Controller('staff')
export class CreditController {
  constructor(private readonly svc: CreditService) {}
  private p(req: AuthedRequest) { return req.session$!.principal; }
  @Get('cases/:id/credit/status') @RequirePermission('credit.read')
  status(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.status(this.p(r), id); }
  @Get('cases/:id/credit') @RequirePermission('credit.read')
  get(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.get(this.p(r), id); }
  @Post('cases/:id/credit') @HttpCode(201) @RequirePermission('credit.prepare')
  open(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { proposalTypeKey?: string }, @Headers('idempotency-key') ik?: string) { return this.svc.open(this.p(r), id, b, ik); }
  @Post('cases/:id/credit/parties') @HttpCode(201) @RequirePermission('credit.prepare')
  party(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { role?: string; name?: string; note?: string }) { return this.svc.addParty(this.p(r), id, b); }
  @Post('cases/:id/credit/inputs') @HttpCode(201) @RequirePermission('credit.prepare')
  input(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { key?: string; partyId?: string; value?: string; asOf?: string; source?: string; evidenceNote?: string }) { return this.svc.setInput(this.p(r), id, b); }
  @Post('cases/:id/credit/external-checks') @HttpCode(201) @RequirePermission('credit.prepare')
  externalCheck(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { partyId?: string; provider?: string; lawfulBasis?: string; consentEvidence?: string }) { return this.svc.requestExternalCheck(this.p(r), id, b); }
  @Post('cases/:id/credit/assess') @HttpCode(200) @RequirePermission('credit.prepare')
  assess(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.assess(this.p(r), id); }
  @Post('cases/:id/credit/checklist') @HttpCode(201) @RequirePermission('credit.prepare')
  answer(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { itemKey?: string; answer?: string; note?: string }) { return this.svc.answer(this.p(r), id, b); }
  @Post('cases/:id/credit/recommendation') @HttpCode(201) @RequirePermission('credit.prepare')
  recommend(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: Parameters<CreditService['recommend']>[3], @Headers('idempotency-key') ik?: string) { return this.svc.recommend(this.p(r), id, ik, b); }
  @Post('cases/:id/credit/conditions') @HttpCode(201) @RequirePermission('credit.prepare')
  condition(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: Parameters<CreditService['addCondition']>[3], @Headers('idempotency-key') ik?: string) { return this.svc.addCondition(this.p(r), id, ik, b); }
  @Post('cases/:id/credit/conditions/:cid/clear') @HttpCode(200) @RequirePermission('credit.condition_clear')
  clear(@Req() r: AuthedRequest, @Param('id') id: string, @Param('cid') cid: string, @Body() b: { note?: string }) { return this.svc.clearCondition(this.p(r), id, cid, b); }
  @Get('credit/portfolio') @RequirePermission('credit.read')
  portfolio(@Req() r: AuthedRequest) { return this.svc.portfolio(this.p(r)); }
  @Get('credit/conditions') @RequirePermission('credit.read')
  conditions(@Req() r: AuthedRequest, @Query('overdue') overdue?: string) { return this.svc.conditions(this.p(r), { overdue: overdue === 'true' }); }
}

@Controller('ops/credit')
export class CreditOpsController {
  constructor(private readonly svc: CreditService) {}
  /** Run by the scheduler's integration identity: sends requested external checks and flags overdue conditions. */
  @Post('run') @HttpCode(200) @RequirePermission('integration.invoke')
  run(@Req() r: AuthedRequest) { return this.svc.runDue(r.session$!.principal.institutionId); }
}
