import { LoggerService } from '@nestjs/common';
import { redact } from './redact';

/** JSON application logger. Application logs are redacted and are NOT the audit trail (ADR-021). */
export class AppLogger implements LoggerService {
  constructor(private readonly sink: (line: string) => void = (l) => process.stdout.write(l + '\n')) {}
  private emit(level: string, message: unknown, ctx?: string) {
    this.sink(JSON.stringify({ t: new Date().toISOString(), level, ctx, msg: redact(typeof message === 'string' ? message : message) }));
  }
  log(m: unknown, ctx?: string) { this.emit('info', m, ctx); }
  error(m: unknown, _trace?: string, ctx?: string) { this.emit('error', m, ctx); }
  warn(m: unknown, ctx?: string) { this.emit('warn', m, ctx); }
  debug(m: unknown, ctx?: string) { this.emit('debug', m, ctx); }
}
