import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { AuthedRequest, Public, RequirePermission } from '../identity-access';
import { CaseService } from './case.service';

function file(req: AuthedRequest, ik: string | undefined) {
  if (!Buffer.isBuffer(req.body)) throw new BadRequestException('file body required');
  let name = 'file'; try { name = decodeURIComponent(String(req.header('x-file-name') ?? 'file')); } catch { /* keep default */ }
  const src = req.header('x-capture-source') === 'camera' ? 'camera' : 'upload';
  return { bytes: req.body as Buffer, declaredMime: req.header('content-type'), fileName: name, source: src as 'camera' | 'upload', idempotencyKey: ik };
}

/** Customer application API. Every object id is checked against the session's own profile; there is no way to name another customer's draft or case. */
@Controller('customer')
export class CaseController {
  constructor(private readonly cases: CaseService) {}
  private s(req: AuthedRequest) { return req.session$!; }

  @Put('applications/:serviceKey/draft') @HttpCode(200) @RequirePermission('application.write')
  saveDraft(@Req() req: AuthedRequest, @Param('serviceKey') k: string, @Body() b: { data?: unknown }) { return this.cases.saveDraft(this.s(req), k, b.data ?? {}); }

  @Get('applications/:serviceKey/draft') @RequirePermission('application.read')
  getDraft(@Req() req: AuthedRequest, @Param('serviceKey') k: string) { return this.cases.getDraft(this.s(req), k); }

  @Put('applications/:serviceKey/documents/:requirementKey') @HttpCode(201) @RequirePermission('application.write')
  uploadDraftDoc(@Req() req: AuthedRequest, @Param('serviceKey') k: string, @Param('requirementKey') r: string, @Headers('idempotency-key') ik?: string) {
    return this.cases.uploadDraftDocument(this.s(req), k, r, file(req, ik));
  }

  @Post('applications/:serviceKey/submit') @HttpCode(201) @RequirePermission('application.write')
  submit(@Req() req: AuthedRequest, @Param('serviceKey') k: string, @Headers('idempotency-key') ik?: string) { return this.cases.submit(this.s(req), k, ik); }

  @Get('cases') @RequirePermission('application.read')
  list(@Req() req: AuthedRequest) { return this.cases.listMine(this.s(req)); }

  @Get('cases/by-code/:code') @RequirePermission('application.read')
  byCode(@Req() req: AuthedRequest, @Param('code') c: string) { return this.cases.findMineByCode(this.s(req), c); }

  @Get('cases/:id') @RequirePermission('application.read')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.cases.getMine(this.s(req), id); }

  @Post('cases/:id/respond') @HttpCode(201) @RequirePermission('application.write')
  respond(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { data?: unknown }, @Headers('idempotency-key') ik?: string) { return this.cases.respond(this.s(req), id, b.data ?? {}, ik); }

  @Put('cases/:id/documents/:requirementKey') @HttpCode(201) @RequirePermission('application.write')
  uploadCaseDoc(@Req() req: AuthedRequest, @Param('id') id: string, @Param('requirementKey') r: string, @Headers('idempotency-key') ik?: string) { return this.cases.uploadCaseDocument(this.s(req), id, r, file(req, ik)); }
}

@Controller('staff/cases')
export class StaffCaseController {
  constructor(private readonly cases: CaseService) {}
  @Get() @RequirePermission('case.read')
  list(@Req() req: AuthedRequest) { return this.cases.staffList(req.session$!.principal); }
  @Get(':id') @RequirePermission('case.read')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.cases.staffGet(req.session$!.principal, id); }
  @Post(':id/notes') @HttpCode(201) @RequirePermission('case.review')
  note(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { body?: string }) { return this.cases.addNote(req.session$!.principal, id, b.body as string); }
  @Post(':id/info-requests') @HttpCode(201) @RequirePermission('case.review')
  request(@Req() req: AuthedRequest, @Param('id') id: string, @Body() b: { reasonCode?: string; customerText?: string; items?: never[]; dueAt?: string }) { return this.cases.requestInfo(req.session$!.principal, id, b); }
}

@Controller()
export class TrackController {
  constructor(private readonly cases: CaseService) {}
  /** Unauthenticated tracking-code lookups say nothing about whether a code exists (SUB-01, ADR-008). */
  @Public() @Post('track') @HttpCode(200)
  track() { return this.cases.publicTrack(); }
}
