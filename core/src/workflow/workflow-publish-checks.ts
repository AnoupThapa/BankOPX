import { ConfigValidator } from '../configuration';
import { ApprovalNode, Node, ParallelNode, TASK_PERMISSIONS, TaskNode, WorkflowDef } from './workflow-schema';

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const loc = (v: unknown): boolean => !!v && typeof v === 'object' && ['en', 'ne'].every((l) => typeof (v as Record<string, unknown>)[l] === 'string' && ((v as Record<string, string>)[l] ?? '').trim() !== '');

/** Outgoing edges used for reachability: where work can go next. A fork leads to its join; its branches are entered together. */
export function successors(n: Node): string[] {
  if (n.type === 'task') return n.outcomes?.complete ? [n.outcomes.complete] : [];
  if (n.type === 'parallel') return [n.join];
  if (n.type === 'approval') return [n.outcomes.approve, n.outcomes.decline];
  return [];
}

/**
 * Regression pack for kind 'workflow' (CFG-03, WFL-02, CFG-07). Blocks: dead ends, unreachable nodes, cycles, approval with no authority binding,
 * a path to approval that skips a mandatory clearance, tasks without a customer-status mapping or SLA, ends without bank-approved customer wording.
 */
export const workflowValidator: ConfigValidator = (kind, c) => {
  if (kind !== 'workflow') return { ok: true, errors: [] };
  const e: string[] = [];
  const def = c as unknown as WorkflowDef;
  const nodes = def.nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes) || Object.keys(nodes).length === 0) return { ok: false, errors: ['WFL-01: a workflow needs nodes'] };
  if (Object.keys(nodes).length > 60) e.push('WFL-01: at most 60 nodes');
  if (typeof def.start !== 'string' || !nodes[def.start]) e.push('WFL-01: start must name an existing node');
  const has = (k: unknown): k is string => typeof k === 'string' && !!nodes[k];

  for (const [key, n] of Object.entries(nodes) as Array<[string, Node]>) {
    if (!KEY.test(key)) e.push(`WFL-01: node key '${key}' must be lower-case letters, digits and underscores`);
    if (!n || typeof n !== 'object') { e.push(`WFL-01: '${key}' is not a node`); continue; }
    if (n.type === 'task' || n.type === 'approval') {
      const t = n as TaskNode | ApprovalNode;
      if (!loc(t.title)) e.push(`SVC-07: '${key}' needs a title in English and Nepali`);
      if (!['received', 'under_review'].includes(t.customerStatus)) e.push(`STS-01: '${key}' needs a customer-status mapping from the controlled dictionary`);
      if (!TASK_PERMISSIONS.includes(t.permission)) e.push(`SEC-12: '${key}' needs a permission (${TASK_PERMISSIONS.join(', ')})`);
      if (typeof t.queue !== 'string' || !KEY.test(t.queue)) e.push(`QUE-01: '${key}' needs a queue`);
      if (!t.sla || !Number.isInteger(t.sla.targetHours) || t.sla.targetHours < 1 || t.sla.targetHours > 720 || t.sla.calendar !== 'always') e.push(`TAT-04: '${key}' needs an SLA target of 1 to 720 hours with calendar 'always' (business calendars are not available yet)`);
      // A task escalates to people holding a different permission; an approval escalates within the approver pool (higher limits), so it may keep its permission.
      if (t.escalation && (!TASK_PERMISSIONS.includes(t.escalation.permission) || (n.type === 'task' && t.escalation.permission === t.permission))) e.push(`APR-05: '${key}' escalation must name a valid permission, different from the task's own`);
      if (t.escalation?.queue !== undefined && !KEY.test(t.escalation.queue)) e.push(`APR-05: '${key}' escalation queue is invalid`);
    }
    if (n.type === 'task') {
      if (n.clearance !== undefined && (typeof n.clearance !== 'string' || !KEY.test(n.clearance))) e.push(`WFL-02: '${key}' clearance name is invalid`);
      if (n.outcomes?.complete !== undefined && !has(n.outcomes.complete)) e.push(`WFL-08: '${key}' completes to a node that does not exist`);
    } else if (n.type === 'parallel') {
      const p = n as ParallelNode;
      if (!Array.isArray(p.branches) || p.branches.length < 2 || new Set(p.branches).size !== p.branches.length) e.push(`WFL-01: fork '${key}' needs two or more distinct branches`);
      else for (const b of p.branches) {
        if (!has(b) || nodes[b]!.type !== 'task') e.push(`WFL-01: branch '${b}' of '${key}' must be a task node`);
        else if ((nodes[b] as TaskNode).outcomes?.complete) e.push(`WFL-01: branch '${b}' must not define its own next step; the join of '${key}' does`);
      }
      if (!has(p.join) || (p.branches ?? []).includes(p.join)) e.push(`WFL-01: fork '${key}' needs a join node that is not one of its branches`);
      if (!loc(p.title) && p.title !== undefined) e.push(`SVC-07: '${key}' title needs English and Nepali`);
    } else if (n.type === 'approval') {
      const a = n as ApprovalNode;
      if (a.permission !== 'case.approve') e.push(`APR-03: approval '${key}' must be bound to the case.approve authority`);
      if (!has(a.outcomes?.approve) || (nodes[a.outcomes.approve]!.type !== 'end') || (nodes[a.outcomes.approve] as { outcome?: string }).outcome !== 'approved') e.push(`WFL-08: approval '${key}' must lead to an end node with outcome 'approved'`);
      if (!has(a.outcomes?.decline) || (nodes[a.outcomes.decline]!.type !== 'end') || (nodes[a.outcomes.decline] as { outcome?: string }).outcome !== 'declined') e.push(`WFL-08: approval '${key}' must lead to an end node with outcome 'declined'`);
      if (a.amountField !== undefined && !/^[a-z][a-z0-9_]{0,40}$/.test(a.amountField)) e.push(`APR-03: '${key}' amountField is invalid`);
      if (a.nonMonetary !== undefined && (a.nonMonetary !== true || a.amountField !== undefined)) e.push(`APR-03: '${key}' is either non-monetary or has an amountField, not both`);
      for (const s of a.separateFrom ?? []) if (!has(s) || nodes[s]!.type !== 'task') e.push(`APR-02: '${key}' separateFrom '${s}' must be a task node`);
    } else if (n.type === 'end') {
      if (!['approved', 'declined'].includes(n.outcome)) e.push(`WFL-08: end '${key}' needs an outcome`);
      if (!loc(n.customerMessage)) e.push(`DEC-04: end '${key}' needs bank-approved customer wording in English and Nepali`);
    } else e.push(`WFL-01: '${key}' has unknown type`);
  }
  if (e.length) return { ok: false, errors: e };                         // structural problems first; graph analysis below assumes a sound structure

  // Reachability from start, including fork branches.
  const reach = new Set<string>();
  const visit = (k: string, banned?: string) => {
    if (reach.has(k) || k === banned) return;
    reach.add(k);
    const n = nodes[k]!;
    if (n.type === 'parallel') {
      for (const b of n.branches) visit(b, banned);
      if (banned && n.branches.includes(banned)) return;      // a join waits for every branch: removing one branch closes the way through
    }
    for (const s of successors(n)) visit(s, banned);
  };
  visit(def.start);
  for (const k of Object.keys(nodes)) if (!reach.has(k)) e.push(`WFL-01: '${k}' is unreachable`);

  // Dead ends: every non-end node must be able to reach an end. Branch tasks lead to their fork's join.
  const forkOf = new Map<string, string>();
  for (const [k, n] of Object.entries(nodes)) if (n.type === 'parallel') for (const b of n.branches) forkOf.set(b, k);
  const canEnd = (k: string, seen = new Set<string>()): boolean => {
    if (seen.has(k)) return false; seen.add(k);
    const n = nodes[k]!;
    if (n.type === 'end') return true;
    const next = forkOf.has(k) ? [(nodes[forkOf.get(k)!] as ParallelNode).join] : successors(n);
    return next.some((s) => canEnd(s, new Set(seen)));
  };
  for (const k of Object.keys(nodes)) if (reach.has(k) && !canEnd(k)) e.push(`WFL-08: '${k}' is a dead end: no path from it reaches an end`);

  // Cycles (the only loop is return-to-customer, which is not an edge).
  const state = new Map<string, 1 | 2>();
  const cyc = (k: string): boolean => {
    if (state.get(k) === 2) return false; if (state.get(k) === 1) return true;
    state.set(k, 1);
    const n = nodes[k]!;
    const next = [...successors(n), ...(n.type === 'parallel' ? n.branches : [])];
    const hit = next.some(cyc); state.set(k, 2); return hit;
  };
  if (cyc(def.start)) e.push('WFL-08: the workflow contains a cycle; the only permitted loop is return to the customer');

  // Mandatory clearances (WFL-02): with a clearance node removed, no approval may still be reachable.
  const clearances = Object.entries(nodes).filter(([, n]) => n.type === 'task' && (n as TaskNode).clearance) as Array<[string, TaskNode]>;
  const approvals = Object.entries(nodes).filter(([, n]) => n.type === 'approval').map(([k]) => k);
  if (!approvals.length) e.push('APR-03: a workflow needs an approval node');
  for (const [ck, cn] of clearances) {
    reach.clear(); visit(def.start, ck);
    for (const a of approvals) if (reach.has(a)) e.push(`WFL-02: approval '${a}' can be reached without the mandatory clearance '${cn.clearance}' (node '${ck}')`);
  }
  // An approval must not be a fork branch or be reachable only as a branch.
  for (const a of approvals) if (forkOf.has(a)) e.push(`WFL-02: approval '${a}' cannot be a fork branch`);
  return { ok: e.length === 0, errors: e };
};
