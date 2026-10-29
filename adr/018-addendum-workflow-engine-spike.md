# ADR-018 addendum — workflow engine spike is NOT done in Phase 1
**Status:** Open
**Context:** `docs/18` lists a workflow-engine spike under Phase 1 activities. A spike is only meaningful against the first real service's graph (parallel reviews, request-more-information loop, timers), which does not exist until Phases 3 and 4.
**Decision:** Keep ADR-018 *Proposed*. Run the adopt-vs-build spike at the start of Phase 4 against the vertical-slice workflow, using the criteria in ADR-018. Phase 1 deliberately builds no workflow code and no case state, so WFL-03/04 are not yet testable and are not claimed.
**Consequence:** One Phase 1 activity is deferred, recorded here and in the phase report so the gate reviewer can accept or reject the deferral.
