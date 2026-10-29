import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
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
  app.use('/customer/otp', rateLimit(Number(process.env.OTP_ROUTE_RATE_MAX ?? 60), 60_000));
  app.use('/auth/login', rateLimit(Number(process.env.LOGIN_RATE_MAX ?? 20), 60_000));
  app.useLogger(logger);
}
