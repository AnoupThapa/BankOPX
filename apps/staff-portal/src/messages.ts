import type { Locale, Messages } from '@bbjp/ui';

// Staff interface strings. English only for now (A-013); `ne` falls back to English.
const en: Messages = {
  'app.title': 'Bank operations', 'nav.queue': 'My work', 'nav.tat': 'Turnaround', 'nav.signout': 'Sign out',
  'login.title': 'Staff sign-in', 'login.institution': 'Institution', 'login.username': 'Username', 'login.password': 'Password', 'login.code': 'Authenticator code', 'login.submit': 'Sign in', 'login.failed': 'Sign-in failed. Check your details and try again.',
  'queue.title': 'Work queue', 'queue.filter.queue': 'Queue', 'queue.all': 'All queues', 'queue.filter.status': 'Show', 'queue.open': 'Ready to work', 'queue.waiting': 'Waiting for the customer',
  'queue.mine': 'Only mine', 'queue.unassigned': 'Only unassigned', 'queue.empty': 'No tasks match.', 'queue.col.case': 'Case', 'queue.col.stage': 'Stage', 'queue.col.priority': 'Priority', 'queue.col.owner': 'Owner', 'queue.col.due': 'Due',
  'queue.col.action': 'Action', 'queue.you': 'You', 'queue.nobody': 'Unassigned', 'queue.someone': 'Assigned', 'queue.claim': 'Claim', 'queue.open_case': 'Open case', 'queue.responded': 'Customer responded', 'queue.escalated': 'Escalated',
  'ws.back': 'Back to queue', 'ws.state': 'Case state', 'ws.tasks': 'Tasks', 'ws.data': 'Application', 'ws.changed': 'Changed since the previous version', 'ws.documents': 'Documents', 'ws.timeline': 'History', 'ws.timing': 'Timing',
  'ws.bank': 'Bank time', 'ws.customer_wait': 'Waiting for the customer', 'ws.elapsed': 'Elapsed', 'ws.version': 'Version', 'ws.notes': 'Internal notes', 'ws.addnote': 'Add internal note', 'ws.savenote': 'Save note',
  'ws.requests': 'Requests to the customer', 'ws.decisions': 'Decisions recorded',
  'doc.open': 'Open file', 'doc.scan': 'Scan', 'doc.accept': 'Accept', 'doc.reject': 'Reject', 'doc.reasonlabel': 'Reason code', 'doc.messagelabel': 'Message to the customer', 'doc.review': 'Review', 'doc.nofile': 'Nothing uploaded',
  'panel.title': 'Decision panel', 'panel.checks': 'Authority checks', 'panel.ok': 'Passed', 'panel.fail': 'Not met', 'panel.none': 'This task is not yours to work.', 'panel.claim': 'Take this task',
  'panel.outcome': 'What do you want to do?', 'panel.rationale': 'Rationale (recorded with your decision)', 'panel.recommendation': 'Your recommendation', 'panel.support': 'Support', 'panel.notsupport': 'Do not support',
  'panel.reason': 'Reason', 'panel.customertext': 'Message to the customer (they will read this)', 'panel.items': 'What should the customer fix?', 'panel.additem': 'Add item', 'panel.itemtext': 'Instruction for this item',
  'panel.itemtarget': 'Field or document', 'panel.question': 'A question', 'panel.submit': 'Record', 'panel.done': 'Recorded.', 'panel.confirm_decision': 'Your decision is final and the case will be closed.',
  'outcome.complete': 'Complete this stage', 'outcome.return': 'Send back to the customer', 'outcome.approve': 'Approve', 'outcome.decline': 'Decline', 'outcome.escalate': 'Escalate',
  'check.permission_and_scope': 'You hold the permission for this case and branch', 'check.applicant_is_not_decider': 'You are not the applicant', 'check.amount_known': 'The amount is known',
  'check.separate_from_earlier_stage': 'You did not work an earlier stage of this case', 'check.task_is_yours_or_unassigned': 'The task is yours or unassigned',
  'detail.above_authority_limit': 'Above your authority limit', 'detail.assigned to someone else': 'Assigned to someone else', 'detail.you worked an earlier stage of this case': 'You worked an earlier stage of this case',
  'tat.title': 'Turnaround time', 'tat.cases': 'Cases in view', 'tat.closed': 'Closed', 'tat.metric': 'Measure', 'tat.median': 'Median', 'tat.p90': '90th percentile', 'tat.p95': '95th percentile', 'tat.count': 'Cases',
  'tat.bank': 'Bank time', 'tat.customerwait': 'Customer wait', 'tat.elapsed': 'Elapsed', 'tat.stage': 'By stage', 'tat.sla': 'SLA compliance', 'tat.open': 'Open tasks', 'tat.overdue': 'Overdue', 'tat.asof': 'As of',
  'tat.source': 'Source', 'tat.definitions': 'Definitions', 'tat.nodata': 'No data in your scope yet.',
  'common.loading': 'Loading…', 'common.error': 'Something went wrong. Please try again.',
};
export const EXTRA: Record<Locale, Messages> = { en, ne: {} };
