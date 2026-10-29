// Browser end-to-end for Phase 6 (credit review, SYNTHETIC demo definitions): a customer applies for a business loan; a credit officer opens the proposal, enters inputs,
// answers the checklist, runs the approved calculations, sets a condition and records a recommendation; an approver sees it and decides; a second officer clears the condition.
// The customer never sees any of it. Nothing in the credit panel can approve or decline.
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
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-6/', import.meta.url).pathname;
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
const dest = `96${String(Date.now()).slice(-7)}3`.slice(0, 10);
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)]);

// ================= customer applies =================
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
await cust.getByRole('button', { name: /^services$/i }).click(); await cust.getByRole("button", { name: /business loan \(demo\)/i }).click();
await cust.getByRole('button', { name: /start application/i }).click();
await cust.getByLabel(/amount requested/i).fill('500000'); await cust.getByLabel(/tenor in months/i).fill('36'); await cust.getByLabel(/^purpose/i).fill('Buy a grain mill');
await cust.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg(5) });
await cust.getByText(/uploaded and checked/i).waitFor();
await cust.waitForTimeout(1500);
await cust.getByText(/saved automatically/i).waitFor();
await cust.getByRole('button', { name: /check and submit/i }).click();
await cust.getByRole('heading', { name: /your application was received/i }).waitFor();
const code = (await cust.getByTestId('tracking-code').innerText()).trim();
check('customer: business loan application submitted', /^BB-/.test(code), code);

// ================= credit officer prepares the proposal =================
const sctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const off = await sctx.newPage(); lastPage = off;
off.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(off, 'creditA');
await off.getByRole('button', { name: `Claim ${code}` }).click();
await off.getByRole('button', { name: `Open case ${code}` }).click();
await off.getByRole('heading', { name: 'Credit review' }).waitFor();
await off.getByText(/does not approve or decline anything/).waitFor();
check('credit panel states that it does not approve or decline', true);
await off.getByRole('button', { name: 'Open credit proposal' }).click();
await off.getByRole('heading', { name: 'System-generated figures' }).waitFor();
check('proposal opened with the requested amount from the application', await off.getByText('500000 NPR').isVisible());
check('before any input, the key inputs are shown as missing, not as zero', (await off.getByRole('row', { name: /Annual income/ }).getByText('Missing').count()) > 0);

const inputs = [['Annual income', '1200000'], ['Annual obligations', '300000'], ['Annual payments on the new facility', '300000'], ['Facility amount', '1000000'], ['Security value', '2000000']];
for (const [label, value] of inputs) {
  await off.getByLabel('Input', { exact: true }).selectOption({ label });
  await off.getByLabel('Value', { exact: true }).fill(value);
  await off.getByRole('button', { name: 'Save input' }).click();
  await off.getByRole('row', { name: new RegExp(label) }).getByText(value).waitFor();
}
check('inputs recorded and shown with their source', (await off.getByRole('row', { name: /Annual income/ }).getByText('Entered by staff').count()) > 0);

// the figures are not produced until a person runs them
check('no score before calculations are run', await off.getByText('No calculations have been run yet.').isVisible());
await off.getByRole('button', { name: 'Run calculations and score' }).click();
await off.getByText('90.0000', { exact: true }).first().waitFor();
check('calculations ran: coverage 2.0000 and security ratio 0.5000, score 90.0000', (await off.getByText('2.0000').count()) > 0 && (await off.getByText('0.5000').count()) > 0);
check('score is labelled system-generated, informational and not a decision, with its factors', (await off.getByText(/System-generated; informational\. Not a decision\./).isVisible()) && (await off.getByRole('row', { name: /Coverage/ }).count()) > 0);
await axe(off, 'credit workspace'); await noOverflow(off, 'credit workspace'); await off.screenshot({ path: `${OUT}credit-1-workspace.png`, fullPage: true });

// recommendation needs the checklist
await off.getByLabel('Rationale').fill('Repayment capacity is adequate on the figures shown.');
await off.getByRole('button', { name: 'Record recommendation' }).click();
await off.getByText('Answer every required checklist item first.').waitFor();
check('a recommendation without the required checklist is refused in plain words', true);
for (const item of ['Identity and KYC complete', 'Income evidence reviewed', 'Existing exposure checked']) {
  await off.getByRole('button', { name: `Save answer ${item}` }).click();
  await off.getByRole('listitem').filter({ hasText: item }).getByText('Not answered').waitFor({ state: 'detached' });
}
check('checklist answered', true);
await off.getByLabel('Condition', { exact: true }).fill('Insurance with the bank as beneficiary');
await off.getByLabel('Evidence needed', { exact: true }).fill('Copy of the policy');
await off.getByLabel(/^Due date/).fill('2020-01-01');
await off.getByRole('button', { name: 'Add a condition' }).click();
await off.getByText(/Insurance with the bank as beneficiary/).first().waitFor();
check('a condition is recorded and shown as overdue when its date has passed', await off.getByText('Overdue').first().isVisible());
await off.getByRole('combobox', { name: "Recommendation (a person's judgement)" }).selectOption('support_with_conditions');
await off.getByLabel('Rationale').fill('Repayment capacity is adequate on the figures shown.');
await off.getByRole('button', { name: 'Record recommendation' }).click();
await off.getByText('Support with conditions').first().waitFor();
check('recommendation recorded as a person\'s judgement', await off.getByText(/Repayment capacity is adequate/).first().isVisible());
// complete the review stage through the normal task
await off.getByRole('radio', { name: 'Complete this stage' }).check();
await off.getByRole('button', { name: 'Record', exact: true }).click(); await off.getByText('Recorded.').waitFor();
check('review stage completed; the case now waits for an approver', true);

// ================= approver sees the credit file and decides =================
const actx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const appr = await actx.newPage(); lastPage = appr;
appr.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(appr, 'approverBig');
await appr.getByRole('button', { name: `Open case ${code}` }).click();
await appr.getByRole('heading', { name: 'Credit review' }).waitFor();
await appr.getByText(/Repayment capacity is adequate/).first().waitFor(); await appr.getByText('90.0000', { exact: true }).first().waitFor();
check('approver sees the recommendation, the system figures and the condition', (await appr.getByText(/Repayment capacity is adequate/).first().isVisible()) && (await appr.getByText('90.0000', { exact: true }).first().isVisible()) && (await appr.getByText(/Insurance with the bank as beneficiary/).first().isVisible()));
check('approver cannot edit the credit file (no entry forms)', (await appr.getByRole('button', { name: 'Run calculations and score' }).count()) === 0 && (await appr.getByRole('button', { name: 'Record recommendation' }).count()) === 0);
await appr.getByRole('radio', { name: 'Approve' }).check();
await appr.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: within policy');
await appr.getByRole('button', { name: 'Record', exact: true }).click(); await appr.getByText('Recorded.').waitFor();
check('approver recorded the decision (a separate human step)', true);
await axe(appr, 'credit workspace, approver'); await appr.screenshot({ path: `${OUT}credit-2-approver.png`, fullPage: true });

// ================= another officer clears the condition =================
const c2 = await sctx.newPage(); lastPage = c2;
await staffLogin(c2, 'creditA2');
await c2.getByRole('button', { name: 'Cases' }).click();
await c2.getByRole('button', { name: `Open case ${code}` }).click();
await c2.getByRole('heading', { name: 'Credit review' }).waitFor();
await c2.getByLabel(/What evidence did you check/).fill('Policy copy received and checked');
await c2.getByRole('button', { name: /Clear condition/ }).click();
await c2.getByText('Cleared').first().waitFor();
check('a different officer cleared the condition after approval', true);
const mine = await sctx.newPage(); lastPage = mine;
await staffLogin(mine, 'creditA');
await mine.getByRole('button', { name: 'Cases' }).click(); await mine.getByRole('button', { name: `Open case ${code}` }).click();
await mine.getByRole('heading', { name: 'Credit review' }).waitFor();
check('a cleared condition offers no further clear control to anyone', (await mine.getByRole('button', { name: /Clear condition/ }).count()) === 0);

// ================= the customer sees none of it =================
lastPage = cust;
await cust.reload(); await cust.getByRole('button', { name: /^my applications$/i }).click(); await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Decision' }).waitFor();
const page = await cust.content();
check('customer sees the decision wording only: no score, recommendation, ratios, conditions, rationale or staff names', !/90\.0000|2\.0000|0\.5000|Support with conditions|Repayment capacity|Insurance with the bank|INTERNAL-RATIONALE|creditA|approverBig|coverage|scorecard/i.test(page));
await axe(cust, 'customer decided credit case');
check('no unexpected page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
