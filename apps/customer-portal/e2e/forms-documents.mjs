// Browser end-to-end for Phase 3: an admin builds and publishes a form (maker, then a different checker), a customer fills it on a phone,
// uploads a document with the camera control, submits, staff return the case, the customer corrects it.
// Needs: dev API (core/dev/dev-server.ts, DEV_SECRETS_FILE set), customer portal on :5173, admin portal on :5174, global Playwright.
import { readFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { authenticator } = createRequire(new URL('../../../core/package.json', import.meta.url))('otplib');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:5173';
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:5174';
const API = process.env.API_URL ?? 'http://127.0.0.1:3100';
const LOG = process.env.DEV_LOG ?? '/tmp/dev-server.log';
const SECRETS = JSON.parse(readFileSync(process.env.DEV_SECRETS_FILE ?? '/tmp/bbjp-dev-secrets.json', 'utf8'));
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-3/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otpCount = (dest) => readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]') && l.split(' ')[1] === dest).length;
async function otpFor(dest, seen) {
  for (let i = 0; i < 60; i++) { const h = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]') && l.split(' ')[1] === dest); if (h.length > seen) return h.at(-1).split(' ')[2]; await sleep(100); }
  throw new Error('no OTP for ' + dest);
}
async function axe(page, label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  check(`axe ${label}: no WCAG 2.1 A/AA violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(','));
}
const noOverflow = async (page, label) => check(`${label}: no horizontal scrolling`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)]);

// ---------- staff API helper (officer reviewing the case) ----------
async function staff(username) {
  const jar = {};
  const call = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': jar.csrf ?? '', cookie: jar.cookie ?? '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0];
    const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : undefined };
  };
  const l = await call('POST', '/auth/login', { institution: SECRETS.institution, username, password: SECRETS.password }); jar.csrf = l.body.csrfToken;
  await call('POST', '/auth/mfa/verify', { code: authenticator.generate(SECRETS.totp[username]) });
  const raw = async (path) => { const r = await fetch(API + path, { headers: { cookie: jar.cookie ?? '' } }); return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') }; };
  return { call, raw };
}

const browser = await chromium.launch();
let lastPage; const pageErrors = [];
process.on('uncaughtException', async (e) => { console.log('FAILED:', e.message.split('\n')[0]); try { console.log('page errors:', pageErrors.slice(0, 2)); console.log('--- page text ---\n' + (await lastPage.locator('body').innerText()).slice(0, 1500)); } catch { /* page gone */ } process.exit(1); });

// ================= A. admin builds the form =================
async function adminLogin(page, user) {
  await page.goto(ADMIN);
  await page.getByLabel('Username').fill(user); await page.getByLabel('Password').fill(SECRETS.password);
  await page.getByLabel('Authenticator code').fill(authenticator.generate(SECRETS.totp[user]));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Form designer' }).waitFor();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await adminLogin(page, 'maker');
  await page.getByLabel('Form key').fill('address-change-form');
  const add = async (type) => { await page.getByLabel('Field type', { exact: true }).selectOption(type); await page.getByRole('button', { name: 'Add field' }).click(); };
  await add('text'); await add('multiline'); await add('file'); await add('consent');
  const set = async (i, en, ne, key) => { await page.getByLabel('Field key').nth(i).fill(key); await page.getByLabel('Label (English)').nth(i).fill(en); if (ne) await page.getByLabel('Label (Nepali)').nth(i).fill(ne); };
  await set(0, 'Your full name', '', 'full_name'); await set(1, 'Your new address', 'तपाईंको नयाँ ठेगाना', 'new_address'); await set(2, 'Photo of your ID', 'तपाईंको परिचयपत्रको फोटो', 'id_photo'); await set(3, 'I confirm this address is correct', 'यो ठेगाना सही छ भनी पुष्टि गर्छु', 'confirm');
  await page.getByRole('checkbox', { name: 'Required' }).nth(0).check(); await page.getByRole('checkbox', { name: 'Required' }).nth(2).check(); await page.getByRole('checkbox', { name: 'Required' }).nth(3).check();
  await page.getByLabel('Document key').fill('id_photo');
  await page.getByRole('button', { name: 'Check for publish blockers' }).click();
  await page.getByRole('alert').filter({ hasText: 'Publish blockers' }).waitFor();
  check('admin: a missing Nepali label is reported as a publish blocker before review', (await page.getByRole('alert').filter({ hasText: 'Publish blockers' }).innerText()).includes('Nepali'));
  await page.getByLabel('Label (Nepali)').nth(0).fill('तपाईंको पूरा नाम');
  await page.getByRole('button', { name: 'Check for publish blockers' }).click();
  await page.getByText('No blockers.').waitFor();
  check('admin: with the label added there are no blockers', true);
  check('admin: the preview shows the form being designed', await page.getByTestId('preview').getByLabel('Your full name').isVisible());
  await page.getByLabel('Reason for this change').fill('New address-change form for the demo service');
  await axe(page, 'admin designer'); await page.screenshot({ path: `${OUT}admin-1-designer.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save and submit for review' }).click();
  await page.getByText(/different person must approve/).waitFor();
  check('admin: the maker submits for review', true);
  await page.getByRole('button', { name: 'Review queue' }).click();
  await page.getByRole('heading', { name: 'Waiting for review' }).waitFor();
  check('admin: the maker cannot approve their own change (button disabled, reason shown)', await page.getByRole('button', { name: /Approve and publish address-change-form/ }).isDisabled() && await page.getByText(/someone else must approve/).isVisible());
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  await adminLogin(p2, 'checker');
  await p2.getByRole('button', { name: 'Review queue' }).click();
  await p2.getByText('New (no live version yet)').waitFor();
  await axe(p2, 'admin review queue'); await p2.screenshot({ path: `${OUT}admin-2-review.png`, fullPage: true });
  await p2.getByLabel('Reason').fill('Reviewed: labels and privacy classes are right');
  await p2.getByRole('button', { name: /Approve and publish address-change-form/ }).click();
  await p2.getByText('Done.').waitFor();
  check('admin: a different checker approves and publishes', true);
  await ctx2.close();
}

// ================= B. customer applies =================
for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  const dest = `97${String(Date.now()).slice(-7)}${name === 'mobile' ? 1 : 2}`.slice(0, 10);
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage(); lastPage = page;
  const bad = [];
  page.on('pageerror', (e) => { bad.push(e.message); pageErrors.push(e.message); });
  page.on('response', (r) => { if (r.status() >= 400 && ![[401, '/customer/profile'], [404, '/draft'], [400, '/documents/'], [422, '/submit'], [422, '/respond']].some(([c, u]) => r.status() === c && r.url().includes(u))) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(CUSTOMER);
  let seen = otpCount(dest);
  await page.getByLabel(/mobile number/i).fill(dest); await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(dest, seen)); await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('heading', { name: /privacy choices/i }).waitFor();
  await page.getByRole('checkbox').first().check(); await page.getByRole('button', { name: /save my choices/i }).click();
  await page.getByRole('heading', { name: /your profile/i }).waitFor();
  await page.getByRole('button', { name: /link my existing bank relationship/i }).click();
  seen = otpCount(dest); await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(dest, seen)); await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel(/account number/i).fill(`55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`); await page.getByLabel(/date of birth/i).fill('1990-01-01');
  await page.getByRole('button', { name: /^link$/i }).click(); await page.getByText(/your bank relationship is linked/i).waitFor();

  await page.getByRole('button', { name: /^services$/i }).click();
  await page.getByRole('button', { name: /change of address/i }).click();
  await page.getByRole('button', { name: /start application/i }).click();
  await page.getByRole('heading', { name: /change of address/i }).waitFor();
  await noOverflow(page, `${name} application form`); await axe(page, `${name} application form`);
  check(`${name}: the consent in the form starts unticked`, !(await page.getByLabel('I confirm this address is correct').isChecked()));
  await page.getByLabel('Your full name').fill('Asha Synthetic');
  await page.getByText(/saved automatically/i).waitFor();
  check(`${name}: answers are saved automatically`, true);

  // a bad file first: text renamed .jpg is refused with a safe message
  await page.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') });
  await page.getByText(/could not be uploaded/i).waitFor();
  check(`${name}: a non-image renamed .jpg is refused with a plain message`, true);
  // then a photo through the camera control
  await page.locator('input[type=file][capture]').setInputFiles({ name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg(5) });
  await page.getByText(/uploaded and checked/i).waitFor();
  check(`${name}: a photo taken with the camera control is uploaded and checked`, true);

  // resume: reload keeps answers and the document
  await page.reload();
  await page.getByRole('button', { name: /^services$/i }).click(); await page.getByRole('button', { name: /change of address/i }).click();
  await page.getByRole('button', { name: /continue your saved application/i }).click();
  await page.getByLabel('Your full name').waitFor();
  check(`${name}: reloading resumes the saved answers`, (await page.getByLabel('Your full name').inputValue()) === 'Asha Synthetic');
  check(`${name}: the uploaded document is still there after reload`, await page.getByText(/id\.jpg.*uploaded and checked/i).isVisible());

  // submit without the required consent -> error beside the field
  await page.getByLabel('Your new address').fill('Ward 4, Lalitpur');
  await page.getByRole('button', { name: /check and submit/i }).click();
  await page.getByText(/must agree to continue/i).waitFor();
  check(`${name}: the server's error appears beside the field in plain words`, await page.getByText(/some answers need your attention/i).isVisible());
  await page.screenshot({ path: `${OUT}${name}-1-form-errors.png`, fullPage: true });
  await page.getByLabel('I confirm this address is correct').check();
  await page.getByRole('button', { name: /check and submit/i }).click();
  await page.getByRole('heading', { name: /your application was received/i }).waitFor();
  const code = (await page.getByTestId('tracking-code').innerText()).trim();
  check(`${name}: the receipt shows a random-looking tracking code`, /^BB-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code), code);
  check(`${name}: the receipt says it is not an approval and the code is not a key`, (await page.getByText(/not an approval/i).first().isVisible()) && (await page.getByText(/does not give anyone access/i).isVisible()));
  await noOverflow(page, `${name} receipt`); await axe(page, `${name} receipt`);
  await page.screenshot({ path: `${OUT}${name}-2-receipt.png`, fullPage: true });

  // ================= C. staff return it =================
  const officer = await staff('officerA');
  const list = await officer.call('GET', '/staff/cases');
  const mine = list.body.find((c) => c.trackingCode === code);
  check(`${name}: staff in the customer's branch see the case`, !!mine);
  const detail = await officer.call('GET', `/staff/cases/${mine.caseId}`);
  const file = await officer.raw(`/documents/${detail.body.documents[0].version_id}/content`);
  check(`${name}: staff in scope open the scanned document and get the exact bytes`, file.status === 200 && file.bytes.equals(jpeg(5)) && file.type === 'image/jpeg');
  check(`${name}: the same file is closed to a request with no session`, (await fetch(`${API}/documents/${detail.body.documents[0].version_id}/content`)).status === 401);
  await officer.call('POST', `/staff/cases/${mine.caseId}/notes`, { body: 'INTERNAL: check signature against core record' });
  const r = await officer.call('POST', `/staff/cases/${mine.caseId}/info-requests`, { reasonCode: 'unclear_document', customerText: 'The photo of your ID is too dark to read. Please retake it in better light and check your name.',
    items: [{ type: 'field', key: 'full_name', text: 'Enter your name exactly as on your ID' }, { type: 'document', key: 'id_photo', text: 'Retake the photo of your ID' }] });
  check(`${name}: staff send a specific return request`, r.status === 201);

  // ================= D. customer corrects =================
  await page.getByRole('button', { name: /view my applications/i }).click();
  await page.getByRole('button', { name: new RegExp(`open ${code}`, 'i') }).click();
  await page.getByRole('heading', { name: code }).waitFor();
  check(`${name}: the customer sees "more information needed" and exactly what to fix`, (await page.getByText('More information needed').first().isVisible()) && (await page.getByText('Retake the photo of your ID').isVisible()));
  check(`${name}: internal staff notes are never shown`, !(await page.content()).includes('INTERNAL'));
  await noOverflow(page, `${name} returned case`); await axe(page, `${name} returned case`);
  await page.screenshot({ path: `${OUT}${name}-3-returned.png`, fullPage: true });
  await page.getByLabel('Your full name').fill('Asha Corrected');
  await page.getByRole('button', { name: /send my corrections/i }).click();
  await page.getByText(/these documents are still needed/i).waitFor();
  check(`${name}: corrections without the requested new photo are refused`, true);
  await page.locator('input[type=file][capture]').setInputFiles({ name: 'id2.jpg', mimeType: 'image/jpeg', buffer: jpeg(9) });
  await page.getByText(/id2\.jpg.*uploaded and checked/i).waitFor();
  await page.getByRole('button', { name: /send my corrections/i }).click();
  await page.getByText(/we have your corrections/i).waitFor();
  check(`${name}: the customer sends corrections and the case goes back to review`, true);
  await page.getByText(/Version 2/).waitFor();
  check(`${name}: the history now shows two submissions`, (await page.getByText(/Version 1/).isVisible()) && (await page.getByText(/Version 2/).isVisible()));
  const after = await officer.call('GET', `/staff/cases/${mine.caseId}`);
  check(`${name}: staff see both snapshots and both document versions`, after.body.snapshots.length === 2 && after.body.documents.length === 2 && after.body.snapshots[0].data.full_name === 'Asha Synthetic');
  await page.screenshot({ path: `${OUT}${name}-4-answered.png`, fullPage: true });
  check(`${name}: no unexpected browser errors`, bad.length === 0, bad.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
