import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { CatalogueService } from './catalogue.service';

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly svc: CatalogueService) {}
  @Get('services') @RequirePermission('catalogue.read')
  list(@Req() req: AuthedRequest, @Query() q: { channel?: string; branch?: string; currency?: string; segment?: string }) { return this.svc.list(req.session$!, q); }
  @Get('services/:key') @RequirePermission('catalogue.read')
  get(@Req() req: AuthedRequest, @Param('key') key: string) { return this.svc.get(req.session$!, key); }
}
