import { NextFunction, Request, Response } from 'express';

/** Small in-memory fixed-window limiter for unauthenticated endpoints (SEC-10, IDN-01 pattern). Production should add a WAF / shared store. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const k = req.ip ?? 'unknown';
    const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) { res.status(429).json({ message: 'too many requests' }); return; }
    next();
  };
}
