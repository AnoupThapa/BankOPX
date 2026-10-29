// Browser end-to-end for Phase 7a (SYNTHETIC demo definitions): a margin loan whose approval is blocked until the collateral valuation meets the approved coverage, a margin call and a pledge confirmation recorded from the bank system; a trade request whose approval is blocked until required documents and originals are complete (a second person accepts and sights); key-date alerts and the overview.
// Needs: dev API (DEV_SECRETS_FILE set), customer portal :5173, staff portal :5175. Run on a fresh dev database.
import { readFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { authenticator } = createRequire(new URL('../../../core/package.json', import.meta.url))('otplib');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:5173';
const STAFF = process.env.STAFF_URL ?? 'http://127.0.0.1:5175';
const API = process.env.API_URL ?? 'http://127.0.0.1:3100';
const LOG = process.env.DEV_LOG ?? '/tmp/dev-server.log';
const SECRETS = JSON.parse(readFileSync(process.env.DEV_SECRETS_FILE ?? '/tmp/bbjp-dev-secrets.json', 'utf8'));
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-7/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpCount = (d) => readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]') && l.split(' ')[1] === d).length;
async function otpFor(d, seen) { for (let i = 0; i < 60; i++) { const h = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]') && l.split(' ')[1] === d); if (h.length > seen) return h.at(-1).split(' ')[2]; await sleep(100); } throw new Error('no OTP'); }
async function axe(page, label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  check(`axe ${label}: no WCAG 2.1 A/AA violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(','));
}
const noOverflow = async (page, label) => check(`${label}: no horizontal scrolling`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

let lastPage; const pageErrors = [];
process.on('uncaughtException', async (e) => { console.log('FAILED:', e.message.split('\n').slice(0, 3).join(' | ')); console.log('page errors:', pageErrors.slice(0, 2)); try { console.log('--- page text ---\n' + (await lastPage.locator('body').innerText()).slice(0, 1500)); } catch { /* gone */ } process.exit(1); });

// ---- staff API helper for the steps that are not the point of this walkthrough ----
async function staffApi(user) {
  const jar = {};
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': jar.csrf ?? '', cookie: jar.cookie ?? '', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0];
    const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : undefined };
  };
  const l = await call('POST', '/auth/login', { institution: SECRETS.institution, username: user, password: SECRETS.password }); jar.csrf = l.body.csrfToken;
  await call('POST', '/auth/mfa/verify', { code: authenticator.generate(SECRETS.totp[user]) });
  return call;
}
async function staffLogin(page, user) {
  await page.goto(STAFF);
  await page.getByLabel('Username').fill(user); await page.getByLabel('Password').fill(SECRETS.password);
  await page.getByLabel('Authenticator code').fill(authenticator.generate(SECRETS.totp[user]));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Work queue' }).waitFor();
}



const browser = await chromium.launch();
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)]);
const localStamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

async function customerApplies(destination, service, amount) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); lastPage = page; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(CUSTOMER);
  let seen = otpCount(destination);
  await page.getByLabel(/mobile number/i).fill(destination); await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(destination, seen)); await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('heading', { name: /privacy choices/i }).waitFor(); await page.getByRole('checkbox').first().check(); await page.getByRole('button', { name: /save my choices/i }).click();
  await page.getByRole('heading', { name: /your profile/i }).waitFor();
  await page.getByRole('button', { name: /link my existing bank relationship/i }).click();
  seen = otpCount(destination); await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(destination, seen)); await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel(/account number/i).fill(`55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`); await page.getByLabel(/date of birth/i).fill('1990-01-01');
  await page.getByRole('button', { name: /^link$/i }).click(); await page.getByText(/your bank relationship is linked/i).waitFor();
  await page.getByRole('button', { name: /^services$/i }).click(); await page.getByRole('button', { name: service }).click();
  await page.getByRole('button', { name: /start application/i }).click();
  await page.getByLabel(/amount requested/i).fill(String(amount));
  await page.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg(5) });
  await page.getByText(/uploaded and checked/i).waitFor(); await page.waitForTimeout(1500); await page.getByText(/saved automatically/i).waitFor();
  await page.getByRole('button', { name: /check and submit/i }).click();
  await page.getByRole('heading', { name: /your application was received/i }).waitFor();
  return { page, code: (await page.getByTestId('tracking-code').innerText()).trim() };
}
const login = async (user) => { const c = await browser.newContext({ viewport: { width: 1280, height: 1100 } }); const pg = await c.newPage(); lastPage = pg; pg.on('pageerror', (e) => pageErrors.push(e.message)); await staffLogin(pg, user); return pg; };
const completeStage = async (pg) => { await pg.getByRole('radio', { name: 'Complete this stage' }).check(); await pg.getByRole('button', { name: 'Record', exact: true }).click(); await pg.getByText('Recorded.').waitFor(); };

// ===================== securities-backed lending =====================
const m = await customerApplies(`96${String(Date.now()).slice(-7)}5`.slice(0, 10), /margin loan \(demo\)/i, 250000);
check('customer: margin loan application submitted', /^BB-/.test(m.code), m.code);
const col = await login('colA');
await col.getByRole('button', { name: `Claim ${m.code}` }).click(); await col.getByRole('button', { name: `Open case ${m.code}` }).click();
await col.getByRole('heading', { name: 'Collateral (securities)' }).waitFor();
await col.getByRole('button', { name: 'Open collateral file' }).click();
await col.getByRole('heading', { name: 'Valuation' }).waitFor();
check('the panel says pledges are made only in the authorised bank system, and offers no pledge, sell or liquidate control', (await col.getByText(/created and released only in the authorised bank system/).first().isVisible()) && (await col.getByRole('button', { name: /^(pledge|release|sell|liquidate|trade)/i }).count()) === 0);
await col.getByLabel('Security', { exact: true }).first().selectOption('BBB');
await col.getByLabel('Quantity', { exact: true }).fill('10000'); await col.getByRole('button', { name: 'Record a holding', exact: true }).click();
await col.getByText(/BBB.*10000/).first().waitFor();
await col.getByLabel('Price', { exact: true }).fill('100'); await col.getByLabel('Price time').fill(localStamp(new Date(Date.now() - 60_000)));
await col.getByRole('button', { name: 'Record a price', exact: true }).click(); await col.getByText('Saved.').waitFor();
await col.getByRole('button', { name: 'Run valuation', exact: true }).click();
await col.getByText('Initial coverage not met').first().waitFor();
check('valuation shows initial coverage not met (300000 against 250000), with source, time and each step of the arithmetic', (await col.getByText('1.2000').first().isVisible()) && (await col.getByRole('row', { name: /BBB/ }).getByText('demo_feed').isVisible()));
await axe(col, 'collateral panel'); await noOverflow(col, 'collateral panel'); await col.screenshot({ path: `${OUT}collateral-1-valuation.png`, fullPage: true });
await completeStage(col);

const ap = await login('approverBig');
await ap.getByRole('button', { name: `Open case ${m.code}` }).click();
await ap.getByText('The collateral valuation is current and meets the approved coverage').waitFor();
check('the approver sees that the collateral check is not met and cannot record a decision', (await ap.getByText(/Initial coverage is not met/).first().isVisible()) && (await ap.getByRole('button', { name: 'Record', exact: true }).isDisabled()));
await ap.screenshot({ path: `${OUT}collateral-2-blocked.png`, fullPage: true });

await col.getByLabel('Security', { exact: true }).first().selectOption('BBB');
await col.getByLabel('Quantity', { exact: true }).fill('20000'); await col.getByRole('button', { name: 'Record a holding', exact: true }).click();
await col.getByText(/BBB.*20000/).first().waitFor();
await col.getByRole('button', { name: 'Run valuation', exact: true }).click();
await col.getByText('Meets the approved coverage').first().waitFor();
check('with more security the valuation meets the approved coverage', true);
await ap.getByRole('button', { name: 'Back to queue' }).click(); await ap.getByRole('button', { name: `Open case ${m.code}` }).click();
await ap.getByRole('radio', { name: 'Approve' }).check(); await ap.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: collateral in order');
await ap.getByRole('button', { name: 'Record', exact: true }).click(); await ap.getByText('Recorded.').waitFor();
check('the approver can now record the decision', true);

// after approval: a price fall, a margin call, a pledge confirmation recorded from the bank system
await col.getByLabel('Price', { exact: true }).fill('40'); await col.getByLabel('Price time').fill(localStamp(new Date(Date.now() - 30_000)));
await col.getByRole('button', { name: 'Record a price', exact: true }).click(); await col.getByText('Saved.').waitFor();
await col.getByRole('button', { name: 'Run valuation', exact: true }).click();
await col.getByText('Margin call required').first().waitFor();
check('a price fall produces "margin call required" with the shortfall to the maintenance level', await col.getByText('Shortfall to the maintenance level').isVisible());
await col.getByLabel('How and to whom the notice was given').fill('Notice given by the relationship manager'); await col.getByRole('button', { name: 'Record the margin call notice' }).click();
await col.getByText(/Open: .*deadline/).waitFor();
check('the margin call notice is tracked with a deadline from the approved policy', true);
const ops = await staffApi('ops'); const caseId = (await (await staffApi('colA'))('GET', '/staff/cases')).body.find((c) => c.trackingCode === m.code)?.caseId;
const pl = await ops('POST', `/staff/cases/${caseId}/collateral/pledges`, { symbol: 'BBB', event: 'confirmed', externalRef: 'CUSTODY-9001', note: 'Seen in the custody system' });
check('operations records the bank system\'s pledge confirmation with its reference', pl.status === 201);
await col.getByRole('button', { name: 'Back to queue' }).click(); await col.getByRole('button', { name: 'Cases' }).click(); await col.getByRole('button', { name: `Open case ${m.code}` }).click();
await col.getByText(/Pledge confirmed by the bank system \(CUSTODY-9001\)/).waitFor();
check('the holding shows the pledge as confirmed by the bank system, with its reference', true);
await col.screenshot({ path: `${OUT}collateral-3-margin-call.png`, fullPage: true });

// ===================== trade request =====================
const tr = await customerApplies(`96${String(Date.now()).slice(-7)}6`.slice(0, 10), /trade request \(demo\)/i, 2000000);
check('customer: trade request submitted', /^BB-/.test(tr.code), tr.code);
const to = await login('tradeOff');
await to.getByRole('button', { name: `Claim ${tr.code}` }).click(); await to.getByRole('button', { name: `Open case ${tr.code}` }).click();
await to.getByRole('heading', { name: 'Trade documents' }).waitFor();
await to.getByRole('button', { name: 'Open trade file' }).click(); await to.getByRole('region', { name: 'Original documents needed in person' }).waitFor();
check('the panel lists the original that must be seen in person, with the reason', await to.getByText(/The bank must see the original document/).first().isVisible());
await to.getByRole('button', { name: 'Record copy received Commercial invoice' }).click(); await to.getByText('Under review').first().waitFor();
await to.getByRole('button', { name: 'Record copy received Transport document' }).click(); await to.getByText('Under review').nth(1).waitFor();
check('the officer who received the copies has no accept control', (await to.getByRole('button', { name: /^Accept (Commercial|Transport)/ }).count()) === 0);
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
await to.getByLabel('Which date').selectOption({ label: 'Expiry' }); await to.getByLabel('Date', { exact: true }).fill(day(2)); await to.getByRole('button', { name: 'Set key date', exact: true }).click();
await to.getByText(/Expiry: .*\(2 days\)/).waitFor();
await to.getByRole('button', { name: 'Record original received Transport document' }).click(); await to.getByText('Received, not yet sighted by a second person').waitFor();
await axe(to, 'trade panel, officer'); await noOverflow(to, 'trade panel, officer');
await completeStage(to);
const run = await (await staffApi('sched'))('POST', '/ops/trade/run');
check('the key date inside its alert window is flagged once by the dispatcher', run.status === 200 && run.body.flagged >= 1, JSON.stringify(run.body));

const ap2 = await login('approverBig2');
await ap2.getByRole('button', { name: `Open case ${tr.code}` }).click();
await ap2.getByText('All required trade documents are complete').waitFor();
check('the approver sees the trade documents are incomplete and cannot record a decision', (await ap2.getByText(/documents_incomplete|Not ready/).first().isVisible().catch(() => false)) || (await ap2.getByRole('button', { name: 'Record', exact: true }).isDisabled()));
check('the decision is disabled while documents are incomplete', await ap2.getByRole('button', { name: 'Record', exact: true }).isDisabled());

const rev = await login('tradeRev');
await rev.getByRole('button', { name: 'Cases' }).click(); await rev.getByLabel('Find by tracking code').fill(tr.code); await rev.getByRole('button', { name: `Open case ${tr.code}` }).click();
await rev.getByRole('heading', { name: 'Trade documents' }).waitFor();
check('the reviewer has no receive controls', (await rev.getByRole('button', { name: /Record copy received|Record original received/ }).count()) === 0);
await rev.getByLabel('Discrepancy note (Commercial invoice)').fill('Amount differs from the application');
await rev.getByRole('button', { name: 'Raise discrepancy Commercial invoice' }).click(); await rev.getByText('Discrepancy raised').first().waitFor();
check('the reviewer raises a discrepancy with a note', true);
await to.getByRole('button', { name: 'Back to queue' }).click().catch(() => undefined);
await to.getByRole('button', { name: 'Cases' }).click(); await to.getByRole('button', { name: `Open case ${tr.code}` }).click();
await to.getByRole('button', { name: 'Record correction received Commercial invoice' }).click(); await to.getByText('Under review').first().waitFor();
check('the officer records the correction, which sends it back to review', true);
await rev.getByRole('button', { name: 'Back to queue' }).click(); await rev.getByRole('button', { name: 'Cases' }).click(); await rev.getByRole('button', { name: `Open case ${tr.code}` }).click();
await rev.getByRole('button', { name: 'Accept Commercial invoice' }).click(); await rev.getByText('Accepted').first().waitFor();
await rev.getByRole('button', { name: 'Accept Transport document' }).click(); await rev.getByText('Accepted').nth(1).waitFor();
check('after acceptance of the transport copy the document is still not complete: the original has not been sighted', (await rev.getByRole('row', { name: /Transport document/ }).getByText('Complete', { exact: true }).count()) === 0);
await rev.getByRole('button', { name: 'Record original sighted Transport document' }).click(); await rev.getByText('Sighted', { exact: true }).waitFor();
await rev.getByText('All required documents are complete').waitFor();
check('a second person sights the original and the checklist becomes ready', true);
await axe(rev, 'trade panel, reviewer'); await rev.screenshot({ path: `${OUT}trade-1-documents.png`, fullPage: true });

await ap2.getByRole('button', { name: 'Back to queue' }).click(); await ap2.getByRole('button', { name: `Open case ${tr.code}` }).click();
await ap2.getByRole('radio', { name: 'Approve' }).check(); await ap2.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: documents complete');
await ap2.getByRole('button', { name: 'Record', exact: true }).click(); await ap2.getByText('Recorded.').waitFor();
check('with the documents complete the approver records the decision', true);

// overview
const ov = await login('tradeRev');
await ov.getByRole('button', { name: 'Collateral and trade' }).click(); await ov.getByRole('heading', { name: 'Collateral and trade overview' }).waitFor();
check('the overview shows counts and the trade alert, without names', (await ov.getByText(/expiry/i).first().isVisible()) && !/Bina|Chandra/.test(await ov.locator('main').innerText()));
await axe(ov, 'overview'); await ov.screenshot({ path: `${OUT}overview-1.png`, fullPage: true });

// the customers see none of it
lastPage = m.page; await m.page.reload(); await m.page.getByRole('button', { name: /^my applications$/i }).click(); await m.page.getByRole('button', { name: new RegExp(`open ${m.code}`, 'i') }).click();
await m.page.getByRole('heading', { name: 'Decision' }).waitFor();
const leaks = (await m.page.locator('body').innerText()) + (await (async () => { await tr.page.reload(); await tr.page.getByRole('button', { name: /^my applications$/i }).click(); await tr.page.getByRole('button', { name: new RegExp(`open ${tr.code}`, 'i') }).click(); await tr.page.getByRole('heading', { name: 'Decision' }).waitFor(); return tr.page.locator('body').innerText(); })());
const leak = leaks.match(/CUSTODY|margin call|shortfall|haircut|BBB|coverage|discrepancy|transport|invoice|INTERNAL-RATIONALE|colA|tradeOff/i);
check('customers see only the decision wording: no collateral, margin, document or staff details', !leak, leak ? `matched: ${leak[0]}` : '');
check('no unexpected page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
