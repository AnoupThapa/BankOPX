import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IntegrationService } from '../integration';
import { Db } from '../platform';
import { WorkflowService } from '../workflow';

/**
 * Runs the periodic work that must not depend on a person remembering to click: overdue escalations (WFL-08) and due hand-offs (INT-03).
 * Off unless BBJP_SCHEDULER=1, so tests and one-off tools never start timers. Safe to run on several instances: both jobs claim rows with SKIP LOCKED.
 * Logs counts only, never row content.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly log = new Logger('scheduler');
  constructor(private readonly db: Db, private readonly workflow: WorkflowService, private readonly integration: IntegrationService) {}

  onModuleInit() {
    if (process.env.BBJP_SCHEDULER !== '1') return;
    const every = Math.max(5, Number(process.env.BBJP_SCHEDULER_SECONDS ?? 60)) * 1000;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** One pass over every institution. Public so tests and operators can run it once. */
  async tick(): Promise<{ escalated: number; attempted: number }> {
    if (this.running) return { escalated: 0, attempted: 0 };                  // never overlap with itself
    this.running = true;
    const total = { escalated: 0, attempted: 0 };
    try {
      for (const id of await this.db.institutionIds()) {
        try {
          total.escalated += (await this.workflow.runDueEscalations(id)).escalated;
          total.attempted += (await this.integration.dispatchDue(id)).attempted;
        } catch { this.log.error('scheduler pass failed for one institution'); }   // no error text: it may carry data
      }
    } finally { this.running = false; }
    return total;
  }
}
