// Workflow definition (docs/08 §3, ADR-027). Pure data; the engine and the publish checks both read it.
export type Loc = { en: string; ne: string };
export const TASK_PERMISSIONS = ['case.review', 'case.clear', 'case.approve'] as const;
export type TaskPermission = (typeof TASK_PERMISSIONS)[number];
export type CustomerStage = 'received' | 'under_review';

export interface Sla { targetHours: number; calendar: 'always' }
export interface Escalation { permission: TaskPermission; queue?: string }
interface Common { title: Loc; customerStatus: CustomerStage }
export interface TaskNode extends Common {
  type: 'task'; permission: TaskPermission; queue: string; sla: Sla; escalation?: Escalation; canReturn?: boolean;
  /** Marks a mandatory clearance (WFL-02): no path may reach an approval without passing it. */
  clearance?: string;
  outcomes?: { complete?: string };           // omitted for fork branches: the fork's join decides what happens next
}
export interface ParallelNode extends Common { type: 'parallel'; branches: string[]; join: string }
export interface ApprovalNode extends Common {
  type: 'approval'; permission: 'case.approve'; queue: string; sla: Sla; escalation?: Escalation; canReturn?: boolean;
  /** Form field holding the amount the approver's authority limit is checked against. */
  amountField?: string;
  /** The request has no monetary value (e.g. a certificate). Authority limits are then not applicable and the amount is treated as 0. Exclusive with amountField; reviewed by a checker like any config (APR-03). */
  nonMonetary?: true;
  /**
   * Joint approval (APR-03, docs/08): above each threshold this many different approvers must approve before the case moves on. Each of them must individually pass the
   * authority checks for the amount. One decline by an authorised approver ends it at once. Thresholds are decimal text. Needs amountField.
   */
  jointApproval?: Array<{ aboveAmount: string; approvals: number }>;
  /** Nodes whose completers may not also decide (maker-checker, APR-02). */
  separateFrom?: string[];
  outcomes: { approve: string; decline: string };
}
export interface EndNode { type: 'end'; outcome: 'approved' | 'declined'; customerMessage: Loc }
export type Node = TaskNode | ParallelNode | ApprovalNode | EndNode;
export interface WorkflowDef { start: string; nodes: Record<string, Node> }
