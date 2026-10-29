import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { DocumentService } from './document.service';

function send(res: Response, f: { bytes: Buffer; mime: string; sha256: string; name: string }) {
  // Private, never cached, never sniffed; delivered as an attachment so the browser does not render active content (DOC-04).
  res.set({ 'Content-Type': f.mime, 'Content-Length': String(f.bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="document-${f.sha256.slice(0, 12)}"`, ETag: `"${f.sha256}"` });
  res.end(f.bytes);
}

@Controller()
export class DocumentController {
  constructor(private readonly docs: DocumentService) {}
  private p(req: AuthedRequest) { return req.session$!.principal; }

  @Get('documents/:versionId/content') @RequirePermission('document.read')
  async content(@Req() req: AuthedRequest, @Param('versionId') id: string, @Res() res: Response) { send(res, await this.docs.read(this.p(req), id, 'view')); }

  @Post('documents/:versionId/link') @HttpCode(200) @RequirePermission('document.read')
  link(@Req() req: AuthedRequest, @Param('versionId') id: string) { return this.docs.issueLink(this.p(req), id); }

  @Get('documents/link/:token') @RequirePermission('document.read')
  async byLink(@Req() req: AuthedRequest, @Param('token') token: string, @Res() res: Response) { send(res, await this.docs.readByLink(this.p(req), token)); }

  @Post('staff/documents/:versionId/reviews') @HttpCode(201) @RequirePermission('case.review')
  review(@Req() req: AuthedRequest, @Param('versionId') id: string, @Body() b: { outcome?: string; reasonCode?: string; customerMessage?: string }) {
    return this.docs.review(this.p(req), id, String(b.outcome ?? ''), b.reasonCode, b.customerMessage);
  }
}
