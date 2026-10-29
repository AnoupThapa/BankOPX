/* eslint-disable no-console */
// LOCAL DEVELOPMENT ONLY. Boots the API with a fake OTP provider (codes are printed to this terminal) and a fake core-banking record,
// and seeds a synthetic "demo" institution (SEC-09). Refuses to run in production and listens on loopback only.
process.env.DATABASE_URL ??= 'postgres://bbjp_app:dev_app_pw@localhost:5432/bbjp_dev';
process.env.MIGRATION_DATABASE_URL ??= 'postgres://bbjp_owner:dev_owner_pw@localhost:5432/bbjp_dev';
process.env.FIELD_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.LOOKUP_HMAC_KEY ??= 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.OTP_RESEND_COOLDOWN_SECONDS ??= '0';
process.env.OTP_MAX_PER_IP_HOUR ??= '1000';
process.env.OTP_MAX_PER_DESTINATION_HOUR ??= '1000';
if (process.env.NODE_ENV === 'production') throw new Error('dev-server must never run in production');

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { migrate } from '../src/platform/migrate';
import { AppLogger } from '../src/platform';
import { EicarTestScanner, MalwareScanner } from '../src/document-evidence';
import { REFERENCE_WORKFLOW } from '../src/workflow';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CapturingOtpDelivery, FakeCoreBanking, PASSWORD, publish, seedInstitution, signIn, owner } from '../test/helpers';

const loc = (en: string, ne: string) => ({ en, ne });

async function main() {
  await migrate(process.env.MIGRATION_DATABASE_URL!, 'up');
  const delivery = new (class extends CapturingOtpDelivery {
    async send(i: string, c: 'email' | 'mobile', d: string, code: string) { await super.send(i, c, d, code); process.stdout.write(`[dev-otp] ${d} ${code}\n`); }
  })();
  const core = new (class extends FakeCoreBanking {
    // Dev convenience: any 10-digit account starting 55 with date of birth 1990-01-01 matches a synthetic record (one profile per record, as in production).
    async matchCustomer(i: string, account: string, v: Record<string, string>) {
      if (/^55\d{8}$/.test(account) && v.dob === '1990-01-01') return { coreCustomerRef: `CORE-${account}`, homeBranchCode: 'A' };
      return super.matchCustomer(i, account, v);
    }
  })();
  // Several demo records so repeated walkthroughs can each link a different profile (a core record can link to one profile only).
  for (let i = 0; i < 10; i++) core.records.set(`123456789${i}`, { ref: `CORE-DEMO-${i}`, branch: 'A', verify: { dob: '1990-01-01' }, accounts: [{ maskedAccount: `****789${i}`, type: 'savings' }] });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(OtpDelivery).useValue(delivery).overrideProvider(CoreBankingPort).useValue(core)
    // Local files and a test-string scanner: development only, so uploads can be tried without a bank storage or scanner product [BANK-DECIDES].
    .overrideProvider(ObjectStore).useValue(new LocalFsObjectStore(process.env.DEV_STORE_DIR ?? mkdtempSync(join(tmpdir(), 'bbjp-dev-store-'))))
    .overrideProvider(MalwareScanner).useValue(new EicarTestScanner()).compile();
  const app = mod.createNestApplication();
  configureApp(app, new AppLogger(() => undefined));
  await app.init();

  const exists = (await owner.query(`SELECT 1 FROM institution WHERE code='demo'`)).rowCount;
  if (!exists) {
    const seed = await seedInstitution([
      { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
      { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
      { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' }, { name: 'officerA2', actor: 'staff', role: 'branch_officer', branch: 'A' },
      { name: 'compliance', actor: 'staff', role: 'compliance_officer', branch: 'A' }, { name: 'lead', actor: 'staff', role: 'team_lead', branch: 'A' },
      { name: 'approverSmall', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 50000 }, { name: 'approverBig', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 10_000_000 },
      { name: 'sched', actor: 'integration', role: 'integration_service' },
    ], 'demo');
    // Synthetic staff logins for local walkthroughs and the browser test. Written to a file the developer controls; never used outside development.
    writeFileSync(process.env.DEV_SECRETS_FILE ?? join(tmpdir(), 'bbjp-dev-secrets.json'), JSON.stringify({ password: PASSWORD, institution: 'demo', totp: Object.fromEntries(Object.entries(seed.users).map(([k, u]) => [k, u.secret])) }));
    const maker = await signIn(app, seed, 'maker'); const checker = await signIn(app, seed, 'checker');
    await publish(maker, checker, 'consent_notice', 'processing', { type: 'required', purpose: 'processing', body: loc('We use your contact details to create your profile and process your requests. We do not use them for marketing unless you say so.', 'हामी तपाईंको सम्पर्क विवरण प्रोफाइल बनाउन र अनुरोध प्रशोधन गर्न प्रयोग गर्छौं। तपाईंले भनेमा बाहेक मार्केटिङमा प्रयोग गर्दैनौं।') });
    await publish(maker, checker, 'consent_notice', 'marketing', { type: 'marketing', purpose: 'marketing', body: loc('Send me offers and news.', 'मलाई अफर र समाचार पठाउनुहोस्।') });
    const base = { documents: ['Citizenship certificate'], signatureSupport: 'none', indicativeTat: '2 working days', availability: { channels: ['web'], branches: ['*'], currencies: ['NPR'], segments: ['*'] } };
    const L = (en: string, ne: string) => ({ en, ne });
    await publish(maker, checker, 'form', 'loan-enquiry-form', { fields: [
      { key: 'purpose', type: 'select', label: L('What is the loan for?', 'ऋण किन चाहिएको हो?'), required: true, privacy: 'internal', options: [{ value: 'home', label: L('Home', 'घर') }, { value: 'education', label: L('Education', 'शिक्षा') }, { value: 'other', label: L('Something else', 'अन्य') }] },
      { key: 'purpose_other', type: 'text', label: L('Please describe', 'कृपया वर्णन गर्नुहोस्'), required: true, privacy: 'internal', visibleWhen: { field: 'purpose', equals: 'other' } },
      { key: 'amount', type: 'currency', label: L('Amount you would like to borrow (NPR)', 'लिन चाहेको रकम (रु.)'), required: true, privacy: 'sensitive', validation: { min: 1 } },
      { key: 'income', type: 'currency', label: L('Monthly income (NPR)', 'मासिक आम्दानी (रु.)'), privacy: 'sensitive' },
      { key: 'income_proof', type: 'file', label: L('Proof of income (PDF or photo)', 'आम्दानीको प्रमाण (PDF वा फोटो)'), privacy: 'sensitive', documentKey: 'income_proof', accept: ['application/pdf', 'image/jpeg', 'image/png'] },
      { key: 'declaration', type: 'consent', label: L('I confirm these answers are true.', 'मेरा उत्तर सही छन् भनी पुष्टि गर्छु।'), required: true, privacy: 'internal' },
    ] });
    await publish(maker, checker, 'workflow', 'loan-flow', REFERENCE_WORKFLOW());
    await publish(maker, checker, 'service', 'address-change', { ...base, formKey: 'address-change-form', requiresExistingRelationship: false, remoteClass: 'remote_capable', documents: ['A photo of your ID'],
      title: loc('Change of address', 'ठेगाना परिवर्तन'), description: loc('Tell us your new address.', 'आफ्नो नयाँ ठेगाना जनाउनुहोस्।'),
      whoCanApply: loc('Account holders.', 'खातावाला।'), fees: loc('No fee (demo)', 'शुल्क छैन (डेमो)'), supportChannel: loc('Call 1660-00-00000 (demo)', 'फोन 1660-00-00000 (डेमो)') });
    await publish(maker, checker, 'service', 'account-certificate', { ...base, requiresExistingRelationship: false, remoteClass: 'remote_capable',
      title: loc('Account certificate', 'खाता प्रमाणपत्र'), description: loc('Request a certificate confirming your account.', 'आफ्नो खाता पुष्टि गर्ने प्रमाणपत्र अनुरोध गर्नुहोस्।'),
      whoCanApply: loc('Anyone who holds an account with the bank.', 'बैंकमा खाता भएका जो कोही।'), fees: loc('No fee (demo)', 'शुल्क छैन (डेमो)'), supportChannel: loc('Call 1660-00-00000 (demo)', 'फोन 1660-00-00000 (डेमो)') });
    await publish(maker, checker, 'service', 'personal-loan-enquiry', { ...base, formKey: 'loan-enquiry-form', workflowKey: 'loan-flow', requiresExistingRelationship: true, remoteClass: 'remote_first_conditional',
      title: loc('Personal loan enquiry', 'व्यक्तिगत ऋण जिज्ञासा'), description: loc('Start a loan enquiry. A person reviews it; submitting is not an approval.', 'ऋण जिज्ञासा सुरु गर्नुहोस्। व्यक्तिले समीक्षा गर्छन्।'),
      whoCanApply: loc('Existing customers with a linked relationship.', 'जोडिएको सम्बन्ध भएका वर्तमान ग्राहक।'), fees: loc('Fees shown at offer stage (demo)', 'प्रस्ताव चरणमा शुल्क देखाइन्छ (डेमो)'),
      supportChannel: loc('Visit any branch (demo)', 'कुनै पनि शाखामा जानुहोस् (डेमो)'),
      visitReason: loc('The bank may ask to see original documents in a branch before a decision.', 'निर्णय अघि बैंकले शाखामा मूल कागजात हेर्न माग्न सक्छ।') });
    process.stdout.write('[dev] seeded demo institution\n');
  }
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, '127.0.0.1');
  process.stdout.write(`[dev] API on http://127.0.0.1:${port} (dev OTP provider; codes print here)\n`);
}
void main();
