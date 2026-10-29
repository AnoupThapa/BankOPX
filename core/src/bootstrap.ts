import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import helmet from 'helmet';
import { AppLogger } from './platform';
import { rateLimit } from './platform/rate-limit';

/** Shared HTTP hardening for the real server and for tests (SEC-14, SEC-10). */
export function configureApp(app: INestApplication, logger: AppLogger = new AppLogger()): void {
  // Behind a reverse proxy/WAF set TRUST_PROXY (hop count, or 'true') so abuse limits see the real client address. Never set it when directly exposed.
  const tp = process.env.TRUST_PROXY;
  if (tp) app.getHttpAdapter().getInstance().set('trust proxy', tp === 'true' ? true : Number.isNaN(Number(tp)) ? tp : Number(tp));
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
  app.use(cookieParser());
  // File uploads arrive as the raw request body on PUT .../documents/:key only (no multipart parser, so no multipart attack surface). 11 MB > the 10 MB hard cap, so the cap is enforced by validation with a clear error.
  app.use(raw({ type: (req) => req.method === 'PUT' && /\/documents\/[^/]+$/.test((req as { path?: string; url?: string }).path ?? req.url ?? ''), limit: '11mb' }));
  app.use('/customer/applications', rateLimit(Number(process.env.UPLOAD_ROUTE_RATE_MAX ?? 300), 60_000));
  app.use('/track', rateLimit(Number(process.env.TRACK_RATE_MAX ?? 30), 60_000));
  app.use('/customer/otp', rateLimit(Number(process.env.OTP_ROUTE_RATE_MAX ?? 60), 60_000));
  app.use('/integration/callbacks', rateLimit(Number(process.env.CALLBACK_RATE_MAX ?? 120), 60_000));
  app.use('/auth/login', rateLimit(Number(process.env.LOGIN_RATE_MAX ?? 20), 60_000));
  app.useLogger(logger);
}
