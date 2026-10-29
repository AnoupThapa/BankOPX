// Rule-to-test traceability gate (docs/14 §4). Fails when a rule declared in scope for the current phase has no test citing it.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const rules = new Set([...readFileSync(join(root, 'docs/03-business-rules.md'), 'utf8').matchAll(/^\|\s*([A-Z]{2,4}-\d{2})\s*\|/gm)].map((m) => m[1]));
const walk = (d) => readdirSync(d).flatMap((f) => {
  if (f === 'node_modules' || f === 'dist') return [];
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.spec\.tsx?$/.test(f) ? [p] : [];
});
const cited = new Map();
for (const f of ['core', 'packages', 'apps'].flatMap((d) => walk(join(root, d)))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\b([A-Z]{2,4}-\d{2})\b/g)) {
    if (rules.has(m[1])) cited.set(m[1], [...new Set([...(cited.get(m[1]) ?? []), f.replace(root, '')])]);
  }
}
const phase = process.argv[2] ?? 'phase1';
const required = JSON.parse(readFileSync(join(root, 'scripts/phase-gates.json'), 'utf8'))[phase] ?? [];
const unknown = required.filter((r) => !rules.has(r));
const missing = required.filter((r) => !cited.has(r));
process.stdout.write(`rules in catalogue: ${rules.size}; cited by tests: ${cited.size}; required for ${phase}: ${required.length}\n`);
for (const r of required) process.stdout.write(`  ${cited.has(r) ? 'OK     ' : 'MISSING'} ${r}  ${(cited.get(r) ?? []).join(', ')}\n`);
if (unknown.length) { process.stderr.write(`unknown rule ids in phase-gates.json: ${unknown.join(', ')}\n`); process.exit(2); }
if (missing.length) { process.stderr.write(`rules without tests: ${missing.join(', ')}\n`); process.exit(1); }
