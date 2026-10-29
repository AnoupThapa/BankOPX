import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { TradeService } from './trade.service';

@Controller('staff')
export class TradeController {
  constructor(private readonly svc: TradeService) {}
  private p(r: AuthedRequest) { return r.session$!.principal; }
  @Get('cases/:id/trade/status') @RequirePermission('trade.read')
  status(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.status(this.p(r), id); }
  @Get('cases/:id/trade') @RequirePermission('trade.read')
  get(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.get(this.p(r), id); }
  @Post('cases/:id/trade') @HttpCode(201) @RequirePermission('trade.prepare')
  open(@Req() r: AuthedRequest, @Param('id') id: string) { return this.svc.open(this.p(r), id); }
  // The route needs one of two permissions depending on the event; the service decides which and checks the branch.
  @Post('cases/:id/trade/events') @HttpCode(201) @RequirePermission('trade.read')
  event(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { docKey?: string; event?: string; note?: string }) { return this.svc.record(this.p(r), id, b); }
  @Post('cases/:id/trade/key-dates') @HttpCode(201) @RequirePermission('trade.prepare')
  keyDate(@Req() r: AuthedRequest, @Param('id') id: string, @Body() b: { kind?: string; date?: string }) { return this.svc.setKeyDate(this.p(r), id, b); }
  @Get('trade/alerts') @RequirePermission('trade.read')
  alerts(@Req() r: AuthedRequest) { return this.svc.alerts(this.p(r)); }
}

@Controller('ops/trade')
export class TradeOpsController {
  constructor(private readonly svc: TradeService) {}
  /** Run by the scheduler's integration identity: flags key dates inside their alert window once. */
  @Post('run') @HttpCode(200) @RequirePermission('integration.invoke')
  run(@Req() r: AuthedRequest) { return this.svc.flagAlerts(r.session$!.principal.institutionId); }
}
