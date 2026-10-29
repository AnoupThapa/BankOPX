# 11 — AI Governance

[SOURCE: §7.5, §14] AI is introduced **only after** workflows, data models, permissions, audit trails and human-review points are stable (Phase 10). AI is assistive, controlled and explainable.

## 1. Permitted capabilities (initial)

- OCR and document field extraction
- Data-quality checks and duplicate-detection suggestions
- Compare values across forms and documents
- Summarise an application with citations to source pages/fields
- Draft a missing-document request **for staff approval**
- Extract key clauses/dates from contracts with source references
- Explain formula results using approved calculations
- Identify likely inconsistencies/anomalies for human review
- Draft management commentary from approved metrics
- Search approved policies/procedures with citation
- Translate or simplify customer-facing instructions using human-approved templates

## 2. Prohibited (AIX-01)

- AI-only credit approval or decline
- AI-only AML clearance
- AI-only legal clearance
- AI-only signature validation
- Any AI-initiated collateral action, disbursement, pledge release or liquidation
- Silently converting an AI recommendation into a decision (DEC-06)
- Sending customer documents to public AI services without bank approval and contractual/privacy safeguards (AIX-04)

## 3. Required controls

| Control | Requirement |
|---|---|
| Labelling | Outputs clearly marked "machine-generated suggestion" (AIX-02) |
| Source references | Material extracted facts link to source page/field; human verifies |
| Corrections | Staff can correct; correction logged; originals preserved (AIX-06) |
| Confidence | Low-confidence or conflicting extraction routes to manual review (AIX-03) |
| Hosting | Bank-approved model hosting and data-processing arrangements (AIX-04) |
| Minimisation | Redact irrelevant sensitive fields before sending to a model |
| Access | AI retrieval honours the requesting user's permissions; never reads outside scope (AIX-08) |
| Untrusted input | Uploaded documents are untrusted; prompt-injection resistant design (AIX-05) |
| Arithmetic | Deterministic calculation services only (AIX-07) |
| Monitoring | Model drift, error rates, hallucinations, bias, usage |
| Versioning | Model/version/prompt logs; rollback controls |
| Governance | Bank AI-governance approval before enablement |

## 4. Prompt-injection design rules

1. Treat all document text as **data**, never instructions.
2. Separate system instructions from document content structurally; never concatenate documents into the instruction channel.
3. Constrain output to a schema; validate; reject free-form action requests.
4. The model has no tool access that can change case state, send messages or fetch data; suggestions are written to `ai_extraction`/`ai_summary` only.
5. Strip/neutralise hidden text, metadata and unusual encodings where feasible; flag documents containing instruction-like patterns for staff attention.
6. Red-team test with injected documents every release.

## 5. Data model touchpoints

`ai_extraction` (fields, confidence, source refs, model_version) · `ai_summary` · `human_correction` · `model_version`. AI artefacts are never the system of record; the human-verified value is.

## 6. Evaluation and release gate (Phase 10)

- Accuracy measured on representative, **authorised** test data (field-level precision/recall, by document type and quality bucket).
- Material facts trace to sources.
- Low-confidence cases route to humans.
- Prompt-injection test suite passes.
- Human-correction rates monitored; thresholds trigger rollback or retraining review.
- No AI-only final credit/compliance/legal decisions anywhere in the product.
- Bank AI governance approval and rollback plan on file.

## 7. UX rules for AI features

- Show source highlights next to every extracted value.
- One-click "accept / edit / reject" per field; edits recorded.
- Never auto-populate customer-facing messages; always staff-approved.
- Never show AI summaries to customers unless explicitly approved as a feature and template.
