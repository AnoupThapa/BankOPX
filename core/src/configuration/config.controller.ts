import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { ConfigService } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly cfg: ConfigService) {}
  private p(req: AuthedRequest) { return req.session$!.principal; }

  @Post('drafts') @RequirePermission('config.draft')
  draft(@Req() req: AuthedRequest, @Headers('idempotency-key') ik: string | undefined, @Body() b: { kind: string; key: string; content: Record<string, unknown>; reason: string }) {
    return this.cfg.createDraft(this.p(req), b.kind, b.key, b.content, b.reason, ik);
  }
  @Post('versions/:id/submit') @RequirePermission('config.submit')
  submit(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { reason: string }) { return this.cfg.submit(this.p(req), id, b.reason); }
  @Post('versions/:id/approve') @RequirePermission('config.approve')
  approve(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { reason: string }) { return this.cfg.approve(this.p(req), id, b.reason); }
  @Post('versions/:id/reject') @RequirePermission('config.approve')
  reject(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { reason: string }) { return this.cfg.reject(this.p(req), id, b.reason); }
  @Post('definitions/:id/rollback') @RequirePermission('config.draft')
  rollback(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { toVersion: number; reason: string }) { return this.cfg.rollback(this.p(req), id, b.toVersion, b.reason); }
  @Post('definitions/:id/disable') @RequirePermission('config.disable')
  disable(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { disabled: boolean; reason: string }) { return this.cfg.setDisabled(this.p(req), id, b.disabled, b.reason); }
  @Get('review-queue') @RequirePermission('config.read')
  queue(@Req() req: AuthedRequest, @Query('kind') kind?: string) { return this.cfg.reviewQueue(this.p(req), kind); }
  @Post('validate') @RequirePermission('config.draft')
  validate(@Req() req: AuthedRequest, @Body() b: { kind: string; content: Record<string, unknown> }) { return this.cfg.validateDraft(this.p(req), b.kind, b.content ?? {}); }
  @Get('versions/:id') @RequirePermission('config.read')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.cfg.getVersion(this.p(req), id); }
}
