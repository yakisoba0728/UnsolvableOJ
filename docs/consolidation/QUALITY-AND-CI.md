# Quality gates and independent review

## Current-source acceptance

The final receipt must bind the current PR HEAD, current main base, actual Actions
merge checkout and both parents, complete tested Git tree, run ID/attempt and all
job conclusions. Historical Phase III/IV/V green runs are recovery evidence only.
The final source's own run must finish before readiness is declared.

The exact `consolidation/unsolvableoj-final-overhaul → main` branch pair now forces
full validation in both image and suite selectors. This remains true for later
documentation-only changes. A regression using the actual workflow expression
failed before the fix and passed afterward. Unrelated branches retain their
existing bounded selection policy.

## Required execution

| Job | Required actual work |
|---|---|
| Detect changes | Full selection for this final branch/base |
| Dependency audit | Back/Front/Judge production and complete graphs; SBOM regression and generation |
| Docker image(back/front/judge/runtime), four jobs | Four real builds and raw current scans; strict applicability/payload gate |
| Backend and API | Archive/link verification; policy/Compose guards; lint/types/unit/build; real PostgreSQL migrations/API; dump/restore; seven DB workloads |
| Judge worker | Build and worker/protocol tests plus Python runtime checks |
| Browser tests(1/2,2/2), two jobs | Chromium ordinary/slow and browser-free units; WebKit core flows; separately executed Firefox core flows |
| Sandbox, pipeline and Compose | Real TLS, eight-language native matrix, Redis/BullMQ pipeline, recovery and actual Vibe/browser Compose flow |
| CI required | Aggregate every job; fail on failure/cancellation/unknown state |

This is twelve jobs with unchanged coverage and timeout/retry policies. A green
path-skipped job or a browser test-list command is not proof of actual execution.
Inspect step outcomes and decoded logs, not only the aggregate badge. Distinguish
browser-free units, browser executions, native parent assertions and distinct
language/scenario cells when reporting counts.

## Review model

Implementation is split across isolated Frontend, Backend and Judge/Vibe worktrees.
Security/Infra reviews changed boundaries separately; Performance/Testing checks
measurement claims; Independent QA checks final source, evidence and actual CI.
Only the coordinator changes the final branch/PR. A code author does not independently
approve their own work. Actual spawned/completed roles and exact review subjects
belong in the final receipt; planned roles must not be reported as completed.

Source audit is broader than executed local tests. Local Docker/PostgreSQL/Redis
are unavailable, and normal system Chromium startup was blocked by socket policy
before application assertions. No sandbox weakening was used. DOM reproductions,
types and unit checks are useful evidence, while actual database/native/three-engine
acceptance must come from the permitted CI environment.

## Failure and artifact discipline

Retain before-fix failing regressions, first failed CI runs, partial logs and
negative performance observations. No assertion deletion/relaxation, new skip,
silent retry loop, scanner database rollback or exception-expiry extension is an
acceptable fix. Correct the root cause and record which new source passed.

Original artifact bytes and decoded logs are preserved with digests in Git, on a
separate evidence branch after the final run. The release source remains unchanged
while post-run receipts are written. Current publication of a source checkpoint
does not itself imply QA approval or readiness for deployment.
