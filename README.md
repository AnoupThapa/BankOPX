# Branchless Banking Journey Platform (BBJP) — Build Documentation Set

**Status:** Working draft · derived from *Branchless Banking Journey Platform — Full Project Report, Product Blueprint and Phased Delivery Plan, v1.0 (29 Oct 2026)*
**Initial market:** Nepalese commercial banks and other NRB-licensed institutions, with a configurable core that avoids Nepal-only assumptions.

> **Important.** This is a product and engineering planning set. It is **not** a legal opinion, credit policy, security certification, or confirmation that any service can be completed remotely. Every bank must approve its own policy, legal interpretation, integration scope and operating model before launch.

---

## 1. What BBJP is

A configurable **Banking Service Journey and Workflow Orchestration Platform**. It lets a bank's customers start, complete and track banking services from a phone, tablet or desktop, and lets bank teams process those requests through controlled workflows, with full audit and turnaround-time (TAT) visibility.

It sits **across** the bank's existing systems (CBS, LMS, DMS, card, trade, payment, AML). It orchestrates the journey, data collection, evidence, approvals, notifications and status. Existing systems remain the authoritative systems for what they own.

Three connected experiences:

| Experience | Core capabilities |
|---|---|
| **Customer** | One secure profile, service catalogue, dynamic mobile-first forms, camera capture and upload, consent, tracking, return-for-correction loop, digital signature where approved, appointment booking only when a visit is genuinely required |
| **Bank operations** | Role-based work queues, case and document review, checklists, risk/compliance/legal referrals, approval chains, customer messaging, exceptions, SLA monitoring, audit trail |
| **Administration & management** | No-code service/form/workflow builders with maker-checker, roles and delegation, integration monitoring, pending-document and TAT analytics, executive dashboards |

## 2. What BBJP is not

Not a core banking system, loan system, DMS, general CRM, autonomous credit-decision engine, identity provider, digital-signature authority, ledger, or a regulatory-compliance guarantee. See `docs/00-product-vision-and-scope.md`.

## 3. Document map

| # | File | Purpose |
|---|---|---|
| — | `CLAUDE.md` | Operating instructions for AI coding agents (and a good onboarding page for humans) |
| 00 | `docs/00-product-vision-and-scope.md` | Vision, goals, principles, positioning, personas, service scope, non-goals |
| 01 | `docs/01-architecture.md` | Logical architecture, modules, system-of-record, deployment, cross-cutting design |
| 02 | `docs/02-data-model.md` | Entities, relationships, conventions, immutability, data classification |
| 03 | `docs/03-business-rules.md` | **Numbered rule catalogue** (the contract that code and tests trace to) |
| 04 | `docs/04-workflow-and-state-machines.md` | Case lifecycle, status mapping, document/request/integration state machines |
| 05 | `docs/05-security-and-compliance.md` | Authn/authz, data security, appsec, fraud, privacy, Nepal legal checklist |
| 06 | `docs/06-api-and-events.md` | API conventions, endpoint catalogue, event catalogue, webhooks |
| 07 | `docs/07-tat-and-analytics.md` | TAT event model, measures, attribution, dashboards, metric dictionary |
| 08 | `docs/08-admin-and-config-governance.md` | Service/form/workflow builders, maker-checker, versioning, rollback |
| 09 | `docs/09-integration-guide.md` | Connector framework, hand-off pattern, idempotency, reconciliation |
| 10 | `docs/10-credit-and-product-modules.md` | Credit workspace, scorecards, product checklists, margin, trade finance |
| 11 | `docs/11-ai-governance.md` | Permitted AI uses, controls, prohibitions, evaluation |
| 12 | `docs/12-ui-ux-and-design-system.md` | Mobile-first, accessibility, copy rules, staff and dashboard UX |
| 13 | `docs/13-non-functional-and-operations.md` | NFRs, environments, observability, DR, incident response, exit plan |
| 14 | `docs/14-test-strategy.md` | Test layers, mandatory test packs, CI gates |
| 15 | `docs/15-acceptance-tests.md` | Gherkin acceptance tests for the first vertical slice and phase gates |
| 16 | `docs/16-architecture-decision-records.md` | ADRs: what is decided, what is proposed |
| 17 | `docs/17-dos-and-donts.md` | Practical do/don't checklist for the whole team |
| 18 | `docs/18-roadmap-and-phase-gates.md` | Phases 0–10 with objectives, deliverables, tests, exit gates |
| 19 | `docs/19-risks-and-open-questions.md` | Risk register, open questions, assumptions log |
| 20 | `docs/20-pilot-kpis-and-business-case.md` | KPIs, business-case formula, commercial models |
| 21 | `docs/21-definition-of-done-and-release-rules.md` | PR/phase definition of done, release rules, sign-offs |
| 22 | `docs/22-glossary.md` | Terms and abbreviations |

### Suggested reading order

| Role | Read first |
|---|---|
| Product owner / BA | 00 → 03 → 04 → 08 → 15 → 18 → 19 |
| Tech lead / architect | 01 → 02 → 16 → 06 → 09 → 13 → 05 |
| Backend / workflow engineer | 03 → 02 → 04 → 06 → 07 → 09 |
| Frontend / UX | 12 → 03 (FRM, DOC, STS, VIS) → 04 → 06 |
| Security / DevSecOps | 05 → 13 → 14 → 17 |
| QA | 14 → 15 → 03 |
| Bank stakeholders | 00 → 18 → 19 → 20 → 21 |
| AI coding agent | `CLAUDE.md` → 03 → 16 → the doc for the module being touched |

## 4. Conventions used in every document

- **MUST / MUST NOT / SHOULD / MAY** carry their RFC 2119 meaning.
- **Rule IDs** (e.g. `DOC-04`, `WFL-03`) live in `docs/03-business-rules.md`. Code comments, tests and PRs reference them. A rule that has no test is not done.
- **`[PROPOSED]`** marks a recommendation added by this documentation set that is *not* stated in the source report. Treat as a default that can be changed through an ADR.
- **`[BANK-DECIDES]`** marks a choice that must be confirmed by the design-partner bank (policy, legal, hosting, provider). Never hard-code these.
- **`[SOURCE: §n]`** points to the section of the original project report.

## 5. First vertical slice (build this first)

Do **not** start by building every service or every integration. Build one service journey, reliably and end-to-end, including failure cases and hand-off to the bank's authoritative system:

1. Contact verification (OTP) → profile → resume later
2. Existing-customer linking through an approved flow
3. Service catalogue → dynamic form → camera/upload → submit → tracking code
4. Staff queue → document review → request-more-information → customer correction → decision (approve / decline / return / escalate)
5. Stage-level TAT events, customer-wait vs bank-wait separation
6. Integration hand-off with idempotency and authoritative confirmation
7. Admin form + workflow publish through maker-checker

Acceptance criteria: `docs/15-acceptance-tests.md` (AT-VS-* scenarios).

**Go/no-go rule:** do not commit to a full build until at least one bank validates the workflow gap, names a sponsor, identifies an integration path, approves a pilot scope and agrees measurable success criteria. [SOURCE: §26]

## 6. Proposed repository layout `[PROPOSED]`

```
bbjp/
├── README.md
├── CLAUDE.md
├── docs/                      # this documentation set
├── adr/                       # new ADRs added after docs/16
├── apps/
│   ├── customer-portal/       # responsive web, deep-link/embeddable
│   ├── staff-portal/          # queues, case workspace
│   └── admin-portal/          # builders, governance, dashboards
├── core/                      # modular monolith (see docs/01)
│   └── modules/               # identity, profile, catalogue, forms, case, workflow, ...
├── packages/                  # shared: api-contracts, form-schema, workflow-schema, ui
├── connectors/                # one adapter per external system, contract-tested
├── infra/                     # IaC, pipelines, environment definitions
└── tests/                     # acceptance, security, contract, performance
```

## 7. Team minimum for a regulated pilot

Product owner with banking-operations knowledge · banking BA/process designer · technical lead/architect · frontend engineer · backend/workflow engineer · integration engineer · QA automation engineer · UI/UX designer · DevSecOps/security engineer · bank implementation lead · bank-supplied legal/compliance advisers. A demo that works is **not** production-grade bank security.

## 8. Developing locally (Phase 1 foundation)

```bash
npm install
sudo service postgresql start && PSQL="sudo -u postgres psql" infra/dev-db.sh
npm run ci            # lint, typecheck, tests, traceability
npm run dev -w @bbjp/design-gallery   # UI component gallery
```

Phase reports and evidence live in `docs/phase-1/`. New ADRs go in `adr/`.
