import type { Locale, Messages } from '@bbjp/ui';

// Staff interface strings. English only for now: the staff-facing language set is a bank decision (A-013). `ne` is intentionally empty so it falls back to English.
const en: Messages = {
  'app.title': 'Bank administration', 'nav.designer': 'Form designer', 'nav.review': 'Review queue', 'nav.defs': 'Credit definitions', 'nav.signout': 'Sign out',
  'login.title': 'Staff sign-in', 'login.institution': 'Institution', 'login.username': 'Username', 'login.password': 'Password', 'login.code': 'Authenticator code', 'login.submit': 'Sign in', 'login.failed': 'Sign-in failed. Check your details and try again.',
  'designer.title': 'Form designer', 'designer.key': 'Form key', 'designer.keyhint': 'Lower-case letters, digits, hyphen. Services refer to this key.', 'designer.fields': 'Fields', 'designer.add': 'Add field', 'designer.type': 'Field type',
  'designer.remove': 'Remove', 'designer.up': 'Move up', 'designer.down': 'Move down', 'designer.fieldkey': 'Field key', 'designer.labelen': 'Label (English)', 'designer.labelne': 'Label (Nepali)', 'designer.required': 'Required',
  'designer.privacy': 'Privacy classification', 'designer.options': 'Options, one per line: value | English | Nepali', 'designer.docKey': 'Document key', 'designer.accept': 'Accepted formats', 'designer.maxBytes': 'Maximum size (bytes)',
  'designer.minLength': 'Minimum length', 'designer.maxLength': 'Maximum length', 'designer.min': 'Minimum value', 'designer.max': 'Maximum value', 'designer.showWhen': 'Show only when', 'designer.always': 'Always shown', 'designer.equals': 'equals',
  'designer.preview': 'Preview', 'designer.phone': 'Phone', 'designer.desktop': 'Desktop', 'designer.validate': 'Check for publish blockers', 'designer.valid': 'No blockers. This form can be submitted for review.', 'designer.blockers': 'Publish blockers',
  'designer.reason': 'Reason for this change', 'designer.save': 'Save and submit for review', 'designer.saved': 'Submitted for review. A different person must approve it before it goes live.', 'designer.json': 'Advanced: edit as JSON (groups and calculated fields)',
  'designer.jsonerr': 'This is not valid JSON.', 'designer.groupnote': 'Groups and calculated fields are edited in the advanced JSON box.',
  'nav.workflow': 'Workflow designer', 'wf.title': 'Workflow designer', 'wf.key': 'Workflow key', 'wf.keyhint': 'Services refer to this key.', 'wf.json': 'Workflow definition (JSON)', 'wf.template': 'Start from the reference workflow',
  'wf.outline': 'Paths', 'wf.outline.empty': 'Nothing to show yet.', 'wf.jsonerr': 'This is not valid JSON.',
  'review.title': 'Waiting for review', 'review.empty': 'Nothing is waiting for review.', 'review.changes': 'Changes against the live version', 'review.new': 'New (no live version yet)', 'review.same': 'No difference from the live version.', 'review.blockers': 'Publish blockers', 'review.approve': 'Approve and publish',
  'review.reject': 'Send back', 'review.reason': 'Reason', 'review.done': 'Done.', 'review.own': 'You made this change, so someone else must approve it.', 'review.version': 'version', 'review.by': 'Reason given by the maker',
  'defs.title': 'Credit definitions', 'defs.help': 'Draft proposal types, checklists, calculation sets and scorecards. They can be published only after the credit policy owner approves them, and a calculation set must carry worked examples that the platform reproduces exactly. Nothing is pre-filled: every value must come from the bank.',
  'defs.kind': 'Kind', 'defs.kind.proposal_type': 'Proposal type', 'defs.kind.checklist': 'Checklist', 'defs.kind.calculation_set': 'Calculation set', 'defs.kind.scorecard': 'Scorecard',
  'defs.key': 'Key', 'defs.keyhint': 'Lower case letters, numbers, dashes. A new version of an existing key replaces it once approved.', 'defs.content': 'Definition (JSON)', 'defs.reason': 'Reason for this version', 'defs.check': 'Check against the publication rules', 'defs.send': 'Save and send for review',
  'defs.badjson': 'This is not valid JSON, or it is not an object.', 'defs.passes': 'Passes the publication rules. It still needs approval before use.', 'defs.sent': 'Saved and sent to the review queue',
  'common.loading': 'Loading…', 'common.error': 'Something went wrong. Please try again.',
};
export const EXTRA: Record<Locale, Messages> = { en, ne: {} };
