import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { BaselineInput, PilotService } from './pilot.service';

@Controller('staff/pilot')
export class PilotController {
  constructor(private readonly svc: PilotService) {}
  @Get('metrics') @RequirePermission('pilot.read')
  metrics(@Req() req: AuthedRequest, @Query('service') service?: string) { return this.svc.metrics(req.session$!.principal, service); }
  @Post('baselines') @HttpCode(201) @RequirePermission('pilot.baseline')
  baseline(@Req() req: AuthedRequest, @Body() b: BaselineInput) { return this.svc.recordBaseline(req.session$!.principal, b); }
}
