import { Injectable } from '@nestjs/common';
import { Db, Tx } from '../platform';
import { Principal, scopedBranchIds } from '../identity-access';
import { CaseTat, computeCaseTat, distribution, Phase, TatEvent, WaitParty } from './tat';

export interface TatEventInput { caseId: string; branchId?: string | null; serviceKey?: string | null; eventType: string; stageKey?: string | null; actorId?: string | null; waitParty: WaitParty; phase: Phase; pauseReason?: string }

/** Canonical, append-only TAT event history and the dashboards derived from it (TAT-01..05, TAT-07). */
@Injectable()
export class TatService {
  constructor(private readonly db: Db) {}

  async record(tx: Tx, institutionId: string, e: TatEventInput): Promise<void> {
    await tx.query('INSERT INTO tat_event (institution_id, case_id, branch_id, service_key, event_type, stage_key, actor_id, wait_party, phase, pause_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [institutionId, e.caseId, e.branchId ?? null, e.serviceKey ?? null, e.eventType, e.stageKey ?? null, e.actorId ?? null, e.waitParty, e.phase, e.pauseReason ?? null]);
  }

  async eventsFor(tx: Tx, caseId: string): Promise<TatEvent[]> {
    return (await tx.query('SELECT seq, ts_utc, event_type, stage_key, wait_party, phase FROM tat_event WHERE case_id=$1 ORDER BY seq', [caseId])).rows
      .map((r) => ({ seq: Number(r.seq), tsUtc: r.ts_utc as Date, eventType: r.event_type, stageKey: r.stage_key, waitParty: r.wait_party, phase: r.phase }));
  }

  async forCase(tx: Tx, caseId: string, asOf = new Date()): Promise<CaseTat> { return computeCaseTat(await this.eventsFor(tx, caseId), asOf); }

  /**
   * Dashboard figures from the event history for the viewer's branches. Every metric carries its definition, source and as-of time (TAT-07).
   * There is no per-employee figure anywhere in this response on purpose (TAT-06). SLA compliance and open-task counts come from the workflow module.
   */
  async summary(p: Principal, f: { serviceKey?: string } = {}) {
    const branches = scopedBranchIds(p, 'tat.read');
    const asOf = new Date();
    const meta = {
      asOf: asOf.toISOString(), source: 'tat_event (append-only event history); SLA figures from the workflow task records', owner: 'Operations (to be named by the bank)', freshness: 'live',
      definitions: {
        bank: 'Time the case spent waiting in a queue or being worked by the bank, excluding any time waiting for the customer.',
        customerWait: 'Time from a request to the customer being issued until the response is received. Never included in bank time.',
        elapsed: 'First submission to decision (closed cases) or to now (open cases).',
        slaCompliance: 'Share of finished tasks completed on or before their due time; the due time moves forward while the customer is being waited for.',
      },
    };
    const empty = { meta, scope: 'none' as const, cases: 0, closedCases: 0, bank: distribution([]), customerWait: distribution([]), elapsed: distribution([]), byStage: {} as Record<string, never> };
    if (!branches.length) return empty;
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ids = (await tx.query(`SELECT DISTINCT case_id FROM tat_event WHERE branch_id = ANY($1::uuid[]) AND ($2::text IS NULL OR service_key=$2)`, [branches, f.serviceKey ?? null])).rows.map((r) => r.case_id as string);
      const per: CaseTat[] = [];
      for (const id of ids) per.push(await this.forCase(tx, id, asOf));
      const stages: Record<string, { bank: number[]; customerWait: number[] }> = {};
      for (const t of per) for (const [k, s] of Object.entries(t.byStage)) { (stages[k] ??= { bank: [], customerWait: [] }).bank.push(s.queueMs + s.activeMs); stages[k]!.customerWait.push(s.customerWaitMs); }
      return {
        meta, scope: 'branches' as const, cases: per.length, closedCases: per.filter((t) => t.closed).length,
        bank: distribution(per.map((t) => t.bankMs)), customerWait: distribution(per.map((t) => t.customerWaitMs)), elapsed: distribution(per.map((t) => t.elapsedMs)),
        byStage: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, { bank: distribution(v.bank), customerWait: distribution(v.customerWait) }])) as Record<string, { bank: ReturnType<typeof distribution>; customerWait: ReturnType<typeof distribution> }>,
      };
    });
  }
}
