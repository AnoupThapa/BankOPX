import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppLogger } from './platform';
import { rateLimit } from './platform/rate-limit';

/** Shared HTTP hardening for the real server and for tests (SEC-14, SEC-10). */
export function configureApp(app: INestApplication, logger: AppLogger = new AppLogger()): void {
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
  app.use(cookieParser());
  app.use('/auth/login', rateLimit(Number(process.env.LOGIN_RATE_MAX ?? 20), 60_000));
  app.useLogger(logger);
}
