import { add, cmp, formatDec, parseDec } from '../platform';
import type { InputValue } from './calc';

// Inputs that belong to parties (income of each co-applicant, obligations of each guarantor ...) are combined into the single figure a measure uses.
// The combination rule is configuration (CRD-02): which party roles count and whether to add, take the highest or take the lowest. Nothing is assumed (CRD-04).
export const AGGREGATES = ['sum', 'max', 'min'] as const;
export type Aggregate = (typeof AGGREGATES)[number];
export interface PartyInputDef { partyRoles: string[]; aggregate: Aggregate }
export interface PartyRef { id: string; role: string }
export interface PartyValue { value: string; asOf: string; conflict: boolean }

/**
 * Combine the per-party values. If a party in a counted role has no value the result is missing (not "zero for that party"); if any of them is contested the
 * result is contested. The date of the combined figure is the oldest contributing date, so staleness can only be understated by a human, never by the engine.
 */
export function aggregateParties(def: PartyInputDef, parties: PartyRef[], values: ReadonlyMap<string, PartyValue>): (InputValue & { contributors: string[] }) | { missing: true; lacking: string[] } {
  const counted = parties.filter((p) => def.partyRoles.includes(p.role));
  if (!counted.length) return { missing: true, lacking: [] };
  const lacking = counted.filter((p) => !values.has(p.id)).map((p) => p.id);
  if (lacking.length) return { missing: true, lacking };
  const vs = counted.map((p) => values.get(p.id)!);
  if (vs.some((v) => v.conflict)) return { value: vs[0]!.value, asOf: vs.map((v) => v.asOf).sort()[0], conflict: true, contributors: counted.map((p) => p.id) };
  const nums = vs.map((v) => parseDec(v.value));
  const total = def.aggregate === 'sum' ? nums.reduce(add, 0n) : def.aggregate === 'max' ? nums.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)) : nums.reduce((a, b) => (cmp(a, b) <= 0 ? a : b));
  return { value: formatDec(total, 8).replace(/\.?0+$/, '') || '0', asOf: vs.map((v) => v.asOf).sort()[0], conflict: false, contributors: counted.map((p) => p.id) };
}
