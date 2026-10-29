# 00 — Product Vision and Scope

[SOURCE: §1–§3]

## 1. Vision

A customer can begin a banking request from anywhere, complete every *permitted* step on their own device, receive clear updates, correct missing information remotely, and attend a branch **only** when a defined requirement makes it necessary. Bank staff keep full control over risk, compliance, legal review and final decisions. Executives get a trustworthy view of service quality, workload, risk and turnaround time.

**Central proposition:** one configurable customer-journey layer for many banking services — not a separate app per product, and not merely a collection of digital forms.

## 2. Strategic goals

1. Make routine banking requests digital-first and mobile-first.
2. Reuse verified customer profile data and documents where permitted, keeping them current and purpose-appropriate.
3. Reduce branch visits, incomplete applications, repeated data entry, manual follow-up and avoidable TAT.
4. Route cases to the right staff and approval authority by service, customer type, amount, risk, branch, portfolio and bank policy.
5. Make the journey transparent without exposing internal deliberations, confidential risk indicators or fraud controls.
6. Give managers reliable data on volume, pending documents, ageing, SLA breaches, TAT and bottlenecks.
7. Keep all final credit, compliance, legal and service decisions with authorised human officers.
8. Be integration-first so it coexists with incumbent systems.
9. Build for Nepal first without Nepal-only assumptions in the core design.

## 3. Product principles

1. **Mobile-first, responsive by design** — same journey on phone, tablet, desktop; embeddable in bank apps via secure deep link or approved web view.
2. **Do not ask twice** — reuse verified data when permitted and valid; show source and date; ask to confirm or update.
3. **One identity, many cases** — a profile is distinct from an application; a customer can have concurrent cases.
4. **No false promise of fully remote service** — tell the customer early: remote, remote-with-conditional-visit, or attendance-required.
5. **No ungoverned shortcuts** — admins configure within guardrails; they cannot remove mandatory legal controls or bypass approval authority.
6. **Human accountability** — system may prepare, calculate, flag, recommend; people own material decisions.
7. **Traceable evidence** — every critical decision traces to source documents, data, checklist results, policy version and approving officer.
8. **Integrate rather than replace.**
9. **Secure by default** — least privilege, strong auth, encryption, tenant isolation, audit, controlled exports, secure documents.
10. **Measure outcomes** — fewer avoidable visits, less rework, less elapsed time; not number of screens or AI features.

## 4. What BBJP is / is not

**Is:** service catalogue + portal · reusable profile with verification status · dynamic no-code forms · document rules and collection · workflow and approval orchestration · customer/staff messaging · SLA/TAT engine · credit proposal checklist and configurable risk-assessment support · integration gateway and connectors · ops/department/executive dashboards · audit, consent, access and configuration governance.

**Is not:** a core banking system · a replacement LMS or DMS · a general CRM · an autonomous credit-decision engine · a digital-signature authority or identity provider · a guarantee that every product completes without a visit · a regulatory-compliance guarantee · a generic form builder without bank-grade workflow, audit and integration.

## 5. Positioning versus incumbent systems

| Incumbent capability | BBJP additional value |
|---|---|
| CBS: accounts, balances, core transactions | Orchestrates the journey, routes requests to authorised systems |
| LMS: loan application/servicing | Configurable multi-department journey across credit, legal, compliance, operations and external checks |
| DMS: stores documents | Captures documents in context, checks completeness, requests corrections, links evidence to case and decision |
| Mobile banking: supported transactions | Reusable service-application layer for complex requests not built into the app |
| Existing forms | Dynamic forms + document rules + workflow + return loops + audit + TAT + reporting |
| BI dashboard | Connects case events to accountable work, stage-level time and blockers |
| Phone/email follow-up | Case-linked, controlled communication with full history |
| Per-product processes | Common platform and design standards, bank-configurable journeys |

**Product-market-fit test (non-negotiable):** if the bank's current vendor can provide the same end-to-end capability cheaper and fast enough, do not compete on a thin feature. Focus on cross-system orchestration, reusable no-code service configuration, independent workflow visibility, deployment flexibility, measurable TAT reduction and coexistence.

## 6. Actors and personas

**Customer-side:** individual · sole proprietor · company representative · joint applicant · guarantor · director · beneficial owner · authorised signatory.

**Bank-side (configurable roles):** service desk officer · branch operations officer · account-opening/KYC officer · relationship manager · credit analyst/officer · credit administration · collateral/valuation reviewer · trade finance officer · treasury reviewer · compliance/AML reviewer · legal reviewer · risk officer · finance/fee reviewer · branch manager · credit approver (delegated authority) · department head · internal audit (read-only, scoped) · senior management viewer.

**Platform admin:** system administrator · service/form designer · workflow administrator · integration operations admin · security administrator.

## 7. Service scope (activate only when licence, policy, legal position and integrations support it)

| Domain | Examples | Hard limit |
|---|---|---|
| Onboarding & profile | Profile creation, OTP, existing-customer linking, KYC capture, selfie/liveness via approved provider, consent, profile updates, multi-role relationships, recovery | Profile does not grant account access by itself |
| Deposit & account services | Account application, term deposit request, statements/certificates, cheque/card requests, standing instructions, closure, dormant reactivation, complaints, appointments | Platform never moves funds or books a deposit; a submitted request ≠ completed transaction |
| Lending | Personal, home, vehicle, hire-purchase, SME/business, working capital, renewals, enhancements, restructuring, margin lending, credit cards, guarantors, collateral substitution, deviations, rectification | Bank defines its own proposal taxonomy; no autonomous decisions |
| Trade finance | LC, guarantees, import/export finance, documentary collection, discrepancy loop | Do not assume scans replace originals |
| Securities-backed lending | Eligible-securities declaration, valuation, haircuts, margin calls, pledge workflow via connected systems | Platform never places/releases pledge, trades or liquidates |
| Other | Remittance requests, FX, lockers, reference letters, disputes/chargebacks, payment investigation, mandate changes, callbacks, services built by admins | — |

Catalogue entries are configurable by institution, customer segment, channel, branch, currency and jurisdiction. `[SOURCE: §3]`

## 8. Non-goals (explicit)

- Replacing CBS/LMS/DMS/card/trade/payment/AML/GL.
- Building in-house face matching or liveness without documented lawful basis, tested accuracy, security review and bank approval.
- AI-only credit approval/decline, AML clearance, legal clearance, signature validation or collateral action.
- A single universal risk score across retail, SME, vehicle and margin exposures.
- Shared multi-tenant SaaS as the default for sensitive bank data.
- Building every service and every integration at once.

## 9. Scope boundaries for the first pilot `[BANK-DECIDES]`

Pick a bounded, low-complexity service based on the partner bank's biggest pain and available integration — e.g. account/service certificate request, KYC update, cheque book/card service request, a deposit-related request, or a bounded personal-loan enquiry intake **without** automated approval. `[SOURCE: Phase 5]`
