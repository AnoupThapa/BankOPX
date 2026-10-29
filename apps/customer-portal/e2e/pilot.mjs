// Browser end-to-end for Phase 5 (pilot service): a customer requests a certificate; an officer reviews; an approver approves; the case is NOT complete until
// an operations officer records the bank system's reference; the customer sees "in progress" until then. Also the pilot metrics page and the baseline form.
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
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-5/', import.meta.url).pathname;
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
const dest = `96${String(Date.now()).slice(-7)}2`.slice(0, 10);
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)]);

// ================= customer requests a certificate (phone) =================
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
await cust.getByRole('button', { name: /^services$/i }).click(); await cust.getByRole('button', { name: /certificate request/i }).click();
await cust.getByRole('button', { name: /start application/i }).click();
await cust.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg(5) });
await cust.getByText(/uploaded and checked/i).waitFor();
await cust.getByLabel(/what is the certificate for/i).selectOption('embassy');
await cust.waitForTimeout(1500);   // let the automatic save finish
await cust.getByText(/saved automatically/i).waitFor();
await cust.getByRole('button', { name: /check and submit/i }).click();
await cust.getByRole('heading', { name: /your application was received/i }).waitFor();
const code = (await cust.getByTestId('tracking-code').innerText()).trim();
check('customer: certificate request submitted, tracking code shown', /^BB-/.test(code), code);

// ================= officer reviews; approver approves (no amount: authority limits are not applicable) =================
const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const staff = await sctx.newPage(); lastPage = staff;
staff.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(staff, 'officerA');
await staff.getByRole('button', { name: `Claim ${code}` }).click();
await staff.getByRole('button', { name: `Open case ${code}` }).click();
await staff.getByRole('heading', { name: code }).waitFor();
await staff.getByText(/You hold the permission for this case and branch/).waitFor();
await staff.getByRole('radio', { name: 'Complete this stage' }).check();
await staff.getByRole('button', { name: 'Record' }).click(); await staff.getByText('Recorded.').waitFor();
check('staff: review stage completed through the portal', true);

const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const appr = await bctx.newPage(); lastPage = appr;
appr.on('pageerror', (e) => pageErrors.push(e.message));
await staffLogin(appr, 'approverSmall');
await appr.getByRole('button', { name: `Open case ${code}` }).click();
await appr.getByText(/You hold the permission for this case and branch/).waitFor();
check('approver with a money limit can decide a non-monetary request (no "Above your authority limit")', !(await appr.getByText(/Above your authority limit/).isVisible()));
await appr.getByRole('radio', { name: 'Approve' }).check();
await appr.getByLabel(/Rationale/).fill('INTERNAL-RATIONALE: identity and account confirmed');
await appr.getByRole('button', { name: 'Record' }).click(); await appr.getByText('Recorded.').waitFor();
check('approver: decision recorded', true);

// ================= approved is not completed =================
lastPage = cust;
await cust.reload();
await cust.getByRole('button', { name: /^my applications$/i }).click();
await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Completion' }).waitFor();
check('customer: after approval sees "still completing", not "completed"', (await cust.getByText(/still completing this request/).isVisible()) && !(await cust.getByText(/has been completed by the bank/).isVisible()));
await axe(cust, 'customer approved, in progress'); await noOverflow(cust, 'customer approved, in progress'); await cust.screenshot({ path: `${OUT}customer-1-in-progress.png`, fullPage: true });

// ================= operations: the hand-off waits, is sent, and is confirmed by a person =================
const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ops = await octx.newPage(); lastPage = ops;
ops.on('pageerror', (e) => pageErrors.push(e.message));
await ops.goto(STAFF);
await ops.getByLabel('Username').fill('ops'); await ops.getByLabel('Password').fill(SECRETS.password);
await ops.getByLabel('Authenticator code').fill(authenticator.generate(SECRETS.totp.ops));
await ops.getByRole('button', { name: 'Sign in' }).click();
await ops.getByRole('button', { name: 'Hand-offs' }).click();
await ops.getByRole('heading', { name: 'Hand-offs to the bank system' }).waitFor();
await ops.getByText(code).first().waitFor();
check('ops: the new hand-off is "Waiting to be sent"', await ops.getByRole('row', { name: new RegExp(code) }).getByText('Waiting to be sent').isVisible());
const sched = await staffApi('sched');
const run = await sched('POST', '/ops/integration/dispatch');
check('scheduler identity dispatches the hand-off', run.status === 200 && run.body.attempted >= 1, JSON.stringify(run.body));
await ops.getByRole('button', { name: 'Hand-offs' }).click();
await ops.getByLabel('Show').selectOption('sent');
await ops.getByRole('row', { name: new RegExp(code) }).getByText('Sent, not confirmed').waitFor();
check('ops: after dispatch the hand-off is "Sent, not confirmed" (not complete)', await ops.getByRole('row', { name: new RegExp(code) }).getByText('Sent, not confirmed').isVisible());
await cust.reload(); await cust.getByRole('button', { name: /^my applications$/i }).click(); await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Completion' }).waitFor();
check('customer: still "in progress" while the hand-off is only sent', await cust.getByText(/still completing this request/).isVisible());
await ops.getByRole('button', { name: new RegExp(`Open ${code}`) }).click();
await ops.getByRole('heading', { name: /Record the bank's confirmation/ }).waitFor();
await axe(ops, 'ops hand-off detail'); await noOverflow(ops, 'ops hand-off detail'); await ops.screenshot({ path: `${OUT}ops-1-handoff.png`, fullPage: true });
await ops.getByRole('button', { name: 'Record confirmation' }).click();   // empty form: the browser blocks it (required fields)
check('ops: confirmation cannot be recorded without the bank reference and a note', await ops.getByRole('heading', { name: /Record the bank's confirmation/ }).isVisible());
await ops.getByLabel(/Reference given by the bank system/).fill('CBS-CERT-0001');
await ops.getByLabel(/What did you check/).fill('Certificate issued in the bank system');
await ops.getByRole('button', { name: 'Record confirmation' }).click();
await ops.getByRole('heading', { name: /Confirmed by the bank system/ }).waitFor();
check('ops: confirmation recorded; status now "Confirmed by the bank system"', await ops.getByText('Recorded.').isVisible());

// ================= customer sees completion =================
lastPage = cust;
await cust.reload(); await cust.getByRole('button', { name: /^my applications$/i }).click(); await cust.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
await cust.getByRole('heading', { name: 'Completion' }).waitFor();
check('customer: now sees "completed by the bank"', await cust.getByText(/has been completed by the bank/).isVisible());
const page = await cust.content();
check('customer: no bank reference, connector, rationale or staff names on the page', !/CBS-CERT-0001|controlled-handoff|issue_certificate|INTERNAL-RATIONALE|officerA|approverSmall|ops\b/.test(page));
await axe(cust, 'customer completed'); await cust.screenshot({ path: `${OUT}customer-2-completed.png`, fullPage: true });
await cust.getByRole('button', { name: /^notifications/i }).click();
await cust.getByRole('heading', { name: 'Notifications' }).waitFor();
await cust.getByText(/has been completed\./).first().waitFor();
check('customer: a notification says the application has been completed, with no details', true);

// ================= pilot page =================
lastPage = ops;
await ops.getByRole('button', { name: 'Pilot' }).click();
await ops.getByRole('heading', { name: 'Pilot measures' }).waitFor();
const svcKey = `certificate-request-run${Date.now()}`;   // a key nobody has recorded a baseline for, so the run can be repeated
await ops.getByLabel('Service (optional)').first().fill(svcKey); await ops.getByRole('button', { name: 'Show' }).click();
await ops.getByText(/No baseline recorded for this service yet/).waitFor();
check('pilot: with no baseline the page says no improvement can be stated', await ops.getByText(/no improvement can be stated/).isVisible());
check('pilot: measured hand-offs include the confirmed one', await ops.getByText(/Confirmed share/).isVisible());
await ops.getByLabel('Value').fill('72'); await ops.getByLabel('Sample size').fill('40');
await ops.getByLabel('Period start').fill('2026-08-01'); await ops.getByLabel('Period end').fill('2026-08-31');
await ops.getByLabel('How was it measured?').fill('Sample of 40 closed requests from the branch log');
await ops.getByRole('button', { name: 'Save baseline' }).click();
await ops.getByText('Baseline saved.').waitFor();
await ops.getByText('Sample of 40 closed requests from the branch log').first().waitFor();
check('pilot: the recorded baseline is shown with its method, sample and period', (await ops.getByText('2026-08-01 – 2026-08-31').isVisible()));
await axe(ops, 'pilot page'); await noOverflow(ops, 'pilot page'); await ops.screenshot({ path: `${OUT}ops-2-pilot.png`, fullPage: true });

// ================= people without operations rights =================
const ofc = await sctx.newPage(); lastPage = ofc;
await staffLogin(ofc, 'lead');
await ofc.getByRole('button', { name: 'Hand-offs' }).click();
await ofc.getByRole('alert').waitFor();
check('a team lead without operations rights sees a plain refusal on the hand-offs page', await ofc.getByText('You do not have access to this page.').isVisible());

check('no unexpected page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
