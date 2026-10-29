import { priorityOf } from './priority';

const now = new Date('2030-01-01T12:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('priority always carries a reason (WFL-09, QUE-01)', () => {
  it('overdue and due-soon work is high, with the hours in words', () => {
    expect(priorityOf({ dueAt: at(-3), paused: false, customerResponded: false, now })).toEqual({ level: 'high', reason: 'Overdue by 3 h', sla: 'overdue' });
    expect(priorityOf({ dueAt: at(2), paused: false, customerResponded: false, now })).toEqual({ level: 'high', reason: 'Due in 2 h', sla: 'due_soon' });
  });
  it('a paused clock is never overdue, whatever the due time', () => {
    expect(priorityOf({ dueAt: at(-50), paused: true, customerResponded: false, now })).toMatchObject({ level: 'normal', sla: 'paused' });
  });
  it('a customer reply is explained, and the default has a reason too', () => {
    expect(priorityOf({ dueAt: at(20), paused: false, customerResponded: true, now }).reason).toBe('The customer has responded');
    expect(priorityOf({ dueAt: at(20), paused: false, customerResponded: false, now }).reason).toBe('Standard queue order');
    expect(priorityOf({ dueAt: null, paused: false, customerResponded: false, now }).reason).not.toBe('');
  });
});
