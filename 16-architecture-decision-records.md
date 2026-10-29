# 16 — Architecture Decision Records (ADRs)

Status key: **Accepted (source)** = directly stated by the project report; **Proposed** = recommendation from this documentation set, to be confirmed by the tech lead and design-partner bank; **Bank-decides** = must be settled with the bank.

New ADRs go in `adr/NNN-title.md` using the template at the end. Never edit an accepted ADR in place; supersede it.

---

## ADR-001 — Integrate with, don't replace, the bank's core systems
**Status:** Accepted (source §1, §2.2, §1.2-8)
**Context:** Banks already run CBS, LMS, DMS, card, trade, payment and AML systems. Competing with them is costly and risky.
**Decision:** BBJP orchestrates journeys, evidence, approvals and status. Existing systems remain authoritative for what they own.
**Consequences:** Heavy investment in connectors, idempotency, reconciliation; no ledger/servicing features; commercial focus on cross-system orchestration.
**Alternatives rejected:** Building a new LMS/DMS/CBS module.

## ADR-002 — Modular monolith for the initial product
**Status:** Accepted (source §22.1)
**Context:** Small team, regulated pilot, need for speed and transactional integrity.
**Decision:** One deployable with enforced module boundaries and event contracts; split only on evidence.
**Consequences:** Simpler ops and transactions; need architecture tests to prevent boundary erosion.
**Alternatives rejected:** Microservices up front.

## ADR-003 — Dedicated single-bank deployment as the default
**Status:** Accepted (source §15.4); hosting model **Bank-decides**
**Decision:** Support dedicated single-bank deployments first; multi-tenant SaaS only after isolation, residency and regulatory assessment. Keep `institution_id` on all tables.
**Consequences:** Higher per-bank ops cost; easier regulatory acceptance; model remains multi-tenant-ready.

## ADR-004 — Canonical append-only event history drives TAT and audit
**Status:** Accepted (source §9)
**Decision:** `tat_event` and `audit_event` are append-only; derived facts are rebuildable; no TAT from mutable "last updated".
**Consequences:** Storage growth; need partitioning and archiving; reliable metrics.

## ADR-005 — Versioned, immutable configuration with maker-checker
**Status:** Accepted (source §11.2, §11.4)
**Decision:** Services, forms, workflows, scorecards, checklists and status mappings are versioned; published versions are immutable; cases pin versions; production changes need maker-checker and regression packs.
**Consequences:** Migration policy needed for mid-flight changes; slightly slower admin changes; strong audit.

## ADR-006 — Human accountability for material decisions
**Status:** Accepted (source §1.2-6, §7.5, §14.2)
**Decision:** System and AI may prepare, calculate, flag and recommend; authorised humans decide. No autonomous approval/decline/disbursement/collateral action.
**Consequences:** No auto-decision features; UI centred on decision support; strong decision records.

## ADR-007 — Fulfilment requires authoritative-system confirmation
**Status:** Accepted (source §15.3)
**Decision:** A case is *Fulfilled* only when the authoritative system returns confirmation with an external reference. Ambiguous outcomes are reconciled before retry.
**Consequences:** Additional states (ambiguous, failed), reconciliation jobs, ops tooling.

## ADR-008 — Tracking code is a locator, not a credential
**Status:** Accepted (source §4.7)
**Decision:** Random, non-informative code; unauthenticated lookup returns minimal data; access requires authentication.
**Consequences:** Customers must sign in to see detail; avoids guessable-link leaks.

## ADR-009 — Private object storage, scanning, hashing, short-lived access
**Status:** Accepted (source §4.5, §12.3)
**Decision:** No public object URLs; malware scan before staff access; SHA-256 + immutable versions; signed short-lived access or authenticated streaming; encryption in transit and at rest.
**Consequences:** Preview conversion pipeline; scan latency UX; stronger evidence integrity.

## ADR-010 — Use approved external providers for signature, liveness, OTP, screening
**Status:** Accepted (source §4.5, §4.6, §22.1)
**Decision:** No in-house crypto, face matching, liveness or signature authority. Integrate approved providers via ports; define manual fallback.
**Consequences:** Provider selection is **Bank-decides**; vendor outage handling required; legal mapping of signature methods per document.

## ADR-011 — RBAC + ABAC with object-level checks on every call
**Status:** Accepted (source §5.1, §12.2)
**Decision:** Central policy decision point; roles combined with attributes (branch, portfolio, department, product, entity, sensitivity, amount, assignment); server-side checks for each API and document operation.
**Consequences:** Policy testing matrix; performance consideration for list endpoints (filter at query level).

## ADR-012 — Customer-facing status mapping layer
**Status:** Accepted (source §4.9)
**Decision:** Internal workflow states map to a controlled customer-visible dictionary; no internal information leaks.
**Consequences:** Mapping is versioned configuration; tests ensure no leakage.

## ADR-013 — Deterministic, versioned calculation services
**Status:** Accepted (source §7, §14.2)
**Decision:** Ratios, margin, haircuts, TAT and scores are computed in tested, versioned services with visible formulas; never by free-form LLM arithmetic.
**Consequences:** Independent validation before release; calculation catalogue.

## ADR-014 — Bank-configurable taxonomies (no hard-coded abbreviations)
**Status:** Accepted (source §3.3, §6.3)
**Decision:** Proposal types, statuses, reason codes, document types and abbreviations such as DN/CN are configuration.
**Consequences:** Discovery workshops to capture each bank's definitions; admin tooling for taxonomies.

## ADR-015 — Phased delivery with gated exits; vertical slice first
**Status:** Accepted (source §19, §26)
**Decision:** Build one service end-to-end first; reuse foundations; each phase has exit gates with sign-offs.
**Consequences:** Slower breadth, higher quality; strong pilot evidence.

## ADR-016 — Technology stack
**Status:** **Proposed** — Bank-decides where hosting/security constraints apply
**Context:** Source report is stack-agnostic.
**Decision (proposed):** One mainstream typed backend stack with strong security/testing ecosystem; PostgreSQL; S3-compatible private object storage; responsive web frontend with accessible component library; containers + IaC.
**Selection criteria:** security track record, talent availability in target market, bank-hostability, long-term support, licence suitability, observability support.
**Consequences:** Confirm with design-partner bank's technology standards before freeze.

## ADR-017 — Transactional outbox for integration and events
**Status:** **Proposed**
**Decision:** State change and outbound message are written atomically; a dispatcher delivers with idempotency keys and bounded retries; DLQ after max attempts.
**Consequences:** Guarantees no lost hand-offs; at-least-once delivery requires idempotent consumers.

## ADR-018 — Workflow engine: adopt vs build
**Status:** **Proposed** (evaluate in Phase 1)
**Context:** Need parallel/conditional/repeated stages, versioned definitions, human tasks, timers, escalations.
**Options:** (a) embeddable mature BPMN/state-machine engine; (b) purpose-built engine over a versioned graph with guard functions.
**Decision criteria:** version pinning, auditability of transitions, no-code authoring fit, licence, operational footprint, testability.
**Consequences:** Spike with the first service; record outcome in a superseding ADR.

## ADR-019 — Internationalisation in the data model
**Status:** Accepted (source §4.3)
**Decision:** Localised content stored as locale maps; Nepali + English minimum; no hard-coded strings; date-system display (e.g. BS) confirmed with bank.
**Consequences:** Translation workflow tied to config versions.

## ADR-020 — UTC storage, local rendering, calendars as configuration
**Status:** Accepted (source §9.1)
**Decision:** Timestamps in UTC; render in bank/customer timezone; business calendars and holidays are configuration; keep source-system timestamps and clock quality.

## ADR-021 — Security events and audit are separate from application logs
**Status:** **Proposed**
**Decision:** Audit/access events go to an append-only store with hash chaining and restricted DB permissions; application logs are redacted and may be sampled.
**Consequences:** Two pipelines; clearer evidentiary quality.

## ADR-022 — Permission-aware search
**Status:** **Proposed** (source §15.1 mentions permission-aware retrieval)
**Decision:** Index documents/cases with ACL metadata; filter at query time; never return unauthorised hits or snippets.

---

## ADR template

```markdown
# ADR-NNN — Title
**Status:** Proposed | Accepted | Superseded by ADR-XXX | Bank-decides
**Date:** YYYY-MM-DD
**Deciders:** names/roles
**Context:** What forces are at play? Link rules (e.g. INT-01) and source sections.
**Decision:** What we will do, in one or two sentences.
**Consequences:** Positive, negative, follow-ups, migration impact.
**Alternatives considered:** and why rejected.
**Verification:** Which tests/acceptance scenarios prove this holds.
```
