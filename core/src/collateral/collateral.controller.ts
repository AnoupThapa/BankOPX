import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { CollateralService } from './collateral.service';

@Controller('staff')
export class CollateralController {
  constructor(private readonly svc: CollateralService) {}
  private p(r: AuthedRequest) { return r.session$!.principal; }
  @Get('cases/:id/collateral/status') @RequirePermission('collateral.read')
  status(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.status(this.p(r), id); }
  @Get('cases/:id/collateral') @RequirePermission('collateral.read')
  get(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.get(this.p(r), id); }
  @Post('cases/:id/collateral') @HttpCode(201) @RequirePermission('collateral.prepare')
  open(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.open(this.p(r), id); }
  @Post('cases/:id/collateral/holdings') @HttpCode(201) @RequirePermission('collateral.prepare')
  holding(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: Parameters<CollateralService['addHolding']>[2]) { return this.svc.addHolding(this.p(r), id, b); }
  @Post('cases/:id/collateral/prices') @HttpCode(201) @RequirePermission('collateral.prepare')
  price(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: Parameters<CollateralService['recordPrice']>[2]) { return this.svc.recordPrice(this.p(r), id, b); }
  @Post('cases/:id/collateral/value') @HttpCode(200) @RequirePermission('collateral.prepare')
  value(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { existingExposure?: string }) { return this.svc.value(this.p(r), id, b ?? {}); }
  @Post('cases/:id/collateral/margin-calls') @HttpCode(201) @RequirePermission('collateral.margin')
  issue(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { note?: string }) { return this.svc.issueMarginCall(this.p(r), id, b); }
  @Post('cases/:id/collateral/margin-calls/:mid/resolve') @HttpCode(200) @RequirePermission('collateral.margin')
  resolve(@Req() r: AuthedRequest, @Param('id') id: string, @Param('mid') mid: string, @Body() b: { resolution?: string; evidence?: string }) { return this.svc.resolveMarginCall(this.p(r), id, mid, b); }
  @Post('cases/:id/collateral/pledges') @HttpCode(201) @RequirePermission('collateral.pledge_record')
  pledge(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: Parameters<CollateralService['recordPledge']>[2]) { return this.svc.recordPledge(this.p(r), id, b); }
  @Get('collateral/margin-calls') @RequirePermission('collateral.read')
  calls(@Req() r: AuthedRequest, @Query('overdue') overdue?: string) { return this.svc.openCalls(this.p(r), { overdue: overdue === 'true' }); }
  @Get('collateral/portfolio') @RequirePermission('collateral.read')
  portfolio(@Req() r: AuthedRequest) { return this.svc.portfolio(this.p(r)); }
}

@Controller('ops/collateral')
export class CollateralOpsController {
  constructor(private readonly svc: CollateralService) {}
  /** Run by the scheduler's integration identity: flags overdue margin calls once. */
  @Post('run') @HttpCode(200) @RequirePermission('integration.invoke')
  run(@Req() r: AuthedRequest) { return this.svc.flagOverdue(r.session$!.principal.institutionId); }
}
