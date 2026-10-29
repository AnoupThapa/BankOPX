import { ConfigValidator } from '../configuration';

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const str = (v: unknown, max = 200) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const loc = (v: unknown) => !!v && typeof v === 'object' && str((v as { en?: unknown }).en) && str((v as { ne?: unknown }).ne);
const FORBIDDEN = /issue[_-]?instrument|auto[_-]?(accept|issue|waive)|waive/i;

export interface TradeDoc { key: string; label: { en: string; ne: string }; required: boolean; originalRequired: boolean; inPersonReason?: { en: string; ne: string } }
export interface TradeKeyDate { kind: string; label: { en: string; ne: string }; alertDaysBefore: number }
export interface TradeChecklist { name: string; owner: string; productClass: string; documents: TradeDoc[]; keyDates: TradeKeyDate[] }

/**
 * Publication checks for a trade document checklist (CFG-03, TRD-01, TRD-02, CRD-08). Whether an original is needed is the bank's decision per document; the platform never
 * assumes a scan replaces one, and nothing here can waive a document or issue an instrument.
 */
export const tradeValidator: ConfigValidator = (kind, c) => {
  if (kind !== 'trade_checklist') return { ok: true, errors: [] };
  const e: string[] = [];
  const scan = (o: unknown, path: string) => {
    if (Array.isArray(o)) o.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (FORBIDDEN.test(k)) e.push(`TRD-01: '${path}${k}' would waive a document or issue an instrument; people do that in the authorised trade system`); scan(v, `${path}${k}.`); }
  };
  scan(c, '');
  if (!str(c.name) || !str(c.owner)) e.push('CRD-08: name and owner are required');
  if (typeof c.productClass !== 'string' || !KEY.test(c.productClass)) e.push('CRD-07: productClass must be one product class key');
  const docs = c.documents as Array<Record<string, unknown>> | undefined; const seen = new Set<string>();
  if (!Array.isArray(docs) || !docs.length) e.push('TRD-02: at least one document is required');
  else for (const [i, d] of docs.entries()) {
    if (typeof d.key !== 'string' || !KEY.test(d.key) || seen.has(d.key)) e.push(`TRD-02: document ${i} needs a unique key`); else seen.add(d.key);
    if (!loc(d.label)) e.push(`TRD-02: document ${i} needs English and Nepali text`);
    if (typeof d.required !== 'boolean') e.push(`TRD-02: document ${i} must say whether it is required`);
    if (typeof d.originalRequired !== 'boolean') e.push(`TRD-01: document ${i} must say whether an original is required; a scan is never assumed to replace one`);
    if (d.originalRequired === true && !loc(d.inPersonReason)) e.push(`TRD-01: document ${i} needs an in-person reason (English and Nepali) when an original is required`);
  }
  const ds = c.keyDates as Array<Record<string, unknown>> | undefined; const dk = new Set<string>();
  if (!Array.isArray(ds)) e.push('TRD-02: keyDates must be a list (it may be empty)');
  else for (const [i, d] of ds.entries()) {
    if (typeof d.kind !== 'string' || !KEY.test(d.kind) || dk.has(d.kind)) e.push(`TRD-02: key date ${i} needs a unique kind`); else dk.add(d.kind);
    if (!loc(d.label)) e.push(`TRD-02: key date ${i} needs English and Nepali text`);
    if (!Number.isInteger(d.alertDaysBefore) || (d.alertDaysBefore as number) < 0 || (d.alertDaysBefore as number) > 365) e.push(`TRD-02: key date ${i} alertDaysBefore must be a whole number 0 to 365`);
  }
  return { ok: e.length === 0, errors: e };
};

export type DocState = 'awaited' | 'under_review' | 'discrepancy' | 'accepted';
export type OriginalState = 'not_required' | 'awaited' | 'received_unverified' | 'sighted';
export interface DocEvent { docKey: string; type: string; actorId: string; at: string; note?: string | null }

/** Pure derivation of a document's state from its event history, so the same history always shows the same state. */
export function deriveDoc(def: TradeDoc, events: DocEvent[]): { copy: DocState; original: OriginalState; complete: boolean; lastCopyActor: string | null; originalReceivedBy: string | null } {
  let copy: DocState = 'awaited'; let lastCopyActor: string | null = null; let original: OriginalState = def.originalRequired ? 'awaited' : 'not_required'; let receivedBy: string | null = null;
  for (const ev of events.filter((x) => x.docKey === def.key)) {
    if (ev.type === 'copy_received' || ev.type === 'correction_received') { copy = 'under_review'; lastCopyActor = ev.actorId; }
    else if (ev.type === 'discrepancy_raised') copy = 'discrepancy';
    else if (ev.type === 'accepted') copy = 'accepted';
    else if (def.originalRequired && ev.type === 'original_received') { original = 'received_unverified'; receivedBy = ev.actorId; }
    else if (def.originalRequired && ev.type === 'original_sighted') original = 'sighted';
  }
  return { copy, original, complete: copy === 'accepted' && (original === 'not_required' || original === 'sighted'), lastCopyActor, originalReceivedBy: receivedBy };
}
