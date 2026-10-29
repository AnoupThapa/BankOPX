import type { Locale, Messages } from '@bbjp/ui';

// Staff interface strings. English only for now: the staff-facing language set is a bank decision (A-013). `ne` is intentionally empty so it falls back to English.
const en: Messages = {
  'app.title': 'Bank administration', 'nav.designer': 'Form designer', 'nav.review': 'Review queue', 'nav.signout': 'Sign out',
  'login.title': 'Staff sign-in', 'login.institution': 'Institution', 'login.username': 'Username', 'login.password': 'Password', 'login.code': 'Authenticator code', 'login.submit': 'Sign in', 'login.failed': 'Sign-in failed. Check your details and try again.',
  'designer.title': 'Form designer', 'designer.key': 'Form key', 'designer.keyhint': 'Lower-case letters, digits, hyphen. Services refer to this key.', 'designer.fields': 'Fields', 'designer.add': 'Add field', 'designer.type': 'Field type',
  'designer.remove': 'Remove', 'designer.up': 'Move up', 'designer.down': 'Move down', 'designer.fieldkey': 'Field key', 'designer.labelen': 'Label (English)', 'designer.labelne': 'Label (Nepali)', 'designer.required': 'Required',
  'designer.privacy': 'Privacy classification', 'designer.options': 'Options, one per line: value | English | Nepali', 'designer.docKey': 'Document key', 'designer.accept': 'Accepted formats', 'designer.maxBytes': 'Maximum size (bytes)',
  'designer.minLength': 'Minimum length', 'designer.maxLength': 'Maximum length', 'designer.min': 'Minimum value', 'designer.max': 'Maximum value', 'designer.showWhen': 'Show only when', 'designer.always': 'Always shown', 'designer.equals': 'equals',
  'designer.preview': 'Preview', 'designer.phone': 'Phone', 'designer.desktop': 'Desktop', 'designer.validate': 'Check for publish blockers', 'designer.valid': 'No blockers. This form can be submitted for review.', 'designer.blockers': 'Publish blockers',
  'designer.reason': 'Reason for this change', 'designer.save': 'Save and submit for review', 'designer.saved': 'Submitted for review. A different person must approve it before it goes live.', 'designer.json': 'Advanced: edit as JSON (groups and calculated fields)',
  'designer.jsonerr': 'This is not valid JSON.', 'designer.groupnote': 'Groups and calculated fields are edited in the advanced JSON box.',
  'review.title': 'Waiting for review', 'review.empty': 'Nothing is waiting for review.', 'review.changes': 'Changes against the live version', 'review.new': 'New (no live version yet)', 'review.same': 'No difference from the live version.', 'review.blockers': 'Publish blockers', 'review.approve': 'Approve and publish',
  'review.reject': 'Send back', 'review.reason': 'Reason', 'review.done': 'Done.', 'review.own': 'You made this change, so someone else must approve it.', 'review.version': 'version', 'review.by': 'Reason given by the maker',
  'common.loading': 'Loading…', 'common.error': 'Something went wrong. Please try again.',
};
export const EXTRA: Record<Locale, Messages> = { en, ne: {} };
