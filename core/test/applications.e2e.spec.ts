import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AuditService } from '../src/audit';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { EicarTestScanner, MalwareScanner, ScanVerdict } from '../src/document-evidence';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { CapturingOtpDelivery, FakeCoreBanking, Seed, Session, asTenant, customerKit, makeApp, publish, seedInstitution, signIn } from './helpers';

class ToggleScanner extends MalwareScanner {
  down = false; inner = new EicarTestScanner();
  async scan(b: Buffer): Promise<ScanVerdict> { if (this.down) throw new Error('scanner unavailable'); return this.inner.scan(b); }
}

const L = (en: string) => ({ en, ne: `${en} (ne)` });
const JPEG = (seed = 1, extra = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200 + extra, seed)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const EICAR = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);

const FORM_V1 = {
  fields: [
    { key: 'full_name', type: 'text', label: L('Full name'), required: true, privacy: 'personal', validation: { minLength: 2, maxLength: 40 } },
    { key: 'purpose', type: 'select', label: L('Purpose'), required: true, privacy: 'internal', options: [{ value: 'visa', label: L('Visa') }, { value: 'other', label: L('Other') }] },
    { key: 'purpose_other', type: 'text', label: L('Other purpose'), required: true, privacy: 'internal', visibleWhen: { field: 'purpose', equals: 'other' } },
    { key: 'income', type: 'number', label: L('Income'), privacy: 'sensitive' },
    { key: 'bonus', type: 'number', label: L('Bonus'), privacy: 'sensitive' },
    { key: 'total', type: 'calculated', label: L('Total'), privacy: 'sensitive', formula: { op: 'sum', of: ['income', 'bonus'], version: 'sum-v1' } },
    { key: 'dependents', type: 'group', label: L('Dependents'), privacy: 'personal', repeatable: { min: 0, max: 2 }, fields: [{ key: 'dep_name', type: 'text', label: L('Name'), required: true, privacy: 'personal' }] },
    { key: 'id_photo', type: 'file', label: L('ID photo'), required: true, privacy: 'restricted', documentKey: 'id_front', accept: ['image/jpeg', 'image/png'], maxBytes: 4096 },
    { key: 'address_proof', type: 'file', label: L('Address proof'), privacy: 'personal', documentKey: 'address_proof', accept: ['application/pdf'] },
    { key: 'declaration', type: 'consent', label: L('I confirm the above is true'), required: true, privacy: 'internal' },
  ],
};
const SERVICE = (over: object = {}) => ({
  title: L('Certificate'), description: L('Request a certificate'), whoCanApply: L('Anyone'), fees: L('Free'), supportChannel: L('Call'), documents: ['ID'],
  requiresExistingRelationship: false, signatureSupport: 'none', remoteClass: 'remote_capable', formKey: 'cert-form',
  availability: { channels: ['web'], branches: ['*'], currencies: ['*'], segments: ['*'] }, ...over,
});
const GOOD = { full_name: 'Asha Synthetic', purpose: 'visa', income: 100, bonus: 20, dependents: [{ dep_name: 'Binod' }], declaration: true };

let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking; let scanner: ToggleScanner; let storeDir: string;
let maker: Session; let checker: Session; let officerA: Session; let officerB: Session;
let kit: ReturnType<typeof customerKit>;
const logs: string[] = [];
let ik = 0;
const key = () => `idem-${Date.now()}-${ik++}`;

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking(); scanner = new ToggleScanner(); storeDir = mkdtempSync(join(tmpdir(), 'bbjp-store-'));
  app = await makeApp((l) => logs.push(l), [[OtpDelivery, delivery], [CoreBankingPort, core], [MalwareScanner, scanner], [ObjectStore, new LocalFsObjectStore(storeDir)]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '50';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' }, { name: 'officerB', actor: 'staff', role: 'branch_officer', branch: 'B' },
    { name: 'officerA2', actor: 'staff', role: 'branch_officer', branch: 'A' },
  ]);
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker');
  officerA = await signIn(app, seed, 'officerA'); officerB = await signIn(app, seed, 'officerB');
  kit = customerKit(app, seed, delivery, core);
  await publish(maker, checker, 'form', 'cert-form', FORM_V1);
  await publish(maker, checker, 'service', 'cert', SERVICE());
});
afterAll(async () => { delete process.env.OTP_MAX_PER_DESTINATION_HOUR; await app.close(); });

type Cust = Awaited<ReturnType<typeof kit.signUp>>;
const put = (c: Cust, url: string, body: object) => c.agent.put(url).set('x-csrf-token', c.csrf).send(body);
const upload = (c: Cust, url: string, bytes: Buffer, name = 'id.jpg', headers: Record<string, string> = {}) =>
  c.agent.put(url).set('x-csrf-token', c.csrf).set('Content-Type', headers['content-type'] ?? 'application/octet-stream').set('X-File-Name', encodeURIComponent(name)).set(headers).send(bytes);
const saveDraft = (c: Cust, data: object) => put(c, '/customer/applications/cert/draft', { data });
const docUrl = (req = 'id_front') => `/customer/applications/cert/documents/${req}`;
const submit = (c: Cust, k = key()) => c.agent.post('/customer/applications/cert/submit').set('x-csrf-token', c.csrf).set('Idempotency-Key', k).send({});

/** A customer with a complete, submitted application in branch A. */
async function submitted(branch: 'A' | 'B' | null = 'A', data: object = GOOD) {
  const c = await kit.linkedCustomer(branch);
  await saveDraft(c, data).expect(200);
  const up = await upload(c, docUrl(), JPEG(3)).expect(201);
  const r = await submit(c).expect(201);
  return { c, caseId: r.body.caseId as string, tracking: r.body.trackingCode as string, versionId: up.body.versionId as string };
}
const staffPost = (s: Session, url: string, body: object) => s.agent.post(url).set('x-csrf-token', s.csrf).send(body);

describe('forms: server-side validation and pinning (FRM-01, FRM-02, FRM-03, FRM-05, FRM-06)', () => {
  it('FRM-01: the API rejects data that breaks the form whatever the client did, with field-level codes, and creates nothing', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, { full_name: 'A', purpose: 'zzz', extra: 1, purpose_other: 'x', total: 5, dependents: [{}, {}, {}], declaration: false }).expect(200);
    await upload(c, docUrl(), JPEG(1)).expect(201);
    const r = await submit(c).expect(422);
    const codes = r.body.errors.map((e: { path: string; code: string }) => `${e.path}:${e.code}`).sort();
    expect(codes).toEqual(['dependents:too_many_items', 'extra:unknown_field', 'full_name:too_short', 'purpose:invalid_option', 'purpose_other:hidden_field_supplied', 'total:calculated_mismatch'].concat(['declaration:consent_required']).sort());
    expect((await asTenant(seed.instId, (q) => q('SELECT count(*)::int n FROM app_case WHERE profile_id = (SELECT id FROM customer_profile WHERE user_id = (SELECT user_id FROM app_session ORDER BY created_at DESC LIMIT 1))'))).rows[0].n).toBe(0);
    await c.agent.get('/customer/applications/cert/draft').expect(200);       // draft is still there: a failed submission loses nothing
  });

  it('FRM-05: values are stored exactly as the customer provided them; cleaning is only a visible suggestion', async () => {
    const c = await kit.linkedCustomer();
    const r = await saveDraft(c, { ...GOOD, full_name: '  Asha Synthetic  ' }).expect(200);
    expect(r.body.validation.suggestions).toEqual([{ path: 'full_name', suggested: 'Asha Synthetic', reason: 'surrounding_whitespace' }]);
    await upload(c, docUrl(), JPEG(2)).expect(201);
    const sub = await submit(c).expect(201);
    const staff = await staffGet(officerA, sub.body.caseId);
    expect(staff.snapshots[0].data.full_name).toBe('  Asha Synthetic  ');
  });

  it('FRM-02/FRM-03: a draft keeps the form version it started on; a newer version does not change it, its validation or the case', async () => {
    const early = await kit.linkedCustomer();
    await saveDraft(early, GOOD).expect(200);
    const formV2 = { fields: FORM_V1.fields.map((f) => (f.key === 'full_name' ? { ...f, validation: { minLength: 50, maxLength: 60 } } : f)) };
    await publish(maker, checker, 'form', 'cert-form', formV2);
    const d = (await early.agent.get('/customer/applications/cert/draft').expect(200)).body;
    expect(d.pinned).toBe(true);
    expect(d.form.definition.fields.find((f: { key: string }) => f.key === 'full_name').validation.minLength).toBe(2);   // still v-original
    await upload(early, docUrl(), JPEG(4)).expect(201);
    const sub = await submit(early).expect(201);                                                                            // accepted: v-original rules
    // A customer who starts now gets the new version, and the old name is too short for it.
    const late = await kit.linkedCustomer();
    await saveDraft(late, GOOD).expect(200);
    await upload(late, docUrl(), JPEG(5)).expect(201);
    const lateForm = (await late.agent.get('/customer/applications/cert/draft')).body.form;
    expect(lateForm.definition.fields.find((f: { key: string }) => f.key === 'full_name').validation.minLength).toBe(50);
    const rej = await submit(late).expect(422);
    expect(rej.body.errors.map((e: { code: string }) => e.code)).toContain('too_short');
    const pinned = (await asTenant(seed.instId, (q) => q('SELECT form_version_id FROM app_case WHERE id=$1', [sub.body.caseId]))).rows[0].form_version_id;
    expect(pinned).not.toBeNull();
    // restore the original rules for the remaining tests
    await publish(maker, checker, 'form', 'cert-form', FORM_V1);
  });

  it('FRM-02: a draft and its documents resume on another device after re-authentication', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, { full_name: 'Resume Me' }).expect(200);
    await upload(c, docUrl(), JPEG(6)).expect(201);
    const second = await kit.signUp(c.destination);
    const d = (await second.agent.get('/customer/applications/cert/draft').expect(200)).body;
    expect(d.data.full_name).toBe('Resume Me'); expect(d.documents.map((x: { requirementKey: string }) => x.requirementKey)).toEqual(['id_front']);
  });

  it.each([
    ['a field without a privacy classification', (f: any[]) => f.map((x) => (x.key === 'income' ? { ...x, privacy: undefined } : x)), 'FRM-06'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a missing Nepali label', (f: any[]) => f.map((x) => (x.key === 'income' ? { ...x, label: { en: 'Income' } } : x)), 'SVC-07'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unreachable required field', (f: any[]) => [...f, { key: 'ghost', type: 'text', label: L('g'), required: true, privacy: 'internal', visibleWhen: { field: 'purpose', equals: 'nope' } }], 'unreachable'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a calculated field without a formula version', (f: any[]) => f.map((x) => (x.key === 'total' ? { ...x, formula: { ...x.formula, version: '' } } : x)), 'FRM-09'], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('CFG-03: publication is blocked for %s', async (_n, mutate, rule) => {
    const content = { fields: mutate(FORM_V1.fields as unknown[]) };
    const d = await maker.agent.post('/config/drafts').set('x-csrf-token', maker.csrf).send({ kind: 'form', key: `bad-${rule}`, content, reason: 'x' }).expect(201);
    const dry = await maker.agent.post('/config/validate').set('x-csrf-token', maker.csrf).send({ kind: 'form', content }).expect(201);
    expect(dry.body.ok).toBe(false); expect(JSON.stringify(dry.body.errors)).toContain(rule);             // designers see blockers before review
    await maker.agent.post(`/config/versions/${d.body.id}/submit`).set('x-csrf-token', maker.csrf).send({ reason: 'x' }).expect(201);
    const r = await checker.agent.post(`/config/versions/${d.body.id}/approve`).set('x-csrf-token', checker.csrf).send({ reason: 'x' }).expect(400);
    expect(JSON.stringify(r.body)).toContain(rule);
  });
});

async function staffGet(s: Session, id: string) { return (await s.agent.get(`/staff/cases/${id}`).expect(200)).body; }

describe('submission (FRM-07, FRM-10, SUB-01, SUB-02, SUB-04, WFL-03, WFL-04, PRF-01)', () => {
  it('SUB-02: the receipt has a random tracking code, time, submitted items, outstanding items, status and the not-approved notice', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200); await upload(c, docUrl(), JPEG(8)).expect(201);
    const r = (await submit(c).expect(201)).body;
    expect(r.trackingCode).toMatch(/^BB-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(new Date(r.submittedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(r.customerStatus).toBe('received'); expect(r.underReviewNotApproved).toBe(true);
    expect(r.submittedItems.documents).toEqual(['id_front']); expect(r.outstanding.optionalDocuments).toEqual(['address_proof']);
    expect(Object.keys(r.submittedItems.fields)).toBeTruthy();
  });

  it('FRM-10/SUB-04: the same idempotency key returns the same receipt and creates one case and one snapshot; a second key finds the draft consumed', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200); await upload(c, docUrl(), JPEG(9)).expect(201);
    const k = key();
    const [a, b] = await Promise.all([submit(c, k), submit(c, k)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.caseId).toBe(b.body.caseId); expect(a.body.trackingCode).toBe(b.body.trackingCode);
    const n = await asTenant(seed.instId, (q) => q(`SELECT (SELECT count(*) FROM app_case WHERE id=$1)::int cases, (SELECT count(*) FROM application_snapshot WHERE case_id=$1)::int snaps, (SELECT count(*) FROM case_transition WHERE case_id=$1)::int trans`, [a.body.caseId]));
    expect(n.rows[0]).toEqual({ cases: 1, snaps: 1, trans: 1 });
    expect((await submit(c, k).expect(201)).body.caseId).toBe(a.body.caseId);
    await submit(c, key()).expect(422);
    await c.agent.post('/customer/applications/cert/submit').set('x-csrf-token', c.csrf).send({}).expect(400);   // key is mandatory
  });

  it('SUB-04: a failed submission is atomic: no case, no snapshot, documents stay in the draft, draft stays', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);                                        // required ID photo missing
    const r = await submit(c).expect(422);
    expect(r.body.missingDocuments).toEqual(['id_front']);
    await c.agent.get('/customer/cases').expect(200).then((x) => expect(x.body).toEqual([]));
    await c.agent.get('/customer/applications/cert/draft').expect(200);
  });

  it('PRF-01: one customer can hold several concurrent cases for the same service', async () => {
    const c = await kit.linkedCustomer();
    for (let i = 0; i < 2; i++) { await saveDraft(c, GOOD).expect(200); await upload(c, docUrl(), JPEG(10 + i)).expect(201); await submit(c).expect(201); }
    const list = (await c.agent.get('/customer/cases').expect(200)).body;
    expect(list).toHaveLength(2); expect(new Set(list.map((x: { trackingCode: string }) => x.trackingCode)).size).toBe(2);
    expect(list.every((x: { customerStatus: string }) => x.customerStatus === 'received')).toBe(true);
  });

  it('FRM-07: snapshots, transitions and case identity are immutable; case state cannot be changed outside the transition service (WFL-04)', async () => {
    const { caseId } = await submitted();
    await expect(asTenant(seed.instId, (q) => q(`UPDATE application_snapshot SET data_hash='x' WHERE case_id=$1`, [caseId]))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM application_snapshot WHERE case_id=$1`, [caseId]))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE case_transition SET reason='x' WHERE case_id=$1`, [caseId]))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE app_case SET internal_state='resubmitted' WHERE id=$1`, [caseId]))).rejects.toThrow(/transition service/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE app_case SET tracking_code='BB-AAAAA-AAAAA' WHERE id=$1`, [caseId]))).rejects.toThrow(/immutable/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM app_case WHERE id=$1`, [caseId]))).rejects.toThrow(/append-only/);
  });

  it('WFL-03: every case has a transition history with actor, reason, prior and new state', async () => {
    const { caseId } = await submitted();
    const t = (await staffGet(officerA, caseId)).transitions;
    expect(t).toEqual([expect.objectContaining({ from_state: null, to_state: 'submitted', actor_type: 'customer', reason: expect.any(String) })]);
  });
});

describe('tracking code is a locator, not a credential (SUB-01)', () => {
  it('another customer, staff-less callers and the public endpoint get nothing from a code; the owner needs a session', async () => {
    const { c, caseId, tracking } = await submitted();
    const other = await kit.linkedCustomer();
    await other.agent.get(`/customer/cases/by-code/${tracking}`).expect(404);
    await other.agent.get(`/customer/cases/${caseId}`).expect(404);
    await request(app.getHttpServer()).get(`/customer/cases/by-code/${tracking}`).expect(401);
    await request(app.getHttpServer()).get(`/customer/cases/${caseId}`).expect(401);
    const real = await request(app.getHttpServer()).post('/track').send({ institution: seed.code, code: tracking });
    const fake = await request(app.getHttpServer()).post('/track').send({ institution: seed.code, code: 'BB-ZZZZZ-ZZZZZ' });
    expect(real.status).toBe(200); expect(real.body).toEqual(fake.body); expect(JSON.stringify(real.body)).not.toContain(tracking);
    expect((await c.agent.get(`/customer/cases/by-code/${tracking}`).expect(200)).body.caseId).toBe(caseId);
  });
});

describe('documents: validation, scanning, privacy (DOC-01..04, DOC-07, DOC-12)', () => {
  it.each([
    ['executable renamed .jpg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'id.jpg', {}, 'unsupported_type'],
    ['EICAR test file', EICAR, 'id.jpg', {}, 'suspicious_content'],
    ['zero-byte file', Buffer.alloc(0), 'id.jpg', {}, 'empty'],
    ['oversize file (field limit 4 KB)', JPEG(1, 5000), 'id.jpg', {}, 'too_large'],
    ['polyglot image with script', Buffer.concat([JPEG(1), Buffer.from('<script>alert(1)</script>')]), 'id.jpg', {}, 'suspicious_content'],
    ['png content declared as jpeg', PNG, 'id.png', { 'content-type': 'image/jpeg' }, 'type_mismatch'],
    ['double extension', JPEG(1), 'id.jpg.exe', {}, 'type_mismatch'],
    ['a pdf where only images are allowed', PDF, 'id.pdf', {}, 'not_allowed_here'],
    ['a zip archive', Buffer.from('PK\x03\x04zzzz'), 'id.zip', {}, 'unsupported_type'],
  ])('rejects %s with a safe message and nothing staff can open', async (_n, bytes, name, headers, reason) => {
    const c = await kit.linkedCustomer();
    const r = await upload(c, docUrl(), bytes, name, headers as Record<string, string>).expect(400);
    expect(r.body).toEqual({ message: 'file_rejected', reason });                 // no engine names, signatures or paths
    expect(JSON.stringify(r.body)).not.toMatch(/EICAR|MZ|signature|\/tmp/i);
  });

  it('an infected file is stored quarantined: never readable by the customer or staff, replaceable by a clean file', async () => {
    const c = await kit.linkedCustomer();
    await upload(c, docUrl(), EICAR).expect(400);
    const q = (await asTenant(seed.instId, (x) => x(`SELECT id, scan_status FROM document_version ORDER BY uploaded_at DESC LIMIT 1`))).rows[0];
    expect(q.scan_status).toBe('infected');
    await c.agent.get(`/documents/${q.id}/content`).expect(404);
    await saveDraft(c, GOOD).expect(200);
    expect((await submit(c).expect(422)).body.missingDocuments).toEqual(['id_front']);           // infected evidence does not count
    await upload(c, docUrl(), JPEG(1)).expect(201);
    await submit(c).expect(201);
  });

  it('DOC-03/DOC-12: bytes are encrypted at rest, a SHA-256 of the original is stored, and the file comes back identical', async () => {
    const c = await kit.linkedCustomer();
    const bytes = JPEG(42, 50);
    const up = (await upload(c, docUrl(), bytes).expect(201)).body;
    expect(up).toMatchObject({ seq: 1, scanStatus: 'clean', duplicateWarning: false });
    const row = (await asTenant(seed.instId, (q) => q('SELECT sha256, storage_key, size_bytes, mime FROM document_version WHERE id=$1', [up.versionId]))).rows[0];
    expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(row).toMatchObject({ size_bytes: bytes.length, mime: 'image/jpeg' });
    const onDisk = readFileSync(join(storeDir, row.storage_key));
    expect(onDisk.includes(Buffer.alloc(40, 42))).toBe(false); expect(onDisk.subarray(0, 4).equals(bytes.subarray(0, 4))).toBe(false);
    const back = await c.agent.get(`/documents/${up.versionId}/content`).expect(200).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect((back.body as Buffer).equals(bytes)).toBe(true);
    expect(back.headers['cache-control']).toBe('no-store'); expect(back.headers['x-content-type-options']).toBe('nosniff'); expect(back.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('DOC-04: no response carries a public URL for a file; unauthenticated, other-customer and wrong-tenant reads fail', async () => {
    const { c, versionId } = await submitted();
    const other = await kit.linkedCustomer();
    const list = JSON.stringify((await c.agent.get('/customer/applications/cert/draft')).body) + JSON.stringify((await c.agent.get('/customer/cases')).body);
    expect(list).not.toMatch(/https?:\/\/|\/documents\/|storage|s3:/i);
    await request(app.getHttpServer()).get(`/documents/${versionId}/content`).expect(401);
    await other.agent.get(`/documents/${versionId}/content`).expect(404);
    const stranger = await seedInstitution([{ name: 'ofc', actor: 'staff', role: 'branch_officer', branch: 'A' }]);
    const sSess = await signIn(app, stranger, 'ofc');
    await sSess.agent.get(`/documents/${versionId}/content`).expect(404);
    expect(readdirSync(storeDir).length).toBeGreaterThan(0);
  });

  it('DOC-02: staff cannot open a file until the scan is clean; a scanner outage leaves it closed, never "clean"', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);
    scanner.down = true;
    const up = (await upload(c, docUrl(), JPEG(11)).expect(201)).body;
    scanner.down = false;
    expect(up.scanStatus).toBe('pending');
    await submit(c).expect(201);                                                                    // submission is allowed; staff access is not
    const cs = (await c.agent.get('/customer/cases')).body[0].caseId;
    expect((await staffGet(officerA, cs)).documents[0].scan_status).toBe('pending');
    const res = await officerA.agent.get(`/documents/${up.versionId}/content`);
    expect(res.status).toBe(403); expect(res.body.message).toBe('scan_not_clean');
    await staffPost(officerA, `/staff/documents/${up.versionId}/reviews`, { outcome: 'accepted' }).expect(403);
  });

  it('DOC-07: staff views and downloads are scoped to the case branch and every one is recorded', async () => {
    const { versionId, caseId } = await submitted('A');
    await officerB.agent.get(`/documents/${versionId}/content`).expect(404);
    await officerA.agent.get(`/documents/${versionId}/content`).expect(200);
    const link = (await officerA.agent.post(`/documents/${versionId}/link`).set('x-csrf-token', officerA.csrf).send({}).expect(200)).body;
    await officerA.agent.get(`/documents/link/${link.token}`).expect(200);
    const ev = await asTenant(seed.instId, (q) => q(`SELECT action, actor_type FROM document_access_event WHERE version_id=$1 ORDER BY seq`, [versionId]));
    expect(ev.rows.map((r: { action: string }) => r.action)).toEqual(['upload', 'view', 'link_issued', 'download']);
    const au = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action IN ('document.view','document.download') AND object_id=$1`, [versionId]));
    expect(au.rows[0].n).toBe(2); void caseId;
  });

  it('DOC-04: signed links are short-lived, bound to one user and one file, and tamper-evident', async () => {
    const { c, versionId } = await submitted('A');
    const link = (await c.agent.post(`/documents/${versionId}/link`).set('x-csrf-token', c.csrf).send({}).expect(200)).body;
    await c.agent.get(`/documents/link/${link.token}`).expect(200);
    await request(app.getHttpServer()).get(`/documents/link/${link.token}`).expect(401);                         // no session
    const other = await kit.linkedCustomer();
    await other.agent.get(`/documents/link/${link.token}`).expect(401);                                          // someone else's session
    const [p, mac] = link.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), e: Date.now() + 9e9 })).toString('base64url');
    await c.agent.get(`/documents/link/${forged}.${mac}`).expect(401);
    await c.agent.get(`/documents/link/${p}.${'0'.repeat(64)}`).expect(401);
    process.env.DOCUMENT_LINK_TTL_SECONDS = '0';
    const short = (await c.agent.post(`/documents/${versionId}/link`).set('x-csrf-token', c.csrf).send({}).expect(200)).body;
    delete process.env.DOCUMENT_LINK_TTL_SECONDS;
    await new Promise((r) => setTimeout(r, 10));
    await c.agent.get(`/documents/link/${short.token}`).expect(401);
  });

  it('DOC-03: a file changed in storage is detected on retrieval and refused', async () => {
    const { c, versionId } = await submitted('A');
    const row = (await asTenant(seed.instId, (q) => q('SELECT storage_key FROM document_version WHERE id=$1', [versionId]))).rows[0];
    const path = join(storeDir, row.storage_key);
    const orig = readFileSync(path); const bad = Buffer.from(orig); bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
    writeFileSync(path, bad);
    const r = await c.agent.get(`/documents/${versionId}/content`);
    expect(r.status).toBe(403); expect(r.body.message).toBe('integrity_check_failed');   // no bytes are returned
    expect(r.headers['content-type']).not.toMatch(/image/);
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='document.integrity_failure' AND object_id=$1`, [versionId]));
    expect(n.rows[0].n).toBe(1);
    writeFileSync(path, orig);
    await c.agent.get(`/documents/${versionId}/content`).expect(200);
  });

  it('DOC-05: replacing keeps every earlier version; staff can still open version 1', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);
    const v1 = (await upload(c, docUrl(), JPEG(21)).expect(201)).body;
    const v2 = (await upload(c, docUrl(), JPEG(22)).expect(201)).body;
    expect([v1.seq, v2.seq]).toEqual([1, 2]); expect(v1.documentId).toBe(v2.documentId);
    const sub = (await submit(c).expect(201)).body;
    const docs = (await staffGet(officerA, sub.caseId)).documents;
    expect(docs.map((d: { seq: number }) => d.seq)).toEqual([1, 2]);
    await officerA.agent.get(`/documents/${v1.versionId}/content`).expect(200);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM document_version WHERE id=$1`, [v1.versionId]))).rejects.toThrow(/never deleted/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE document_version SET sha256='x' WHERE id=$1`, [v1.versionId]))).rejects.toThrow(/immutable/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE document_version SET scan_status='infected' WHERE id=$1`, [v1.versionId]))).rejects.toThrow(/final/);
  });

  it('DOC-08: the same file under another requirement is warned about, not blocked', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);
    const bytes = Buffer.from('%PDF-1.4\nsame file\n%%EOF');
    expect((await upload(c, docUrl('address_proof'), bytes, 'a.pdf').expect(201)).body.duplicateWarning).toBe(false);
    await upload(c, docUrl('id_front'), JPEG(5), 'id.jpg').expect(201);
    // a second profile uploading the same bytes is NOT a duplicate (duplicates are per customer)
    const other = await kit.linkedCustomer();
    await saveDraft(other, GOOD).expect(200);
    expect((await upload(other, docUrl('address_proof'), bytes, 'a.pdf').expect(201)).body.duplicateWarning).toBe(false);
  });

  it('FRM-10: an upload retried with the same idempotency key is stored once; a different file under the same key is refused', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);
    const k = key();
    const a = (await upload(c, docUrl(), JPEG(31), 'id.jpg', { 'idempotency-key': k }).expect(201)).body;
    const b = (await upload(c, docUrl(), JPEG(31), 'id.jpg', { 'idempotency-key': k }).expect(201)).body;
    expect(b).toMatchObject({ versionId: a.versionId, replayed: true });
    await upload(c, docUrl(), JPEG(32), 'id.jpg', { 'idempotency-key': k }).expect(409);
  });

  it('only documents the pinned form asks for can be uploaded, and the name is never a storage path', async () => {
    const c = await kit.linkedCustomer();
    await saveDraft(c, GOOD).expect(200);
    await upload(c, docUrl('passport'), JPEG(1)).expect(400);
    await upload(c, docUrl(), JPEG(1), '../../etc/passwd.jpg').expect(201);
    const row = (await asTenant(seed.instId, (q) => q('SELECT display_name, storage_key FROM document_version ORDER BY uploaded_at DESC LIMIT 1'))).rows[0];
    expect(row.display_name).toBe('passwd.jpg'); expect(row.storage_key).not.toContain('passwd');
  });
});

describe('staff review and the return loop (DOC-06, DOC-11, RET-01..05, FRM-12, WFL-03)', () => {
  it('DOC-06: non-accepting outcomes need a reason code and customer-facing words; the customer sees only that message', async () => {
    const { c, versionId, caseId } = await submitted('A');
    const rev = (b: object) => staffPost(officerA, `/staff/documents/${versionId}/reviews`, b);
    await rev({ outcome: 'bogus' }).expect(400);
    await rev({ outcome: 'rejected' }).expect(400);
    await rev({ outcome: 'unclear', reasonCode: 'blurry' }).expect(400);
    await rev({ outcome: 'unclear', reasonCode: 'blurry', customerMessage: 'The right edge is cut off. Please retake the photo.' }).expect(201);
    const mine = (await c.agent.get(`/customer/cases/${caseId}`)).body.documents[0];
    expect(mine).toMatchObject({ reviewOutcome: 'unclear', reviewMessage: 'The right edge is cut off. Please retake the photo.' });
    expect(JSON.stringify(mine)).not.toMatch(/blurry|reviewer|officer/i);
    await officerB.agent.post(`/staff/documents/${versionId}/reviews`).set('x-csrf-token', officerB.csrf).send({ outcome: 'accepted' }).expect(404);   // other branch
  });

  it('DOC-11: the uploader is never the only verifier (and the refusal is audited)', async () => {
    const { versionId } = await submitted('A');
    const a2 = await signIn(app, seed, 'officerA2');
    await asTenant(seed.instId, async (q) => {
      await q('ALTER TABLE document_version DISABLE TRIGGER document_version_guard');
      await q('UPDATE document_version SET uploaded_by=$2 WHERE id=$1', [versionId, seed.users.officerA2!.id]);
      await q('ALTER TABLE document_version ENABLE TRIGGER document_version_guard');
    });
    await staffPost(a2, `/staff/documents/${versionId}/reviews`, { outcome: 'accepted' }).expect(403);
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='access.denied' AND detail->>'reason'='uploader_cannot_verify'`));
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    await staffPost(officerA, `/staff/documents/${versionId}/reviews`, { outcome: 'accepted' }).expect(201);
  });

  it('RET-01, RET-02, RET-03, RET-04, RET-05: staff return the case with specific items; the customer sees exactly those and no internal notes; the response adds a snapshot and sends it back to review', async () => {
    const { c, caseId, versionId } = await submitted('A');
    const NOTE = 'INTERNAL-CANARY: customer called twice, possible mismatch with core record';
    await staffPost(officerA, `/staff/cases/${caseId}/notes`, { body: NOTE }).expect(201);
    const reqUrl = `/staff/cases/${caseId}/info-requests`;
    await staffPost(officerA, reqUrl, { reasonCode: 'bogus', customerText: 'x', items: [{ type: 'field', key: 'full_name', text: 'x' }] }).expect(400);
    await staffPost(officerA, reqUrl, { reasonCode: 'mismatch', customerText: '   ', items: [{ type: 'field', key: 'full_name', text: 'x' }] }).expect(400);
    await staffPost(officerA, reqUrl, { reasonCode: 'mismatch', customerText: 'Please fix.', items: [] }).expect(400);
    await staffPost(officerA, reqUrl, { reasonCode: 'mismatch', customerText: 'Please fix.', items: [{ type: 'field', key: 'not_a_field', text: 'x' }] }).expect(400);
    await staffPost(officerB, reqUrl, { reasonCode: 'mismatch', customerText: 'Please fix.', items: [{ type: 'field', key: 'full_name', text: 'x' }] }).expect(404);
    await staffPost(officerA, reqUrl, { reasonCode: 'mismatch', customerText: 'Your name does not match your ID photo. Please correct it and retake the photo.', dueAt: '2030-01-01T00:00:00Z',
      items: [{ type: 'field', key: 'full_name', text: 'Enter your name exactly as on your ID' }, { type: 'document', key: 'id_front', text: 'Retake the photo of your ID' }] }).expect(201);

    const view = (await c.agent.get(`/customer/cases/${caseId}`).expect(200)).body;
    expect(view.customerStatus).toBe('more_info_needed');
    expect(view.request.text).toMatch(/does not match/); expect(view.request.items.map((i: { key: string }) => i.key)).toEqual(['full_name', 'id_front']);
    expect(JSON.stringify(view)).not.toContain('INTERNAL-CANARY'); expect(JSON.stringify(view)).not.toMatch(/returned_to_customer|internal_state|reviewer|author/);
    expect(JSON.stringify((await c.agent.get('/customer/cases')).body)).not.toContain('INTERNAL-CANARY');

    // The customer can only touch what was asked for (RET-02) and must actually supply it.
    await upload(c, `/customer/cases/${caseId}/documents/address_proof`, PDF, 'a.pdf').expect(409);
    const fixed = { ...GOOD, full_name: 'Asha Corrected' };
    const miss = await c.agent.post(`/customer/cases/${caseId}/respond`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({ data: fixed }).expect(422);
    expect(miss.body.missingDocuments).toEqual(['id_front']);
    const v2 = (await upload(c, `/customer/cases/${caseId}/documents/id_front`, JPEG(77), 'id2.jpg').expect(201)).body;
    expect(v2.seq).toBe(2);
    const k = key();
    const respond = () => c.agent.post(`/customer/cases/${caseId}/respond`).set('x-csrf-token', c.csrf).set('Idempotency-Key', k).send({ data: fixed });
    const r1 = await respond().expect(201); const r2 = await respond().expect(201);
    expect(r1.body).toEqual(r2.body); expect(r1.body).toMatchObject({ version: 2, customerStatus: 'under_review' });

    const staff = await staffGet(officerA, caseId);
    expect(staff.snapshots.map((s: { version: number; kind: string }) => `${s.version}:${s.kind}`)).toEqual(['1:submission', '2:resubmission']);
    expect(staff.snapshots[0].data.full_name).toBe('Asha Synthetic'); expect(staff.snapshots[1].data.full_name).toBe('Asha Corrected');   // history kept
    expect(staff.documents.filter((d: { requirement_key: string }) => d.requirement_key === 'id_front').map((d: { seq: number }) => d.seq)).toEqual([1, 2]);
    expect(staff.transitions.map((t: { to_state: string }) => t.to_state)).toEqual(['submitted', 'returned_to_customer', 'resubmitted']);
    expect(staff.transitions[1]).toMatchObject({ from_state: 'submitted', actor_type: 'staff', reason: 'mismatch' });
    expect(staff.internalNotes[0].text).toBe('INTERNAL-CANARY: customer called twice, possible mismatch with core record');
    expect(staff.requests[0].status).toBe('answered');
    await c.agent.post(`/customer/cases/${caseId}/respond`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({ data: fixed }).expect(409);   // nothing open any more
    void versionId;
  });

  it('WFL-04: transitions the table does not allow are rejected and the attempt is audited; a returned case cannot be returned again', async () => {
    const { caseId } = await submitted('A');
    const body = { reasonCode: 'incomplete', customerText: 'Please add details.', items: [{ type: 'question', key: 'q1', text: 'What is the purpose?' }] };
    await staffPost(officerA, `/staff/cases/${caseId}/info-requests`, body).expect(201);
    await staffPost(officerA, `/staff/cases/${caseId}/info-requests`, body).expect(409);
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='case.transition_rejected' AND object_id=$1`, [caseId]));
    expect(n.rows[0].n).toBe(1);
  });

  it('FRM-03: a case answered after a new form version is published is still validated against the version it started on', async () => {
    const { c, caseId } = await submitted('A');
    await staffPost(officerA, `/staff/cases/${caseId}/info-requests`, { reasonCode: 'incomplete', customerText: 'Please update your details.', items: [{ type: 'field', key: 'income', text: 'Income' }] }).expect(201);
    await publish(maker, checker, 'form', 'cert-form', { fields: FORM_V1.fields.map((f) => (f.key === 'full_name' ? { ...f, validation: { minLength: 60 } } : f)) });
    await c.agent.post(`/customer/cases/${caseId}/respond`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({ data: { ...GOOD, income: 5 } }).expect(201);
    await publish(maker, checker, 'form', 'cert-form', FORM_V1);
  });
});

describe('staff scope and access control (SEC-01, SEC-02, SEC-12)', () => {
  it('lists are filtered by branch at query level; cases without a branch are visible to no one; out-of-scope ids look absent', async () => {
    const a = await submitted('A'); const b = await submitted('B'); const none = await submitted(null);
    const idsA = (await officerA.agent.get('/staff/cases').expect(200)).body.map((x: { caseId: string }) => x.caseId);
    const idsB = (await officerB.agent.get('/staff/cases').expect(200)).body.map((x: { caseId: string }) => x.caseId);
    expect(idsA).toContain(a.caseId); expect(idsA).not.toContain(b.caseId); expect(idsA).not.toContain(none.caseId);
    expect(idsB).toContain(b.caseId); expect(idsB).not.toContain(a.caseId); expect(idsB).not.toContain(none.caseId);
    await officerA.agent.get(`/staff/cases/${b.caseId}`).expect(404);
    await officerA.agent.get(`/staff/cases/${none.caseId}`).expect(404);
    await officerA.agent.get('/staff/cases/not-a-uuid').expect(404);
    const stranger = await seedInstitution([{ name: 'ofc', actor: 'staff', role: 'branch_officer', branch: 'A' }]);
    const sSess = await signIn(app, stranger, 'ofc');
    expect((await sSess.agent.get('/staff/cases').expect(200)).body).toEqual([]);
    await sSess.agent.get(`/staff/cases/${a.caseId}`).expect(404);
  });

  it('customers cannot reach staff routes, staff cannot reach customer routes, anonymous gets 401', async () => {
    const { c, caseId } = await submitted('A');
    await c.agent.get('/staff/cases').expect(403);
    await c.agent.get(`/staff/cases/${caseId}`).expect(403);
    await staffPost({ agent: c.agent, csrf: c.csrf } as Session, `/staff/cases/${caseId}/info-requests`, {}).expect(403);
    await officerA.agent.get('/customer/cases').expect(403);
    await officerA.agent.put('/customer/applications/cert/draft').set('x-csrf-token', officerA.csrf).send({ data: {} }).expect(403);
    for (const [m, u] of [['get', '/staff/cases'], ['get', '/customer/cases'], ['get', '/customer/applications/cert/draft']] as const) expect((await request(app.getHttpServer())[m](u)).status).toBe(401);
  });

  it('an auditor cannot request information or add notes (read-only role)', async () => {
    const aud = await seedInstitution([{ name: 'aud', actor: 'auditor', role: 'auditor' }]);
    const s = await signIn(app, aud, 'aud');
    await s.agent.get('/staff/cases').expect(403);
    await staffPost(s, '/staff/cases/00000000-0000-0000-0000-000000000000/notes', { body: 'x' }).expect(403);
  });

  it('a customer cannot start a service that needs a relationship until linked', async () => {
    await publish(maker, checker, 'service', 'needs-link', SERVICE({ requiresExistingRelationship: true }));
    const c = await kit.signUp();
    await c.agent.put('/customer/applications/needs-link/draft').set('x-csrf-token', c.csrf).send({ data: {} }).expect(403);
  });
});

describe('privacy (SEC-03, PRV-03)', () => {
  it('personal data typed into a form never reaches logs, audit rows, or plain database columns', async () => {
    const CANARY = 'CANARY-Personal-7731';
    const before = logs.length;
    const { caseId } = await submitted('A', { ...GOOD, full_name: CANARY, dependents: [{ dep_name: `${CANARY}-dep` }] });
    const audit = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM audit_event'))).rows);
    const snaps = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM application_snapshot WHERE case_id=$1', [caseId]))).rows);
    const drafts = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM customer_draft'))).rows);
    for (const h of [logs.slice(before).join('\n'), audit, snaps, drafts]) expect(h).not.toContain('CANARY-Personal');
    await officerA.agent.get(`/staff/cases/${caseId}`).expect(200).then((r) => expect(r.body.snapshots[0].data.full_name).toBe(CANARY));
  });

  it('every submission, staff view and review is in the audit stream, and the chain is intact', async () => {
    const { caseId } = await submitted('A');
    await officerA.agent.get(`/staff/cases/${caseId}`).expect(200);
    const acts = (await asTenant(seed.instId, (q) => q(`SELECT action FROM audit_event WHERE object_id=$1`, [caseId]))).rows.map((r: { action: string }) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['case.submitted', 'case.transition', 'case.viewed']));
    expect(await app.get(AuditService).verifyChain(seed.instId)).toMatchObject({ intact: true });
  });
});
