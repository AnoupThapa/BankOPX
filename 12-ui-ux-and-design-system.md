# 12 — UI/UX and Design System

[SOURCE: §1.2, §4, §5.3, §10] Mobile-first, accessible, honest about what requires a visit, and never leaking internal information.

## 1. Principles

1. **Mobile-first, responsive.** Same journey on phone, tablet, desktop; usable on low bandwidth.
2. **Do not ask twice.** Prefill from verified data; show source and date; ask to confirm/update (PRF-02).
3. **Honest remoteness.** Tell the customer upfront whether a visit may be needed and why (SVC-01/02).
4. **Plain language.** Explain *why* an item is needed.
5. **Progress and recovery.** Always show progress; auto-save; never lose data on network loss.
6. **Safe by design.** Never show internal info, never put sensitive data in URLs or notifications.

## 2. Customer journey UX requirements

| Area | Requirements |
|---|---|
| Entry | Website "Apply / Request a Service", bank-app deep link or embed, direct responsive URL, optional branch-assisted mode using the same digital journey |
| Branding | Preserve bank branding, navigation, support links (theme tokens per institution) |
| Catalogue | Search, categories, favourites, "continue application"; each service shows description, who can apply, docs, fees, visit possibility, signature support, support route, "submission ≠ approval" |
| Forms | One question or small group per screen where useful; progress and remaining steps; conditional fields; repeatable sections; inline errors; save/resume across devices; local date/number formats and currencies |
| Camera/upload | Open camera where supported; gallery/file alternative; progress; clear success/failure; crop/rotate/retake **without altering the source**; thumbnails; duplicate warning; accepted formats shown; rejection reasons with next steps |
| Declarations | Show exact terms; explicit unticked checkbox for required declarations; separate marketing consent |
| Submission | Receipt, tracking code, outstanding items, status, "under review, not approved" |
| Return loop | Item-by-item list with why/due/how; one-tap replace upload |
| Visit | If required: choose branch/time, see originals checklist; case resumes, no re-entry |
| Status | Controlled dictionary labels; next action always visible |

### Camera capture UX specifics

- Guidance overlay (edge detection hints, glare/blur warnings, "text readable?" check) — advisory only.
- Retake keeps prior captures until the customer submits; the stored original is the unedited capture plus transformation metadata (DOC-09).
- Works over poor connectivity: chunked/resumable upload with clear retry.
- Permissions prompts explained before the browser prompt appears; graceful fallback to file upload.

### Selfie / liveness

A selfie is **not** automatically identity verification. Use only the approved provider flow with consent, retention rules, failure handling, **manual fallback**, spoof detection and accessibility accommodations.

## 3. Customer-facing copy rules

| Do | Don't |
|---|---|
| "We need a clearer photo of your citizenship certificate — the right edge is cut off." | "Document rejected." |
| "Your application is under review. This is not an approval." | "Approved!" before an authorised decision |
| Use bank-approved wording for declines (DEC-04) | Reveal internal risk grades, fraud flags, deliberations |
| "Sign in to see details." in SMS/email | Include account numbers, amounts, document details, or decision reasons in SMS/email (NOT-01) |
| Provide an assisted/branch alternative | Imply that digital completion is always possible |

All user-facing text lives in localisation files/config (Nepali + English minimum); no hard-coded strings.

## 4. Accessibility and inclusion (WCAG 2.1 AA target `[PROPOSED]`)

- Keyboard navigable; visible focus; logical order; labels tied to inputs.
- Colour contrast ≥ AA; never colour alone to convey state (e.g. priority needs a text reason — WFL-09).
- Screen-reader basics: landmarks, aria-live for upload progress and errors.
- Touch targets ≥ 44×44 px; support text scaling to 200%.
- Reduced-motion support; no time-limited actions without extension option (OTP excluded, with clear resend).
- Assisted channel for customers who cannot complete the digital journey (inclusion risk in `19`).

## 5. Localisation

- Nepali and English minimum if the bank requires (SVC-07).
- Locale-aware numbers, currency, dates. **Confirm with the bank** whether Bikram Sambat (BS) date display/entry is required alongside Gregorian; store canonical UTC/Gregorian internally and convert for display `[BANK-DECIDES]`.
- Right-sized fonts for Devanagari; test truncation and line-breaking.
- Translation keys versioned with the service/form version.

## 6. Staff portal UX

- **Queue** columns per QUE-01. Priority always shows its **reason**.
- **Case workspace:** left = timeline and documents, centre = data/snapshot versions with diff between versions, right = tasks/checklist/decision panel.
- Document viewer: private streaming, zoom/rotate (view-only transforms), side-by-side with form values, mark outcomes with reason codes and customer message composer.
- Customer-facing text composer is separate from internal notes; internal notes visually distinct and labelled "Internal — not visible to customer" (RET-03).
- Restricted referral flags and notes visible only to authorised roles (QUE-03).
- Decision panel shows authority check result **before** the action is enabled.
- Bulk actions limited to safe operations (APR-08).

## 7. Admin portal UX

See `08` §8. Show diff and impact before publish; "create new version" instead of "edit live"; guardrail violations inline with rule ID.

## 8. Dashboard UX rules (TAT-07)

- Every tile shows definition (hover/tap), source, owner, "as of" timestamp and freshness state.
- Always show median **and** p90; separate customer-wait vs bank-wait.
- Drill-down to authorised case-level detail; no drill-down beyond role scope.
- Avoid employee league tables based only on counts (TAT-06).
- Empty/loading/error states are explicit; stale data is flagged, never silently shown as current.

## 9. Design tokens and components `[PROPOSED]`

- Token-based theming (colour, typography, spacing, radius, elevation) per institution.
- Core components: form field set, repeatable section, upload/camera widget, status badge (label + icon), timeline, info-request item, appointment picker, queue table, case summary card, decision panel, diff viewer, metric tile, empty/error states.
- Each component ships with accessibility tests and mobile/desktop visual regression tests.

## 10. Performance budgets (starting points, to be set with the bank)

| Area | Budget |
|---|---|
| First form screen on mid-range phone, 3G-class network | Interactive within an agreed budget (set in discovery) |
| Upload | Resumable; progress feedback within 1 s of start |
| Dashboard queries | Target p95 set per dashboard; precomputed read models |
| Bundle size | Enforced per route in CI |
