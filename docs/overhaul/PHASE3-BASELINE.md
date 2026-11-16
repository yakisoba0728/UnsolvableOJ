# Phase III recovery baseline

Observed on 2026-11-16. Repository/API and a fresh local checkout agree:

| Item | Observed state |
|---|---|
| Integration | `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4` |
| Integration Git tree | `141e2df98ff4739c1c574bd2a3165858c2a9ebc9` |
| Main | `6176015b63a1615cc2269172f246725ef08abab3` |
| Final PR | [#63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63), OPEN / UNMERGED |
| Phase II work | #64–#71 all merged into integration |
| Final historical CI | [43809685401](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43809685401), all 12 jobs successful |
| Actual historical checkout | `62430e27d1c05fe937dea1bdedaee0c67e504259`, PR63 merge ref |
| Other open work | Dependabot #51, #52, #53 retained; no pre-existing open issue found |

**Recovery decision: Case A.** Phase II implementation, documentation and the
post-merge final integration CI are complete. No Phase II feature is being
reimplemented. PHASE2-PROGRESS/VALIDATION/RECOVERY contain historical pending
checkpoints; their later execution sections and PR63's final receipt supersede
those entries. The preserved Phase I body on PR63 likewise does not reopen the
resolved ORM dependency chain or algorithm version binding.

An independent read-only agent checked PR states, completed job steps and actual
logs: Back320, API209, Judge107, native74, pipeline28, Compose3. Front logs contain
340+340 standard and56+56 Firefox instances, matching707 browser +85 browser-free
tests. These are historical runs, not validation of new code. The coordinator
freshly installed locked dependencies and reran baseline Back320 and Judge107
locally; both passed.

Phase III tracking: [issue #72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72).
Work is on isolated feature worktrees. The coordinator owns publication and
integration; implementation and independent review are different assignments.

## Bounded scope admitted after recovery

1. Immutable enterprise Vibe challenge versions across selection, workspace,
   execution, AI context and assessment review. Algorithm versioning is retained.
2. Private 7/30/90-day learning dashboard and bounded review queue, with server
   aggregation, visibility/account isolation and actual UI.
3. Verified TLS and fail-closed dedicated-executor deployment checks, with local
   development behavior preserved and explicit host limitations.
4. Applicable database, native, browser, supply-chain and reliability evidence,
   separate reviews, exact-head CI, feature integration and a final full run.

Confirmed P0/P1 findings interrupt this scope. Broader exploratory performance,
UI and operations work is recorded as partial/deferred when not executed; this
iteration is not a claim that every route or every scale target is complete.

## Preserved boundaries

No main push/merge, production deployment/data operation, paid provider call,
force-push or alteration of external contributors' branches. Runtime raw
HIGH177/CRITICAL5 are not zero findings. The exact component review still expires
2026-11-30 00:00 UTC; new evidence is required for changed images/advisories or
renewal. The privileged executor's host kernel remains UNVERIFIED.

Local Docker is unavailable. User-owned PostgreSQL17.11 and Redis8.10.3 use
random loopback ports, temporary clusters and the repository's generated test
databases. No existing database or Redis service is reused. Chromium's Unix
socket startup is denied in this environment; actual browser/native/image gates
therefore use the authorized GitHub Actions configuration.
