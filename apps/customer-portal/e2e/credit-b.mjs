// Browser end-to-end for Phase 6b (SYNTHETIC demo definitions): per-party income, an external check through the dev provider, two-approver approval above a threshold, the portfolio page.
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
const dest = `96${String(Date.now()).slice(-7)}4`.slice(0, 10);
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
await cust.getByRole('button', { name: /^services$/i }).click(); await cust.getByRole('button', { name: /joint approval/i }).click();
await cust.getByRole('button', { name: /start application/i }).click();
await cust.getByLabel(/amount requested/i).fill('1500000'); await cust.getByLabel(/tenor in months/i).fill('36'); await cust.getByLabel(/^purpose/i).fill('Buy a grain mill');
await cust.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg(5) });
await cust.getByText(/uploaded and checked/i).waitFor();
await cust.waitForTimeout(1500);
await cust.getByText(/saved automatically/i).waitFor();
await cust.getByRole('button', { name: /check and submit/i }).click();
await cust.getByRole('heading', { name: /your application was received/i }).waitFor();
const code = (await cust.getByTestId('tracking-code').innerText()).trim();
check('customer: business loan application submitted', /^BB-/.test(code), code);

// ================= credit officer: parties, per-party income, external check =================
const sctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const off = await sctx.newPage(); lastPage = off;
off.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(off, 'creditA');
await off.getByRole('button', { name: `Claim ${code}` }).click();
await off.getByRole('button', { name: `Open case ${code}` }).click();
await off.getByText(/does not approve or decline anything/).waitFor();
await off.getByRole('button', { name: 'Open credit proposal' }).click();
await off.getByRole('heading', { name: 'System-generated figures' }).waitFor();
for (const [role, name] of [['borrower', 'Bina Synthetic'], ['co_applicant', 'Chandra Synthetic'], ['guarantor', 'Gita Synthetic']]) {
  await off.getByRole('textbox', { name: /^Role/ }).fill(role); await off.getByRole('textbox', { name: /^Name/ }).fill(name);
  await off.getByRole('button', { name: 'Add a party', exact: true }).click();
  await off.getByText(new RegExp(`${name}.*\\(${role.replace('_', ' ')}\\)`)).first().waitFor();
}
check('three parties recorded with their roles', true);

await off.getByLabel('Input', { exact: true }).selectOption({ label: 'Annual income' });
const partySelect = off.getByLabel('For which party');
const options = await partySelect.locator('option').allInnerTexts();
check('the income form offers only the parties whose role counts for income (not the guarantor)', options.length === 2 && !options.some((o) => /Gita/.test(o)), JSON.stringify(options));
await partySelect.selectOption({ label: 'Bina Synthetic (borrower)' });
await off.getByLabel('Value', { exact: true }).fill('600000'); await off.getByRole('button', { name: 'Save input' }).click();
await off.getByText(/Bina Synthetic \(borrower\): 600000/).waitFor();
check('a party without a value is shown as missing, never as zero', await off.getByText(/Chandra Synthetic \(co applicant\): Missing/).isVisible());
await off.getByLabel('Input', { exact: true }).selectOption({ label: 'Annual income' });
await off.getByLabel('For which party').selectOption({ label: 'Chandra Synthetic (co applicant)' });
await off.getByLabel('Value', { exact: true }).fill('600000'); await off.getByRole('button', { name: 'Save input' }).click();
await off.getByText(/Chandra Synthetic \(co applicant\): 600000/).waitFor();
for (const [label, value] of [['Annual obligations', '300000'], ['Annual payments on the new facility', '300000'], ['Facility amount', '1500000'], ['Security value', '3000000']]) {
  await off.getByLabel('Input', { exact: true }).selectOption({ label });
  await off.getByLabel('Value', { exact: true }).fill(value); await off.getByRole('button', { name: 'Save input' }).click();
  await off.getByRole('row', { name: new RegExp(label) }).getByText(value).waitFor();
}
await off.getByRole('button', { name: 'Run calculations and score' }).click();
await off.getByText('2.0000').first().waitFor();
check('the combined income (1,200,000) gives coverage 2.0000', true);

// external check: requested by a person, sent later by the dispatcher
await off.getByRole('heading', { name: 'External checks' }).waitFor();
await off.getByLabel('Lawful basis for the check').fill('Customer application, consent clause 3');
await off.getByLabel("Evidence of the customer's consent").fill('Signed consent on file C-1');
await off.getByRole('button', { name: 'Request an external check', exact: true }).click();
await off.getByText('Requested, not yet sent').waitFor();
check('the external check is only requested; nothing has been sent', true);
const sched = await staffApi('sched');
const run = await sched('POST', '/ops/credit/run');
check('the dispatcher sends it and records a result', run.status === 200 && run.body.externalChecks.received >= 1, JSON.stringify(run.body));
await off.getByRole('button', { name: 'Save answer Identity and KYC complete' }).click();      // any save reloads the panel
await off.getByText('Result received').waitFor();
check('the result shows a reference and summary fields, not a report', (await off.getByText(/DEV-/).isVisible()) && (await off.getByText(/band: B/).isVisible()));
for (const item of ['Income evidence reviewed', 'Existing exposure checked']) {
  await off.getByRole('button', { name: `Save answer ${item}` }).click();
  await off.getByRole('listitem').filter({ hasText: item }).getByText('Not answered').waitFor({ state: 'detached' });
}
await off.getByRole('button', { name: 'Run calculations and score' }).click();
await off.getByText('Calculations run.').waitFor();
await off.getByLabel('Rationale').fill('Repayment capacity is adequate on the combined income.');
await off.getByRole('button', { name: 'Record recommendation' }).click();
await off.getByText(/adequate on the combined income/).first().waitFor();
await axe(off, 'credit workspace, per party'); await noOverflow(off, 'credit workspace, per party'); await off.screenshot({ path: `${OUT}credit-3-per-party.png`, fullPage: true });
await off.getByRole('radio', { name: 'Complete this stage' }).check();
await off.getByRole('button', { name: 'Record', exact: true }).click(); await off.getByText('Recorded.').waitFor();

// ================= two approvers above the threshold =================
const a1ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const a1 = await a1ctx.newPage(); lastPage = a1;
a1.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(a1, 'approverBig');
await a1.getByRole('button', { name: `Open case ${code}` }).click();
await a1.getByText(/Approvals recorded \(different approvers needed\): 0 \/ 2/).waitFor();
check('the approver is told that two different approvers are needed at this amount', true);
await a1.getByRole('radio', { name: 'Approve' }).check();
await a1.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: first approval');
await a1.getByRole('button', { name: 'Record', exact: true }).click();
await a1.getByText(/Your approval is recorded\. Another approver must also approve\. \(1 \/ 2\)/).waitFor();
check('first approval recorded; the case is not decided yet', true);
await a1.getByText(/Approvals recorded \(different approvers needed\): 1 \/ 2/).waitFor();
check('the same approver cannot approve twice (the check says so and actions are disabled)', (await a1.getByText(/You have not already approved this request/).isVisible()) && (await a1.getByRole('button', { name: 'Record', exact: true }).isDisabled()));
await a1.screenshot({ path: `${OUT}credit-4-joint-first.png`, fullPage: true });

const a2ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const a2 = await a2ctx.newPage(); lastPage = a2;
await staffLogin(a2, 'approverBig2');
await a2.getByRole('button', { name: `Open case ${code}` }).click();
await a2.getByText(/Approvals recorded \(different approvers needed\): 1 \/ 2/).waitFor();
await a2.getByRole('radio', { name: 'Approve' }).check();
await a2.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: second approval');
await a2.getByRole('button', { name: 'Record', exact: true }).click(); await a2.getByText('Recorded.').waitFor();
await a2.getByText(/approved/i).first().waitFor();
check('the second, different approver completes the approval', true);

// ================= portfolio =================
const pf = await sctx.newPage(); lastPage = pf;
await staffLogin(pf, 'creditA');
await pf.getByRole('button', { name: 'Credit portfolio' }).click();
await pf.getByRole('heading', { name: 'Credit portfolio' }).waitFor();
await pf.getByText(/Credit proposals:/).waitFor();
check('the portfolio shows counts with definitions and no identities', (await pf.getByText(/by case state/i).count()) > 0 && !/BB-[A-Z2-9]{5}/.test(await pf.locator('main').innerText()));
await axe(pf, 'credit portfolio'); await pf.screenshot({ path: `${OUT}credit-5-portfolio.png`, fullPage: true });

// ================= the customer sees none of it =================
lastPage = cust;
await cust.reload(); await cust.getByRole('button', { name: /^my applications$/i }).click(); await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Decision' }).waitFor();
const page = await cust.locator('body').innerText();
const leak = page.match(/Bina|Chandra|Gita|DEV-|bureau|band|adequate on the combined|INTERNAL-RATIONALE|coverage/i);
check('customer sees the decision wording only: no parties, reference, provider, recommendation or rationale', !leak, leak ? `matched: ${leak[0]} in ...${page.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\\s+/g, ' ')}` : '');
check('no unexpected page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
