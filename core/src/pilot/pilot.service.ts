import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit';
import { CaseService } from '../case';
import { Principal, scopedBranchIds } from '../identity-access';
import { IntegrationService } from '../integration';
import { Db } from '../platform';
import { TatService } from '../tat-sla';

export const BASELINE_METRICS = ['visits_per_request', 'end_to_end_tat_hours', 'resubmission_rate', 'handling_minutes'] as const;
export type BaselineMetric = (typeof BASELINE_METRICS)[number];
export interface BaselineInput { serviceKey?: string; metric?: string; value?: number; method?: string; sampleSize?: number; periodStart?: string; periodEnd?: string }

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Pilot measurements (docs/20). Measured values come from the event history and the case and hand-off records. Baselines are entered by the bank
 * with method, sample size and period; the platform never fills one in or computes a "saving" from numbers nobody validated (§20 preamble).
 */
@Injectable()
export class PilotService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly tat: TatService, private readonly cases: CaseService, private readonly integration: IntegrationService) {}

  async recordBaseline(p: Principal, b: BaselineInput) {
    const metric = String(b.metric ?? '');
    if (!BASELINE_METRICS.includes(metric as BaselineMetric)) throw new BadRequestException('invalid_metric');
    if (!/^[a-z0-9_.-]{1,64}$/.test(String(b.serviceKey ?? ''))) throw new BadRequestException('invalid_service');
    if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) throw new BadRequestException('invalid_value');
    if (metric === 'resubmission_rate' && b.value > 1) throw new BadRequestException('rate_must_be_between_0_and_1');
    if (!Number.isInteger(b.sampleSize) || (b.sampleSize as number) < 1) throw new BadRequestException('sample_size_required');
    const method = String(b.method ?? '').trim();
    if (method.length < 3 || method.length > 500) throw new BadRequestException('method_required');
    if (!isDate(b.periodStart) || !isDate(b.periodEnd) || b.periodEnd! < b.periodStart!) throw new BadRequestException('period_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const r = await tx.query(
        `INSERT INTO pilot_baseline (institution_id, service_key, metric, value, method, sample_size, period_start, period_end, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING seq`,
        [p.institutionId, b.serviceKey, metric, b.value, method, b.sampleSize, b.periodStart, b.periodEnd, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'pilot.baseline_recorded', objectType: 'pilot_baseline', objectId: String(r.rows[0].seq), detail: { metric, service: b.serviceKey } });
      return { seq: Number(r.rows[0].seq) };
    });
  }

  /** Latest baseline per metric for a service, with its method, sample and period so the number is checkable. */
  async baselines(p: Principal, serviceKey: string) {
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT DISTINCT ON (metric) metric, value::float8 value, method, sample_size, period_start::text period_start, period_end::text period_end, recorded_at
         FROM pilot_baseline WHERE service_key=$1 ORDER BY metric, seq DESC`, [serviceKey])).rows
      .map((r) => ({ metric: r.metric, value: r.value, method: r.method, sampleSize: r.sample_size, periodStart: r.period_start, periodEnd: r.period_end, recordedAt: r.recorded_at })));
  }

  /** Measured pilot figures next to the recorded baselines. Where there is no baseline the comparison is absent, not guessed. */
  async metrics(p: Principal, serviceKey?: string) {
    const branches = scopedBranchIds(p, 'pilot.read');
    const [tat, counts, handoffs, base] = await Promise.all([
      this.tat.summary(p, { serviceKey }), this.cases.pilotCounts(p, branches, serviceKey), this.integration.counts(p, serviceKey), serviceKey ? this.baselines(p, serviceKey) : Promise.resolve([]),
    ]);
    const decided = counts.approved + counts.declined;
    const rate = (n: number, d: number) => (d > 0 ? n / d : null);
    return {
      asOf: new Date().toISOString(), serviceKey: serviceKey ?? null,
      definitions: {
        submitted: 'Applications that reached the bank (drafts are not counted).',
        resubmissionRate: 'Share of submitted applications that were sent back to the customer at least once.',
        handoffSuccess: 'Share of hand-offs confirmed by the authoritative system. A request that was only sent does not count (INT-01).',
        tat: 'See the turnaround page: bank time and customer wait are separate; source is the event history.',
        baseline: 'Entered by the bank with method, sample and period. Not computed by the platform.',
      },
      cases: { ...counts, decided, resubmissionRate: rate(counts.returnedAtLeastOnce, counts.submitted) },
      handoffs: { ...handoffs, successRate: rate(handoffs.confirmed, handoffs.total) },
      tat, baselines: base,
      comparison: base.length ? 'Compare each measured figure with its baseline only if the baseline method and sample are accepted by the bank.' : 'No baseline recorded yet: no improvement can be stated.',
    };
  }
}
