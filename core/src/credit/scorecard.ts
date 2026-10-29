import { add, cmp, div, formatDec, isDecimalText, mul, parseDec } from './decimal';
import type { CalcResult } from './calc';

// Scorecards are configuration approved by the credit policy owner (CRD-05, CRD-08). The engine only applies the approved definition. It never invents a value
// (CRD-04), never decides (CRD-01) and its output is labelled as system-generated (CRD-06, CRD-10).
export const SCORE_ENGINE_VERSION = 'score-1';
export const SCORE_LABELS = ['informational', 'rating_support', 'adopted'] as const;
export const REVIEW_ACTIONS = ['standard_review', 'enhanced_review', 'senior_review'] as const;
export type MissingRule = 'refer' | 'exclude' | 'zero';

export interface Factor {
  key: string; group: string; label: { en: string; ne: string };
  source: { measure: string } | { input: string };
  weight: string;
  /** Points for the highest `atLeast` not above the value; `below` applies when the value is under every band. */
  bands: Array<{ atLeast: string; points: string }>; below: string;
  missing: MissingRule;
}
export interface Scorecard {
  name: string; owner: string; effectiveDate: string; label: (typeof SCORE_LABELS)[number]; productClass: string;
  factors: Factor[];
  reviewBands: Array<{ atLeast: string; label: { en: string; ne: string }; reviewAction: (typeof REVIEW_ACTIONS)[number] }>;
  belowBands: { label: { en: string; ne: string }; reviewAction: (typeof REVIEW_ACTIONS)[number] };
  override: { reasonRequired: true; higherApprovalRequired: boolean };
}

export interface FactorOutcome { key: string; group: string; label: { en: string; ne: string }; weight: string; value: string | null; points: string | null; state: 'used' | 'missing_excluded' | 'missing_zero' | 'missing_referred'; reason?: string }
export interface ScoreResult {
  engineVersion: string; status: 'scored' | 'manual_review'; score: string | null;
  scorecard: { name: string; label: string; productClass: string; effectiveDate: string };
  factors: FactorOutcome[]; missing: string[];
  reviewAction: { label: { en: string; ne: string }; reviewAction: string } | null;
  displayLabel: string;
}

export function score(card: Scorecard, calc: CalcResult, inputs: Record<string, string | undefined>): ScoreResult {
  const outcomes: FactorOutcome[] = []; let weighted = 0n; let totalW = 0n; let refer = false;
  for (const f of card.factors) {
    let value: string | null = null; let why: string | undefined;
    if ('measure' in f.source) {
      const m = calc.measures.find((x) => x.key === (f.source as { measure: string }).measure);
      if (m?.status === 'ok') value = m.value; else why = m ? m.status : 'missing';
    } else { const v = inputs[f.source.input]; if (v !== undefined && isDecimalText(v)) value = v; else why = 'missing'; }
    const base = { key: f.key, group: f.group, label: f.label, weight: f.weight };
    if (value === null) {
      if (f.missing === 'refer') { refer = true; outcomes.push({ ...base, value: null, points: null, state: 'missing_referred', reason: why }); }
      else if (f.missing === 'zero') { outcomes.push({ ...base, value: null, points: '0.0000', state: 'missing_zero', reason: why }); weighted = add(weighted, 0n); totalW = add(totalW, parseDec(f.weight)); }
      else outcomes.push({ ...base, value: null, points: null, state: 'missing_excluded', reason: why });
      continue;
    }
    const v = parseDec(value); let pts = parseDec(f.below);
    for (const b of [...f.bands].sort((a, c) => cmp(parseDec(a.atLeast), parseDec(c.atLeast)))) if (cmp(v, parseDec(b.atLeast)) >= 0) pts = parseDec(b.points);
    weighted = add(weighted, mul(parseDec(f.weight), pts)); totalW = add(totalW, parseDec(f.weight));
    outcomes.push({ ...base, value, points: formatDec(pts), state: 'used' });
  }
  const meta = { name: card.name, label: card.label, productClass: card.productClass, effectiveDate: card.effectiveDate };
  const missing = outcomes.filter((o) => o.state !== 'used').map((o) => o.key);
  const displayLabel = `System-generated; ${card.label.replace('_', ' ')}. Not a decision.`;
  const q = totalW === 0n ? null : div(weighted, totalW);
  if (refer || q === null) return { engineVersion: SCORE_ENGINE_VERSION, status: 'manual_review', score: null, scorecard: meta, factors: outcomes, missing, reviewAction: null, displayLabel };
  let band: { label: { en: string; ne: string }; reviewAction: string } = card.belowBands;
  for (const b of [...card.reviewBands].sort((a, c) => cmp(parseDec(a.atLeast), parseDec(c.atLeast)))) if (cmp(q, parseDec(b.atLeast)) >= 0) band = { label: b.label, reviewAction: b.reviewAction };
  return { engineVersion: SCORE_ENGINE_VERSION, status: 'scored', score: formatDec(q), scorecard: meta, factors: outcomes, missing, reviewAction: band, displayLabel };
}
