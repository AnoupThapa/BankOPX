# ADR-023 — Technology stack (resolves ADR-016 for the build)
**Status:** Accepted for the build; **Bank-decides** where the design-partner bank's technology standards differ
**Date:** 2026-10-29
**Deciders:** Product owner (user instruction, session of 2026-10-29)
**Context:** ADR-016 left the stack open. Hosting, provider and bank-standard constraints are still unconfirmed `[BANK-DECIDES]`.
**Decision:** TypeScript across the codebase; NestJS 11 (modular monolith, ADR-002; NestJS 12 is ESM-only and was deferred to avoid a toolchain migration in Phase 1); PostgreSQL 16 accessed with the `pg` driver and hand-written SQL (no ORM, so tenant scoping and append-only rules stay explicit); React for the portals; npm workspaces monorepo; Jest (backend) and Vitest + axe (UI).
**Consequences:** One language and one test culture. No ORM means every query is reviewable, at the cost of more SQL. Re-opening the choice later is a superseding ADR, cheaper now than after Phase 3.
**Alternatives considered:** Java/Kotlin + Spring (common in banks, heavier start); Python FastAPI (fast prototype, weaker static guarantees).
**Verification:** `npm run ci` is green on every commit.
