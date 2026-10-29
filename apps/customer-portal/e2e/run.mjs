// Browser end-to-end check against the dev API (core/dev/dev-server.ts) and the Vite dev server.
// Covers AT-VS-01 (create, resume on another device), AT-VS-02 (step-up + link), AT-VS-03 (service facts), AT-VS-04 (mobile, tablet, desktop).
// Usage: DEV_LOG=/tmp/dev-server.log BASE_URL=http://127.0.0.1:5173 node e2e/run.mjs
import { readFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// Playwright is a tool dependency, not a project dependency: it is resolved from the global install (NODE_PATH), with browsers already present.
const { chromium } = require('playwright');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const LOG = process.env.DEV_LOG ?? '/tmp/dev-server.log';
const OUT = process.env.OUT_DIR ?? new URL('../../../docs/evidence/phase-2/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function otpFor(dest, notBefore) {
  for (let i = 0; i < 50; i++) {
    const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]'));
    const hits = lines.filter((l) => l.split(' ')[1] === dest);
    if (hits.length > notBefore) return hits[hits.length - 1].split(' ')[2];
    await sleep(100);
  }
  throw new Error('no OTP seen for ' + dest);
}
const otpCount = (dest) => readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[dev-otp]') && l.split(' ')[1] === dest).length;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function axe(page, label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  check(`axe ${label}: no WCAG 2.1 A/AA violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(','));
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${label}: no horizontal scrolling`, !o);
}
async function smallTargets(page, label) {
  const bad = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width && r.height && cs.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5) && !(e.type === 'checkbox');
  }).map((e) => e.tagName + ':' + (e.textContent || e.name || '').slice(0, 20)));
  check(`${label}: touch targets >= 44px`, bad.length === 0, bad.join(' | '));
}

const browser = await chromium.launch();
const devices = [['mobile', { width: 390, height: 800 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1280, height: 800 }]];
let n = 0;
for (const [name, viewport] of devices) {
  const dest = `98${String(Date.now()).slice(-6)}${n++}1`.slice(0, 10);
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  // Expected non-2xx answers: the load-time session probe (401), the deliberately wrong link details (422), a service with no saved draft yet (404).
  // Anything else is reported. Browser 'Failed to load resource' console lines are covered by this response check.
  const expected = [[401, '/customer/profile'], [422, '/customer/profile/link'], [404, '/customer/drafts/']];
  page.on('response', (r) => { if (r.status() >= 400 && !expected.some(([c, u]) => r.status() === c && r.url().includes(u))) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
  await page.getByRole('heading', { name: /sign in or create/i }).waitFor();
  check(`${name}: sign-in says the code does not verify identity`, await page.getByText(/does not verify your identity/i).isVisible());
  await noOverflow(page, `${name} sign-in`); await axe(page, `${name} sign-in`); await smallTargets(page, `${name} sign-in`);
  await page.screenshot({ path: `${OUT}${name}-1-signin.png`, fullPage: true });

  let seen = otpCount(dest);
  await page.getByLabel(/mobile number/i).fill(dest);
  await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(dest, seen));
  await page.getByRole('button', { name: /continue/i }).click();

  await page.getByRole('heading', { name: /privacy choices/i }).waitFor();
  const boxes = page.getByRole('checkbox');
  await boxes.nth(1).waitFor();                // notices load after the heading renders
  check(`${name}: consent checkboxes start unticked`, (await boxes.count()) === 2 && !(await boxes.nth(0).isChecked()) && !(await boxes.nth(1).isChecked()));
  await page.getByRole('button', { name: /save my choices/i }).click();
  check(`${name}: cannot continue without required consent`, await page.getByText(/need to agree to the required notice/i).isVisible());
  await boxes.nth(0).check();   // required notice is listed first
  await noOverflow(page, `${name} consent`); await axe(page, `${name} consent`);
  await page.screenshot({ path: `${OUT}${name}-2-consent.png`, fullPage: true });
  await page.getByRole('button', { name: /save my choices/i }).click();

  await page.getByRole('heading', { name: /your profile/i }).waitFor();
  check(`${name}: home states identity is not verified`, await page.getByText(/identity has not been verified/i).isVisible());
  await noOverflow(page, `${name} home`); await axe(page, `${name} home`);
  await page.screenshot({ path: `${OUT}${name}-3-home.png`, fullPage: true });

  // Step-up + link (AT-VS-02)
  await page.getByRole('button', { name: /link my existing bank relationship/i }).click();
  seen = otpCount(dest);
  await page.getByRole('button', { name: /send code/i }).click();
  await page.getByLabel(/one-time code/i).fill(await otpFor(dest, seen));
  await page.getByRole('button', { name: /continue/i }).click();
  const account = `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;   // dev core stub accepts any 55xxxxxxxx; one profile per record
  await page.getByLabel(/account number/i).fill(account);
  await page.getByLabel(/date of birth/i).fill('1999-09-09');
  await page.getByRole('button', { name: /^link$/i }).click();
  await page.getByText(/could not verify these details/i).waitFor();
  check(`${name}: wrong details give the generic failure message`, true);
  await page.getByLabel(/date of birth/i).fill('1990-01-01');
  await page.getByRole('button', { name: /^link$/i }).click();
  await page.getByText(/your bank relationship is linked/i).waitFor();
  check(`${name}: linked after step-up and authoritative match`, true);

  // Catalogue and service facts (AT-VS-03)
  await page.getByRole('button', { name: /^services$/i }).click();
  await page.getByRole('heading', { name: /^services$/i }).waitFor();
  await noOverflow(page, `${name} catalogue`); await axe(page, `${name} catalogue`);
  await page.screenshot({ path: `${OUT}${name}-4-catalogue.png`, fullPage: true });
  await page.getByRole('button', { name: /personal loan enquiry/i }).click();
  await page.getByRole('heading', { name: /personal loan enquiry/i }).waitFor();
  check(`${name}: visit reason shown before starting`, await page.getByText(/original documents in a branch/i).isVisible());
  check(`${name}: "submitting is not an approval" shown`, await page.getByText(/not an approval/i).first().isVisible());
  check(`${name}: remote class shown`, await page.getByText(/a branch visit may be needed/i).first().isVisible());
  await noOverflow(page, `${name} service`); await axe(page, `${name} service`); await smallTargets(page, `${name} service`);
  await page.getByLabel(/note for this request/i).fill('Home renovation, 6 months');
  await page.getByRole('button', { name: /save and continue later/i }).click();
  await page.getByText(/saved\. you can continue later/i).waitFor();
  await page.screenshot({ path: `${OUT}${name}-5-service.png`, fullPage: true });

  // Resume from a different device (AT-VS-01): new browser context, sign in again with a fresh OTP
  const ctx2 = await browser.newContext({ viewport });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE);
  seen = otpCount(dest);
  await page2.getByLabel(/mobile number/i).fill(dest);
  await page2.getByRole('button', { name: /send code/i }).click();
  await page2.getByLabel(/one-time code/i).fill(await otpFor(dest, seen));
  await page2.getByRole('button', { name: /continue/i }).click();
  await page2.getByRole('heading', { name: /your profile/i }).waitFor();   // consent already recorded: goes straight to profile
  await page2.getByRole('button', { name: /^services$/i }).click();
  await page2.getByRole('button', { name: /personal loan enquiry/i }).click();
  await page2.getByRole('heading', { name: /personal loan enquiry/i }).waitFor();
  check(`${name}: draft restored on a second device after re-authentication`, (await page2.getByLabel(/note for this request/i).inputValue()) === 'Home renovation, 6 months');

  // Nepali
  await page2.getByRole('button', { name: 'नेपाली' }).click();
  await page2.getByRole('heading', { name: /व्यक्तिगत ऋण जिज्ञासा/ }).waitFor();
  check(`${name}: Nepali shown for UI and service content`, await page2.getByText(/स्वीकृति होइन/).first().isVisible());
  await axe(page2, `${name} service (ne)`);
  await page2.screenshot({ path: `${OUT}${name}-6-service-ne.png`, fullPage: true });
  await page2.getByRole('button', { name: /^sign out$|साइन आउट/i }).first().click();
  await page2.getByRole('heading', { name: /sign in or create|साइन इन/i }).waitFor();
  await page2.reload();
  await page2.getByRole('heading', { name: /sign in or create|साइन इन/i }).waitFor();
  check(`${name}: sign out ends the session (still signed out after reload)`, true);
  check(`${name}: no browser errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close(); await ctx2.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
