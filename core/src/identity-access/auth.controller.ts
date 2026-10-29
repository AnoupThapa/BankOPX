import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthedRequest, COOKIE_NAME } from './auth.guard';
import { Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() b: { institution?: string; username?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(String(b.institution ?? ''), String(b.username ?? ''), String(b.password ?? ''));
    // HttpOnly + SameSite=Strict + Secure (IDN-09, SEC-14). The cookie carries no personal data.
    res.cookie(COOKIE_NAME, r.cookie, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { mfaRequired: r.mfaRequired, csrfToken: r.csrfToken };
  }

  @Post('mfa/verify') @HttpCode(204)
  async mfa(@Body() b: { code?: string }, @Req() req: Request) {
    await this.auth.verifyMfa(req.cookies?.[COOKIE_NAME], String(b.code ?? ''));
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME);
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    const p = req.session$!.principal;
    return { userId: p.userId, actorType: p.actorType, mfaVerified: p.mfaVerified };
  }
}
