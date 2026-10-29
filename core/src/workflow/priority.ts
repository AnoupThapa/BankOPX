// Priority with its reason, not colour alone (WFL-09, QUE-01). Pure so it can be tested with fixed times.
export interface PriorityInput { dueAt: Date | null; paused: boolean; customerResponded: boolean; now: Date }
export interface Priority { level: 'high' | 'normal'; reason: string; sla: 'ok' | 'due_soon' | 'overdue' | 'paused' }

const hours = (ms: number) => Math.max(1, Math.round(ms / 3_600_000));

export function priorityOf(i: PriorityInput): Priority {
  if (i.paused) return { level: 'normal', reason: 'Waiting for the customer; the SLA clock is paused', sla: 'paused' };
  if (i.dueAt) {
    const left = i.dueAt.getTime() - i.now.getTime();
    if (left < 0) return { level: 'high', reason: `Overdue by ${hours(-left)} h`, sla: 'overdue' };
    if (left <= 4 * 3_600_000) return { level: 'high', reason: `Due in ${hours(left)} h`, sla: 'due_soon' };
  }
  if (i.customerResponded) return { level: 'normal', reason: 'The customer has responded', sla: 'ok' };
  return { level: 'normal', reason: 'Standard queue order', sla: 'ok' };
}
