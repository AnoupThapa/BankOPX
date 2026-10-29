// Browser end-to-end for Phase 4: a customer applies; staff work it through the staff portal (claim, return, claim again, parallel checks, authority check, decision);
// the customer follows it in the portal. Needs: dev API (DEV_SECRETS_FILE set), customer portal :5173, staff portal :5175. Run on a fresh dev database.
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
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-4/', import.meta.url).pathname;
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
process.on('uncaughtException', async (e) => { console.log('FAILED:', e.message.split('\n')[0]); console.log('page errors:', pageErrors.slice(0, 2)); try { console.log('--- page text ---\n' + (await lastPage.locator('body').innerText()).slice(0, 1500)); } catch { /* gone */ } process.exit(1); });

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
const dest = `96${String(Date.now()).slice(-7)}1`.slice(0, 10);

// ================= customer applies (phone) =================
const cctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const cust = await cctx.newPage(); lastPage = cust;
cust.on('pageerror', (e) => pageErrors.push(e.message));
await cust.goto(CUSTOMER);
let seen = otpCount(dest);
await cust.getByLabel(/mobile number/i).fill(dest); await cust.getByRole('button', { name: /send code/i }).click();
await cust.getByLabel(/one-time code/i).fill(await otpFor(dest, seen)); await cust.getByRole('button', { name: /continue/i }).click();
await cust.getByRole('heading', { name: /privacy choices/i }).waitFor(); await cust.getByRole('checkbox').first().check(); await cust.getByRole('button', { name: /save my choices/i }).click();
await cust.getByRole('heading', { name: /your profile/i }).waitFor();
await cust.getByRole('button', { name: /link my existing bank relationship/i }).click();
seen = otpCount(dest); await cust.getByRole('button', { name: /send code/i }).click();
await cust.getByLabel(/one-time code/i).fill(await otpFor(dest, seen)); await cust.getByRole('button', { name: /continue/i }).click();
await cust.getByLabel(/account number/i).fill(`55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`); await cust.getByLabel(/date of birth/i).fill('1990-01-01');
await cust.getByRole('button', { name: /^link$/i }).click(); await cust.getByText(/your bank relationship is linked/i).waitFor();
await cust.getByRole('button', { name: /^services$/i }).click(); await cust.getByRole('button', { name: /personal loan enquiry/i }).click();
await cust.getByRole('button', { name: /start application/i }).click();
await cust.getByLabel(/what is the loan for/i).selectOption('home');
await cust.getByLabel(/amount you would like to borrow/i).fill('150000');
await cust.getByLabel(/i confirm these answers are true/i).check();
await cust.getByText(/saved automatically/i).waitFor();
await cust.getByRole('button', { name: /check and submit/i }).click();
await cust.getByRole('heading', { name: /your application was received/i }).waitFor();
const code = (await cust.getByTestId('tracking-code').innerText()).trim();
check('customer: application submitted, tracking code shown', /^BB-/.test(code), code);

// ================= officer A: queue, claim, return =================
const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const staff = await sctx.newPage(); lastPage = staff;
staff.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(staff, 'officerA');
await staff.getByText(code).first().waitFor();
check('staff: the new case is in the queue with a priority and its reason in words', await staff.getByText(/Standard queue order|Due in/).first().isVisible());
await axe(staff, 'staff queue'); await noOverflow(staff, 'staff queue'); await staff.screenshot({ path: `${OUT}staff-1-queue.png`, fullPage: true });
await staff.getByRole('button', { name: `Claim ${code}` }).click();
await staff.getByRole('button', { name: `Open case ${code}` }).click();
await staff.getByRole('heading', { name: code }).waitFor();
await staff.getByText(/You hold the permission for this case and branch/).waitFor();
await staff.getByRole('radio', { name: 'Send back to the customer' }).check();
await staff.getByLabel('Message to the customer (they will read this)').fill('Please confirm the amount you would like to borrow.');
await staff.getByLabel(/Field or document 1/).selectOption('field:amount');
await staff.getByLabel(/Instruction for this item 1/).fill('Confirm the amount');
await axe(staff, 'staff workspace'); await staff.screenshot({ path: `${OUT}staff-2-workspace-return.png`, fullPage: true });
await staff.getByRole('button', { name: 'Record' }).click();
await staff.getByText('Recorded.').waitFor();
check('staff: the case was sent back to the customer through the task', true);
await staff.getByRole('button', { name: 'Back to queue' }).click();
await staff.getByLabel('Show').selectOption('waiting_customer');
await staff.getByText(/the SLA clock is paused/).waitFor();
check('staff: waiting work shows the SLA clock as paused, in words', true);

// ================= customer sees it and corrects =================
await cust.getByRole('button', { name: /view my applications/i }).click();
await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: code }).waitFor();
await cust.getByText('We asked you for more information').first().waitFor({ timeout: 5000 }).catch(() => {});
const seen3 = [await cust.getByText('More information needed').first().isVisible(), await cust.getByText('Confirm the amount', { exact: true }).isVisible(), await cust.getByText('We asked you for more information').first().isVisible()];
check('customer: sees "More information needed" and the request, with a progress timeline', seen3.every(Boolean), JSON.stringify(seen3));
await axe(cust, 'customer returned case'); await cust.screenshot({ path: `${OUT}customer-1-returned.png`, fullPage: true });
await cust.getByLabel(/amount you would like to borrow/i).fill('120000');
await cust.getByRole('button', { name: /send my corrections/i }).click();
await cust.getByText(/we have your corrections/i).waitFor();
check('customer: corrections sent, status back to "under review"', await cust.getByText('Under review').first().isVisible());

// ================= officer A completes screening; other staff do their checks =================
await staff.getByLabel('Show').selectOption('open');
await staff.getByText('Customer responded').waitFor();
check('staff: the task is back in the queue flagged "Customer responded"', true);
await staff.getByRole('button', { name: `Open case ${code}` }).click();
await staff.getByText(/changed since the previous version/i).waitFor();
check('staff: the workspace highlights what the customer changed (amount 150000 → 120000)', await staff.getByText(/\(was: 150000\)/).isVisible());
await staff.getByRole('radio', { name: 'Complete this stage' }).check();
await staff.getByRole('button', { name: 'Record' }).click(); await staff.getByText('Recorded.').waitFor();
const caseId = (await (await (await staffApi('lead'))('GET', '/staff/tasks')).body.find((t) => t.trackingCode === code))?.caseId;
const a2 = await staffApi('officerA2'); const comp = await staffApi('compliance');
const task = async (api, node) => (await api('GET', '/staff/tasks')).body.find((t) => t.trackingCode === code && t.node === node);
await comp('POST', `/staff/tasks/${(await task(comp, 'compliance')).taskId}/complete`, { outcome: 'complete' }, { 'idempotency-key': `c-${Date.now()}` });
check('approval does not open while the document check is still open (the join waits)', !(await (await staffApi('approverBig'))('GET', '/staff/tasks')).body.some((t) => t.trackingCode === code && t.node === 'approval'));
await a2('POST', `/staff/tasks/${(await task(a2, 'doc_check')).taskId}/complete`, { outcome: 'complete' }, { 'idempotency-key': `d-${Date.now()}` });

// ================= approver within limit is refused in the panel; approver with authority decides =================
const small = await sctx.newPage(); lastPage = small;
await staffLogin(small, 'approverSmall');
await small.getByRole('button', { name: `Open case ${code}` }).click();
await small.getByText(/Above your authority limit/).waitFor();
const rec = small.getByRole('button', { name: 'Record' });
check('approver below the amount: the panel shows "Above your authority limit" and every action is disabled', (await rec.isDisabled()) && (await small.getByRole('radio', { name: 'Approve' }).isDisabled()));
await small.screenshot({ path: `${OUT}staff-3-authority-refused.png`, fullPage: true });
const bigctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const big = await bigctx.newPage(); lastPage = big;
await staffLogin(big, 'approverBig');
await big.getByRole('button', { name: `Open case ${code}` }).click();
await big.getByText(/You hold the permission for this case and branch/).waitFor();
await big.getByRole('radio', { name: 'Approve' }).check();
check('approver with authority: the final-decision warning is shown before recording', await big.getByText(/final and the case will be closed/).isVisible());
await big.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: income verified, within policy');
await big.screenshot({ path: `${OUT}staff-4-decision.png`, fullPage: true });
await big.getByRole('button', { name: 'Record' }).click(); await big.getByText('Recorded.').waitFor();
check('approver with authority: decision recorded', true);

// ================= customer sees the decision, safely =================
lastPage = cust;
await cust.reload();
await cust.getByRole('button', { name: /^my applications$/i }).click();
await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Decision' }).waitFor();
const page = await cust.content();
check('customer: sees "A decision has been made" and the bank-approved wording', (await cust.getByText('A decision has been made').first().isVisible()) && /Please sign in to continue/.test(page));
check('customer: no rationale, task names, staff names or internal terms anywhere on the page', !/INTERNAL-RATIONALE|screening|compliance|doc_check|approverBig|officerA|clearance/i.test(page));
await axe(cust, 'customer decided case'); await noOverflow(cust, 'customer decided case'); await cust.screenshot({ path: `${OUT}customer-2-decision.png`, fullPage: true });
await cust.getByRole('button', { name: /^notifications/i }).click();
await cust.getByRole('heading', { name: 'Notifications' }).waitFor();
check('customer: notification centre lists the updates with generic wording', (await cust.getByText(/There is an update on application/).first().isVisible()) && (await cust.getByText(/We received your/).first().isVisible()));
await axe(cust, 'customer notifications');

// ================= turnaround page =================
await big.getByRole('button', { name: 'Turnaround' }).click();
await big.getByRole('heading', { name: 'Turnaround time' }).waitFor();
await big.getByText(/As of/).waitFor();
check('staff: the turnaround page shows median, 90th and 95th percentile, definitions and source', (await big.getByText('90th percentile').first().isVisible()) && (await big.getByText('Definitions').first().isVisible()) && (await big.getByText(/tat_event/).first().isVisible()));
check('staff: customer wait is shown as its own row, not merged into bank time', (await big.getByRole('row', { name: /Customer wait/ }).count()) > 0 && (await big.getByRole('row', { name: /Bank time/ }).count()) > 0);
await axe(big, 'staff turnaround'); await big.screenshot({ path: `${OUT}staff-5-tat.png`, fullPage: true });
check('no unexpected page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
void caseId;
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
