import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthedRequest, COOKIE_NAME, Public, RequirePermission } from '../identity-access';
import { ProfileService } from './profile.service';

const ip = (r: Request) => r.ip ?? 'unknown';

/**
 * Customer-facing API. No route takes a profile id: the profile always comes from the session (SEC-02),
 * so one customer cannot name another customer's data.
 */
@Controller('customer')
export class CustomerController {
  constructor(private readonly profiles: ProfileService) {}
  private s(req: AuthedRequest) { return req.session$!; }

  @Public() @Post('otp/request') @HttpCode(202)
  request(@Body() b: { institution?: string; channel?: 'email' | 'mobile'; destination?: string }, @Req() req: Request) {
    return this.profiles.requestSignIn(String(b.institution ?? ''), b.channel as 'email', String(b.destination ?? ''), ip(req));
  }

  @Public() @Post('otp/verify') @HttpCode(200)
  async verify(@Body() b: { institution?: string; challengeId?: string; code?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.profiles.completeSignIn(String(b.institution ?? ''), String(b.challengeId ?? ''), String(b.code ?? ''));
    res.cookie(COOKIE_NAME, r.cookie, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { csrfToken: r.csrfToken, isNewProfile: r.isNewProfile };
  }

  @Post('stepup/request') @HttpCode(202) @RequirePermission('profile.read')
  stepUpRequest(@Req() req: AuthedRequest) { return this.profiles.requestStepUp(this.s(req), ip(req)); }

  @Post('stepup/verify') @HttpCode(204) @RequirePermission('profile.read')
  stepUpVerify(@Req() req: AuthedRequest, @Body() b: { challengeId?: string; code?: string }) { return this.profiles.completeStepUp(this.s(req), String(b.challengeId ?? ''), String(b.code ?? '')); }

  @Get('profile') @RequirePermission('profile.read')
  profile(@Req() req: AuthedRequest) { return this.profiles.getProfile(this.s(req)); }

  @Put('profile/fields/:key') @HttpCode(204) @RequirePermission('profile.write')
  field(@Req() req: AuthedRequest, @Param('key') key: string, @Body() b: { value?: string }) { return this.profiles.setField(this.s(req), key, b.value as string); }

  @Post('profile/fields/:key/confirm') @HttpCode(204) @RequirePermission('profile.write')
  confirm(@Req() req: AuthedRequest, @Param('key') key: string) { return this.profiles.confirmField(this.s(req), key); }

  @Get('consent/notices') @RequirePermission('consent.write')
  notices(@Req() req: AuthedRequest) { return this.profiles.listNotices(this.s(req)); }

  @Post('consent') @HttpCode(204) @RequirePermission('consent.write')
  consent(@Req() req: AuthedRequest, @Body() b: { noticeVersionId?: string; granted?: unknown }) { return this.profiles.recordConsent(this.s(req), String(b.noticeVersionId ?? ''), b.granted); }

  @Put('drafts/:serviceKey') @HttpCode(204) @RequirePermission('draft.write')
  saveDraft(@Req() req: AuthedRequest, @Param('serviceKey') k: string, @Body() b: { data?: unknown }) { return this.profiles.saveDraft(this.s(req), k, b.data); }

  @Get('drafts/:serviceKey') @RequirePermission('draft.write')
  getDraft(@Req() req: AuthedRequest, @Param('serviceKey') k: string) { return this.profiles.getDraft(this.s(req), k); }

  @Post('profile/link') @HttpCode(200) @RequirePermission('profile.link')
  link(@Req() req: AuthedRequest, @Body() b: { accountNumber?: string; verification?: Record<string, string> }) { return this.profiles.link(this.s(req), b.accountNumber as string, b.verification ?? {}); }

  @Get('accounts') @RequirePermission('profile.link')
  accounts(@Req() req: AuthedRequest) { return this.profiles.accounts(this.s(req)); }
}
