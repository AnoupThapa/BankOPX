import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../audit';
import { CaseContext, CaseService } from '../case';
import { ConfigService, ConfigValidatorRegistry } from '../configuration';
import { AccessService, AuthService, decide, Principal, scopedBranchIds } from '../identity-access';
import { IntegrationService } from '../integration';
import { NotificationService } from '../notification';
import { Db, Idempotency, Tx } from '../platform';
import { TatEventInput, TatService } from '../tat-sla';
import { priorityOf } from './priority';
import { ApprovalNode, EndNode, ParallelNode, TaskNode, WorkflowDef } from './workflow-schema';
import { workflowValidator } from './workflow-publish-checks';

export type Outcome = 'complete' | 'return' | 'escalate' | 'approve' | 'decline';
export interface CompleteBody { outcome?: string; rationale?: string; recommendation?: string; reasonCode?: string; customerText?: string; items?: Array<{ type: 'field' | 'document' | 'question'; key: string; text: string }>; dueAt?: string }
interface TaskRow { branch_id: string | null; tracking_code: string; service_key: string; id: string; case_id: string; instance_id: string; node_key: string; fork_key: string | null; requires_permission: string; queue: string; status: string; assignee_id: string | null; due_at: Date | null; paused_at: Date | null; escalated_at: Date | null }
export interface Eligibility { allowed: boolean; reason: string; checks: Array<{ check: string; ok: boolean; detail?: string }> }

const SYSTEM = { id: '00000000-0000-0000-0000-000000000000', type: 'system' };

/**
 * The workflow engine (ADR-027). One definition version per case (WFL-07); every state change goes through the case transition function (WFL-03/04);
 * humans decide and the engine only routes (DEC-01, DEC-06). Nothing here approves or declines on its own: approval and decline are task outcomes chosen by an authorised person.
 */
@Injectable()
export class WorkflowService implements OnModuleInit {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly access: AccessService, private readonly auth: AuthService, private readonly config: ConfigService,
    private readonly cases: CaseService, private readonly tat: TatService, private readonly notes: NotificationService, private readonly idem: Idempotency, private readonly validators: ConfigValidatorRegistry, private readonly integration: IntegrationService,
  ) {}

  onModuleInit() {
    this.validators.register(workflowValidator);
    this.cases.registerHooks({ onSubmitted: (tx, c, a) => this.onSubmitted(tx, c, a), onResponded: (tx, c) => this.onResponded(tx, c) });
  }

  /** TAT events carry the case's branch and service so dashboards need no join into the case tables. */
  private tatEvent(tx: Tx, c: { institutionId: string; caseId: string; branchId: string | null; serviceKey: string }, e: Omit<TatEventInput, 'caseId' | 'branchId' | 'serviceKey'>) {
    return this.tat.record(tx, c.institutionId, { ...e, caseId: c.caseId, branchId: c.branchId, serviceKey: c.serviceKey });
  }

  // ---------- definitions ----------
  private async defOf(tx: Tx, inst: string, versionId: string): Promise<WorkflowDef> {
    const v = await this.config.getPinnedVersion(inst, 'workflow', versionId, tx);
    if (!v) throw new ServiceUnavailableException('workflow_unavailable');
    return v.content as unknown as WorkflowDef;
  }

  // ---------- start (inside the submission transaction) ----------
  private async onSubmitted(tx: Tx, c: CaseContext, actor: { id: string; type: string }) {
    const svc = await this.config.getPinnedVersion(c.institutionId, 'service', c.serviceVersionId, tx);
    const key = svc?.content.workflowKey as string | undefined;
    if (!key) return;                                                             // service without a workflow: Phase 3 behaviour
    const wf = await this.config.getPublished(c.institutionId, 'workflow', key, tx);
    if (!wf) throw new ServiceUnavailableException('workflow_unavailable');       // fail closed: never create a case nobody can process
    const instanceId = (await tx.query(`INSERT INTO workflow_instance (institution_id, case_id, workflow_version_id) VALUES ($1,$2,$3) RETURNING id`, [c.institutionId, c.caseId, wf.id])).rows[0].id as string;
    await this.cases.attachWorkflow(tx, c.caseId, wf.id);
    await this.tatEvent(tx, c, { eventType: 'case_submitted', actorId: actor.id, waitParty: 'bank', phase: 'queue' });
    await this.cases.transition(tx, c.institutionId, c.caseId, 'in_review', { ...SYSTEM }, 'workflow started');
    await this.notes.notify(tx, c.institutionId, { profileId: c.profileId, caseId: c.caseId, template: 'case_received', code: c.trackingCode! });
    await this.audit.record(tx, { institutionId: c.institutionId, actorType: 'system', action: 'workflow.started', objectType: 'app_case', objectId: c.caseId, detail: { workflow: key } });
    await this.enter(tx, c, instanceId, wf.content as unknown as WorkflowDef, (wf.content as unknown as WorkflowDef).start);
  }

  // ---------- entering nodes ----------
  private async enter(tx: Tx, c: CaseContext, instanceId: string, def: WorkflowDef, nodeKey: string, forkKey?: string): Promise<void> {
    const node = def.nodes[nodeKey]!;
    if (node.type === 'task' || node.type === 'approval') { await this.openTask(tx, c, instanceId, nodeKey, node, forkKey); return; }
    if (node.type === 'parallel') { for (const b of (node as ParallelNode).branches) await this.openTask(tx, c, instanceId, b, def.nodes[b] as TaskNode, nodeKey); return; }
    await this.finish(tx, c, instanceId, node as EndNode);
  }

  private async openTask(tx: Tx, c: CaseContext, instanceId: string, nodeKey: string, node: TaskNode | ApprovalNode, forkKey?: string) {
    const id = (await tx.query(
      `INSERT INTO case_task (institution_id, case_id, instance_id, node_key, fork_key, requires_permission, queue, branch_id, tracking_code, service_key, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + ($11 || ' hours')::interval) RETURNING id`,
      [c.institutionId, c.caseId, instanceId, nodeKey, forkKey ?? null, node.permission, node.queue, c.branchId, c.trackingCode, c.serviceKey, String(node.sla.targetHours)])).rows[0].id as string;
    await this.tatEvent(tx, c, { eventType: 'stage_entered', stageKey: nodeKey, waitParty: 'bank', phase: 'queue' });
    await this.audit.record(tx, { institutionId: c.institutionId, actorType: 'system', action: 'task.opened', objectType: 'case_task', objectId: id, detail: { node: nodeKey, queue: node.queue } });
  }

  private async finish(tx: Tx, c: CaseContext, instanceId: string, end: EndNode) {
    // The case state moves to the outcome the human decision already chose; the end node only closes the loop (DEC-06).
    await this.cases.transition(tx, c.institutionId, c.caseId, end.outcome, { ...SYSTEM }, `workflow ended: ${end.outcome}`, { message: end.customerMessage });
    await tx.query(`UPDATE workflow_instance SET status='completed' WHERE id=$1`, [instanceId]);
    await tx.query(`UPDATE case_task SET status='cancelled', completed_at=now() WHERE case_id=$1 AND status IN ('open','waiting_customer')`, [c.caseId]);
    await this.tatEvent(tx, c, { eventType: 'case_closed', waitParty: 'system', phase: 'closed' });
    // INT-02, ADR-017: the hand-off request commits with the decision, so a decision can never exist without its hand-off. Declines create none.
    if (end.outcome === 'approved') await this.integration.enqueueForApprovedCase(tx, c);
    await this.notes.notify(tx, c.institutionId, { profileId: c.profileId, caseId: c.caseId, template: 'decision_made', code: c.trackingCode! });
  }

  // ---------- customer response (inside the response transaction) ----------
  private async onResponded(tx: Tx, c: CaseContext) {
    const wf = (await this.cases.contextOf(tx, c.caseId))?.workflowVersionId;
    if (!wf) return;
    const waiting = (await tx.query(`SELECT id, node_key, paused_at FROM case_task WHERE case_id=$1 AND status='waiting_customer' FOR UPDATE`, [c.caseId])).rows;
    for (const t of waiting) {
      // RET-05: back to the stage that asked; the SLA clock resumes with the paused time added back (TAT-04).
      await tx.query(`UPDATE case_task SET status='open', due_at = due_at + (now() - paused_at), paused_at = NULL, responded_at = now() WHERE id=$1`, [t.id]);
    }
    await this.tatEvent(tx, c, { eventType: 'customer_responded', stageKey: waiting[0]?.node_key ?? null, waitParty: 'bank', phase: 'queue' });
    await this.cases.transition(tx, c.institutionId, c.caseId, 'in_review', { ...SYSTEM }, 'customer response received');
    await this.audit.record(tx, { institutionId: c.institutionId, actorType: 'system', action: 'task.resumed', objectType: 'app_case', objectId: c.caseId, detail: { tasks: waiting.length } });
    await this.notes.notify(tx, c.institutionId, { profileId: c.profileId, caseId: c.caseId, template: 'corrections_received', code: c.trackingCode! });
  }

  // ---------- eligibility (SEC-12, APR-01..04) ----------
  private async loadTask(tx: Tx, taskId: string, lock = false): Promise<TaskRow> {
    if (!/^[0-9a-f-]{36}$/.test(String(taskId))) throw new NotFoundException();
    const t = (await tx.query(`SELECT * FROM case_task WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [taskId])).rows[0];
    if (!t) throw new NotFoundException();
    return t;
  }

  /** Runs every check the decision panel shows. Same function backs the preview and the real action, so they cannot disagree. */
  async eligibility(tx: Tx, p: Principal, t: TaskRow, def: WorkflowDef): Promise<Eligibility> {
    const node = def.nodes[t.node_key] as TaskNode | ApprovalNode;
    const ctx = (await this.cases.contextOf(tx, t.case_id))!;
    const checks: Eligibility['checks'] = [];
    let amount: number | undefined; let applicantId: string | undefined;
    // Anything that needs the approval authority (an approval, or a task escalated to approvers) is checked against the amount and the applicant (APR-01, APR-03).
    if (node.type === 'approval' || t.requires_permission === 'case.approve') {
      const data = await this.cases.latestData(tx, t.case_id);
      const appr = node.type === 'approval' ? node : (Object.values(def.nodes).find((n) => n.type === 'approval') as ApprovalNode | undefined);
      const raw = appr?.amountField ? data[appr.amountField] : undefined;
      amount = appr?.nonMonetary ? 0 : typeof raw === 'number' ? raw : undefined;
      applicantId = (await this.cases.applicantUserId(tx, ctx.profileId)) ?? undefined;
    }
    const d = decide(p, t.requires_permission as 'case.review', { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined, amount, applicantId });
    // Inside the branch but over the limit is a different answer from "not yours": the approver is told, others see nothing (APR-03).
    const inScope = t.requires_permission === 'case.approve' && !d.allow && decide(p, t.requires_permission as 'case.review', { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined, amount: 0, applicantId }).allow;
    checks.push({ check: 'permission_and_scope', ok: d.allow, detail: d.allow ? undefined : inScope ? 'above_authority_limit' : d.reason });
    if (node.type === 'approval' || t.requires_permission === 'case.approve') {
      checks.push({ check: 'applicant_is_not_decider', ok: applicantId !== p.userId });
      if (node.type === 'approval' && node.amountField) checks.push({ check: 'amount_known', ok: amount !== undefined, detail: amount === undefined ? `no number found in '${node.amountField}'` : undefined });
      // maker-checker (APR-02): people who completed the listed earlier stages may not decide.
      const prior = node.type === 'approval' && node.separateFrom?.length ? (await tx.query(`SELECT 1 FROM case_task WHERE case_id=$1 AND node_key = ANY($2::text[]) AND completed_by=$3 LIMIT 1`, [t.case_id, node.separateFrom, p.userId])).rowCount! > 0 : false;
      checks.push({ check: 'separate_from_earlier_stage', ok: !prior, detail: prior ? 'you worked an earlier stage of this case' : undefined });
    }
    checks.push({ check: 'task_is_yours_or_unassigned', ok: !t.assignee_id || t.assignee_id === p.userId, detail: t.assignee_id && t.assignee_id !== p.userId ? 'assigned to someone else' : undefined });
    const bad = checks.find((c) => !c.ok);
    return { allowed: !bad, reason: bad ? (bad.detail === 'out_of_scope' || bad.detail === 'no_permission' || bad.detail === 'tenant_mismatch' ? 'not_found' : bad.detail === 'above_authority_limit' ? 'above_authority_limit' : bad.check) : 'ok', checks };
  }

  private async deny(p: Principal, t: TaskRow, e: Eligibility): Promise<never> {
    await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'access.denied', objectType: 'case_task', objectId: t.id, detail: { reason: e.reason, checks: e.checks.filter((c) => !c.ok).map((c) => c.check) } });
    if (e.reason === 'not_found') throw new NotFoundException();
    throw new ForbiddenException(e.reason);
  }

  async authorityPreview(p: Principal, taskId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const t = await this.loadTask(tx, taskId);
      const ctx = (await this.cases.contextOf(tx, t.case_id))!;
      const e = await this.eligibility(tx, p, t, await this.defOf(tx, p.institutionId, ctx.workflowVersionId!));
      if (e.reason === 'not_found') throw new NotFoundException();
      return { taskId, ...e };
    });
  }

  // ---------- staff queue (QUE-01, QUE-02) ----------
  async listTasks(p: Principal, f: { queue?: string; mine?: boolean; unassigned?: boolean; status?: string } = {}) {
    // Query-level scope: each required permission is matched with the branches the officer holds it in (ADR-011).
    const perms = ['case.review', 'case.clear', 'case.approve'] as const;
    const scope = perms.map((perm) => [perm, scopedBranchIds(p, perm)] as const).filter(([, b]) => b.length);
    if (!scope.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) => {
      const params: unknown[] = []; const ors: string[] = [];
      for (const [perm, branches] of scope) { params.push(perm, branches); ors.push(`(t.requires_permission=$${params.length - 1} AND c.branch_id = ANY($${params.length}::uuid[]))`); }
      params.push(f.status ?? 'open'); const st = params.length;
      params.push(f.queue ?? null); const qu = params.length;
      const me = f.mine ? params.push(p.userId) : 0;   // a parameter that the SQL does not mention is an error in Postgres
      const rows = (await tx.query(
        `SELECT t.id, t.case_id, t.node_key, t.queue, t.requires_permission, t.status, t.assignee_id, t.due_at, t.paused_at, t.escalated_at, t.created_at, t.tracking_code, t.service_key,
                (t.responded_at IS NOT NULL) customer_responded
           FROM case_task t
          WHERE (${ors.join(' OR ').replace(/c\.branch_id/g, 't.branch_id')}) AND t.status = $${st} AND ($${qu}::text IS NULL OR t.queue = $${qu})
            ${f.mine ? `AND t.assignee_id = $${me}` : ''} ${f.unassigned ? 'AND t.assignee_id IS NULL' : ''}
          ORDER BY (t.due_at IS NULL), t.due_at LIMIT 200`, params)).rows;
      const now = new Date();
      return rows.map((r) => ({
        taskId: r.id, caseId: r.case_id, trackingCode: r.tracking_code, serviceKey: r.service_key, node: r.node_key, queue: r.queue, requires: r.requires_permission, status: r.status,
        assigneeId: r.assignee_id, mine: r.assignee_id === p.userId, dueAt: r.due_at, escalated: !!r.escalated_at, customerResponded: r.customer_responded,
        priority: priorityOf({ dueAt: r.due_at, paused: !!r.paused_at, customerResponded: r.customer_responded, now }),
      }));
    });
  }

  // ---------- claim, assign, release (QUE-02, APR-04) ----------
  async claim(p: Principal, taskId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const t = await this.loadTask(tx, taskId, true);
      const ctx = (await this.cases.contextOf(tx, t.case_id))!;
      const e = await this.eligibility(tx, p, t, await this.defOf(tx, p.institutionId, ctx.workflowVersionId!));
      if (!e.checks[0]!.ok) return this.deny(p, t, e);                                // claiming needs the permission in the case's branch; decision-time checks apply when deciding
      if (t.status !== 'open') throw new ConflictException('task_not_open');
      if (t.assignee_id && t.assignee_id !== p.userId) throw new ConflictException('assigned_to_someone_else');
      if (t.assignee_id !== p.userId) {
        await tx.query('UPDATE case_task SET assignee_id=$2 WHERE id=$1', [taskId, p.userId]);
        await this.tat.record(tx, p.institutionId, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: 'task_started', stageKey: t.node_key, actorId: p.userId, waitParty: 'bank', phase: 'active' });
        await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'task.claimed', objectType: 'case_task', objectId: taskId });
      }
      return { taskId, assigneeId: p.userId };
    });
  }

  /** Team leads assign work to someone who is themselves eligible for it (QUE-02). Delegations count while live and not after (APR-04). */
  async assign(p: Principal, taskId: string, userId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const t = await this.loadTask(tx, taskId, true);
      const ctx = (await this.cases.contextOf(tx, t.case_id))!;
      const d = decide(p, 'case.assign', { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined });
      if (!d.allow) { await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'access.denied', objectType: 'case_task', objectId: taskId, detail: { reason: d.reason, permission: 'case.assign' } }); throw new NotFoundException(); }
      if (t.status !== 'open') throw new ConflictException('task_not_open');
      const target = await this.auth.principalOf(tx, p.institutionId, String(userId));
      const ok = target && decide(target, t.requires_permission as 'case.review', { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined }).allow;
      if (!ok) throw new BadRequestException('assignee_not_eligible');
      await tx.query('UPDATE case_task SET assignee_id=$2 WHERE id=$1', [taskId, userId]);
      await this.tat.record(tx, p.institutionId, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: t.assignee_id ? 'task_reassigned' : 'task_assigned', stageKey: t.node_key, actorId: p.userId, waitParty: 'bank', phase: 'queue' });
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: t.assignee_id ? 'task.reassigned' : 'task.assigned', objectType: 'case_task', objectId: taskId, detail: { to: userId, from: t.assignee_id } });
      return { taskId, assigneeId: userId };
    });
  }

  async release(p: Principal, taskId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const t = await this.loadTask(tx, taskId, true);
      if (t.assignee_id !== p.userId) throw new ForbiddenException('not_your_task');
      await tx.query('UPDATE case_task SET assignee_id=NULL WHERE id=$1', [taskId]);
      await this.tat.record(tx, p.institutionId, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: 'task_released', stageKey: t.node_key, actorId: p.userId, waitParty: 'bank', phase: 'queue' });
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'task.released', objectType: 'case_task', objectId: taskId });
      return { taskId, assigneeId: null };
    });
  }

  // ---------- completing a task: the only way work moves ----------
  async complete(p: Principal, taskId: string, body: CompleteBody, idempotencyKey: string | undefined) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new BadRequestException('Idempotency-Key header required');
    const outcome = String(body.outcome ?? '') as Outcome;
    return this.db.withTenant(p.institutionId, async (tx) => (await this.idem.run(tx, p.institutionId, 'task.complete', `${taskId}:${idempotencyKey}`, { body }, async () => {
      const t = await this.loadTask(tx, taskId, true);
      const ctx = (await this.cases.contextOf(tx, t.case_id))!;
      const def = await this.defOf(tx, p.institutionId, ctx.workflowVersionId!);
      const node = def.nodes[t.node_key] as TaskNode | ApprovalNode;
      const e = await this.eligibility(tx, p, t, def);
      // Recorded and rejected before any state is touched. The denial itself is audited outside this transaction.
      if (!e.checks[0]!.ok) throw new DeniedSignal(p, t, e);                          // not yours at all: nothing is revealed, not even the task's state
      if (t.status !== 'open') throw new ConflictException('task_not_open');       // a racing second completion gets a plain conflict
      if (!e.allowed) throw new DeniedSignal(p, t, e);
      if (ctx.state !== 'in_review' && ctx.state !== 'returned_to_customer') throw new ConflictException('case_not_in_review');
      const allowed: Outcome[] = node.type === 'approval' ? ['approve', 'decline', 'return', 'escalate'] : ['complete', 'return', 'escalate'];
      if (!allowed.includes(outcome)) throw new BadRequestException(`outcome must be one of ${allowed.join(', ')}`);
      if (outcome === 'return' && !node.canReturn) throw new BadRequestException('this stage cannot return the case to the customer');
      if (outcome === 'escalate' && !node.escalation) throw new BadRequestException('this stage has no escalation path');
      if ((outcome === 'approve' || outcome === 'decline' || outcome === 'escalate') && !body.rationale?.trim()) throw new BadRequestException('a rationale is required');   // APR-09, APR-07

      const actor = { id: p.userId, type: p.actorType };
      const record = async (decision: 'approve' | 'decline' | 'return' | 'escalate') => {
        if (node.type !== 'approval') return;
        await tx.query(`INSERT INTO approval (institution_id, case_id, task_id, decision, rationale, decided_by, authority, workflow_version_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.institutionId, t.case_id, t.id, decision, (body.rationale ?? body.customerText ?? decision).toString(), p.userId, JSON.stringify({ checks: e.checks, role: p.actorType, at: new Date().toISOString() }), ctx.workflowVersionId]);
      };
      const finishTask = async (status: 'done', out: string) => {
        await tx.query(`UPDATE case_task SET status=$2, outcome=$3, completed_by=$4, completed_at=now(), assignee_id=coalesce(assignee_id,$4) WHERE id=$1`, [t.id, status, out, p.userId]);
        await this.tat.record(tx, p.institutionId, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: 'stage_exited', stageKey: t.node_key, actorId: p.userId, waitParty: 'bank', phase: 'queue' });
        await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'task.completed', objectType: 'case_task', objectId: t.id, reason: body.rationale ?? undefined, detail: { node: t.node_key, outcome: out, recommendation: body.recommendation ?? null } });
      };
      const code = async () => t.tracking_code;

      if (outcome === 'return') {
        const r = await this.cases.requestInformation(tx, p.institutionId, actor, t.case_id, { reasonCode: body.reasonCode, customerText: body.customerText, items: body.items, dueAt: body.dueAt }, { alreadyReturned: ctx.state === 'returned_to_customer' });
        await tx.query(`UPDATE case_task SET status='waiting_customer', paused_at=now(), assignee_id=coalesce(assignee_id,$2) WHERE id=$1`, [t.id, p.userId]);
        await this.tat.record(tx, p.institutionId, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: 'info_requested', stageKey: t.node_key, actorId: p.userId, waitParty: 'customer', phase: 'customer_wait', pauseReason: 'waiting_for_customer' });
        await record('return');
        if (ctx.state !== 'returned_to_customer') await this.notes.notify(tx, p.institutionId, { profileId: ctx.profileId, caseId: t.case_id, template: 'more_info_needed', code: await code() });
        return { taskId: t.id, outcome, requestId: r.requestId, caseState: 'returned_to_customer' };
      }
      if (outcome === 'escalate') {
        await this.escalateTask(tx, p.institutionId, t, node, actor, body.rationale);
        await record('escalate');
        return { taskId: t.id, outcome, caseState: ctx.state };
      }
      if (node.type === 'approval') {                                                  // approve or decline: a recorded human decision
        await finishTask('done', outcome);
        await record(outcome as 'approve' | 'decline');
        await this.enter(tx, ctx, t.instance_id, def, outcome === 'approve' ? node.outcomes.approve : node.outcomes.decline);
        const st = (await this.cases.contextOf(tx, t.case_id))!.state;
        return { taskId: t.id, outcome, caseState: st };
      }
      await finishTask('done', 'complete');
      if (t.fork_key) {
        const open = (await tx.query(`SELECT count(*)::int n FROM case_task WHERE instance_id=$1 AND fork_key=$2 AND status IN ('open','waiting_customer')`, [t.instance_id, t.fork_key])).rows[0].n as number;
        if (open === 0) await this.enter(tx, ctx, t.instance_id, def, (def.nodes[t.fork_key] as ParallelNode).join);   // join: every branch is done (WFL-01)
      } else {
        const next = (node as TaskNode).outcomes?.complete;
        if (next) await this.enter(tx, ctx, t.instance_id, def, next);
      }
      return { taskId: t.id, outcome, caseState: (await this.cases.contextOf(tx, t.case_id))!.state };
    })).result).catch(async (err) => {
      if (err instanceof DeniedSignal) return this.deny(err.p, err.t, err.e);     // the transaction has rolled back; the denial is audited on its own
      throw err;
    });
  }

  // ---------- escalation (APR-05, WFL-08) ----------
  private async escalateTask(tx: Tx, inst: string, t: TaskRow, node: TaskNode | ApprovalNode, actor: { id: string; type: string }, why?: string) {
    const esc = node.escalation!;
    await tx.query(`UPDATE case_task SET requires_permission=$2, queue=$3, assignee_id=NULL, escalated_at=now(), escalated_to=$2 WHERE id=$1`, [t.id, esc.permission, esc.queue ?? 'escalated']);
    await this.tat.record(tx, inst, { caseId: t.case_id, branchId: t.branch_id, serviceKey: t.service_key, eventType: 'task_escalated', stageKey: t.node_key, actorId: actor.id === SYSTEM.id ? null : actor.id, waitParty: 'bank', phase: 'queue' });
    await this.audit.record(tx, { institutionId: inst, actorId: actor.id === SYSTEM.id ? undefined : actor.id, actorType: actor.type, action: 'task.escalated', objectType: 'case_task', objectId: t.id, reason: why, detail: { to: esc.permission, queue: esc.queue ?? 'escalated' } });
  }

  /** Called by the integration identity that runs the scheduler. Moves each overdue, unpaused, not-yet-escalated task once. */
  async runDueEscalations(institutionId: string): Promise<{ escalated: number }> {
    return this.db.withTenant(institutionId, async (tx) => {
      const due = (await tx.query(`SELECT * FROM case_task WHERE status='open' AND paused_at IS NULL AND escalated_at IS NULL AND due_at < now() FOR UPDATE SKIP LOCKED`)).rows as TaskRow[];
      let n = 0;
      for (const t of due) {
        const ctx = await this.cases.contextOf(tx, t.case_id);
        if (!ctx?.workflowVersionId || (ctx.state !== 'in_review' && ctx.state !== 'returned_to_customer')) continue;
        const node = (await this.defOf(tx, institutionId, ctx.workflowVersionId)).nodes[t.node_key] as TaskNode | ApprovalNode;
        if (!node.escalation) continue;
        await this.escalateTask(tx, institutionId, t, node, SYSTEM, 'overdue');
        n++;
      }
      return { escalated: n };
    });
  }

  // ---------- dashboard: events from the TAT module plus SLA figures from tasks ----------
  async dashboard(p: Principal, serviceKey?: string) {
    const base = await this.tat.summary(p, { serviceKey });
    const branches = scopedBranchIds(p, 'tat.read');
    if (!branches.length) return { ...base, sla: {}, openTasks: { total: 0, overdue: 0 } };
    return this.db.withTenant(p.institutionId, async (tx) => {
      const sla = (await tx.query(
        `SELECT node_key, count(*)::int done, count(*) FILTER (WHERE completed_at <= due_at)::int on_time FROM case_task
          WHERE status='done' AND branch_id = ANY($1::uuid[]) AND ($2::text IS NULL OR service_key=$2) GROUP BY node_key`, [branches, serviceKey ?? null])).rows;
      const open = (await tx.query(
        `SELECT count(*)::int total, count(*) FILTER (WHERE due_at < now() AND paused_at IS NULL)::int overdue FROM case_task
          WHERE status IN ('open','waiting_customer') AND branch_id = ANY($1::uuid[]) AND ($2::text IS NULL OR service_key=$2)`, [branches, serviceKey ?? null])).rows[0];
      return { ...base, sla: Object.fromEntries(sla.map((r) => [r.node_key, { finished: r.done, onTime: r.on_time, rate: r.done ? r.on_time / r.done : null }])), openTasks: { total: open.total, overdue: open.overdue } };
    });
  }

  // ---------- the staff workspace ----------
  async workspace(p: Principal, caseId: string) {
    const base = await this.cases.staffGet(p, caseId);                      // scope check and access audit happen here
    return this.db.withTenant(p.institutionId, async (tx) => {
      const tasks = (await tx.query(`SELECT * FROM case_task WHERE case_id=$1 ORDER BY created_at, id`, [caseId])).rows as TaskRow[];
      const ctx = (await this.cases.contextOf(tx, caseId))!;
      const def = ctx.workflowVersionId ? await this.defOf(tx, p.institutionId, ctx.workflowVersionId) : null;
      const approvals = (await tx.query('SELECT decision, rationale, decided_by, authority, decided_at FROM approval WHERE case_id=$1 ORDER BY seq', [caseId])).rows;
      const open = [];
      for (const t of tasks) {
        const elig = def && (t.status === 'open') ? await this.eligibility(tx, p, t, def) : null;
        open.push({ taskId: t.id, node: t.node_key, title: def && 'title' in def.nodes[t.node_key]! ? (def.nodes[t.node_key] as TaskNode).title : null, status: t.status, queue: t.queue, requires: t.requires_permission, assigneeId: t.assignee_id, dueAt: t.due_at,
          outcomes: def ? (def.nodes[t.node_key]!.type === 'approval' ? ['approve', 'decline'] : ['complete']).concat((def.nodes[t.node_key] as TaskNode).canReturn ? ['return'] : [], (def.nodes[t.node_key] as TaskNode).escalation ? ['escalate'] : []) : [],
          eligibility: elig && elig.reason !== 'not_found' ? elig : null });
      }
      const timing = await this.tat.forCase(tx, caseId);
      return { ...base, workflow: def ? { versionId: ctx.workflowVersionId } : null, tasks: open, decisions: approvals, tat: timing, caseState: ctx.state };
    });
  }
}

class DeniedSignal extends Error { constructor(readonly p: Principal, readonly t: TaskRow, readonly e: Eligibility) { super('denied'); } }
