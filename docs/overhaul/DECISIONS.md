# Architecture decisions

## ADR-001 — Keep the established stack

React/TypeScript/Vite, NestJS, PostgreSQL/TypeORM, Redis/BullMQ and go-judge remain. Existing lifecycle and security tests offer a sound regression base. A rewrite or Go/Rust replacement had no measured benefit that justified migration risk. Scope is frozen around confirmed defects, measured component costs and verification dependencies; broad feature expansion is deferred.

## ADR-002 — Gate integration with risk-appropriate real execution

PRs target `overhaul/integration`; main is never automatically merged. Required CI includes audit and all image jobs. Execution, queue, sandbox, Compose and critical contract changes select all components plus native runtime, actual queue pipeline, Compose and WebKit. Final integration→main always selects full validation. Missing change-range information fails closed. Ordinary docs/UI/migration work keeps bounded checks. Root/independent review verified actual shell policy tests and exact remote trees; no deployment job was added.

## ADR-003 — Evaluate time-sensitive eligibility after acquiring locks

A decision before a lock wait may expire while queued. Submission quota lock precedes attempt lock; fresh current-state and `clock_timestamp()` checks run after waiting, inside the insertion transaction. Finish serializes on the same attempt. `FOR NO KEY UPDATE` retains per-user quota exclusion while allowing foreign-key KEY SHARE checks, removing an observed cycle. Workspace start uses the same post-lock wall-clock principle. Cost: a deliberate extra lookup; no latency gain claimed.

## ADR-004 — Bound comparator allocations while preserving verdicts

Numeric byte-range offsets replace Buffer arrays per line. ASCII trailing-whitespace and binary semantics remain unchanged; 160,000 bounded input pairs plus edge/large fixtures support equivalence. Five fresh processes per fixture show lower elapsed/CPU/RSS, especially high-line-count output. No whole-Judge throughput inference is made. Compiled artifacts remain scoped to one submission; no cross-user execution cache was introduced.

## ADR-005 — Bind transient UI state to login identity; reconcile concurrent writes

Notification state belongs to user plus login-family identity. Refresh within the same login retains state; account/login changes remount and abort old work. Pagination is single-flight and deduplicated. GET epochs suppress old replies, while writes never infer server order from request-start order. When all reads finish, including failures, refresh authoritative rows/count. This adds requests after read operations and a few kilobytes of safety code, with improved truthfulness and explicit retry. No new state-management dependency is needed.

## ADR-006 — Verify identity and immutable diagnostic eligibility

A claimed email is not verified mailbox ownership. Shared enterprise access requires verification for email invitations, while explicit account usernames/owners/public assessments retain their contracts. Detailed Judge callbacks are checked against the saved submitted problem version before final mutation; the API controls sample visibility. Worker credentials remain a powerful internal trust boundary, not an excuse to trust client-labelled visibility. Pending-password accounts receive anonymous visibility on optional-auth routes until replacement.

## ADR-007 — Apply measured local data improvements

Two user/post indexes support existing reverse profile queries; no table or foreign key is removed. Use a reversible transactional migration under the existing convention, documenting lock duration before a future production rollout. In-memory enterprise grouping changes repeated scans to one nested Map while preserving order/score/status. Index storage is about9.96MB each at200k rows; write overhead remains unmeasured. Map assembly uses about1.64MiB more process RSS in the recorded fixture. Those costs are disclosed, not hidden behind speed percentages.

## ADR-008 — Defer optional telemetry safely

Keep the existing Sentry error-only contract and privacy scrubber. Load only the limited init/capture adapter when configured and outside protected email-action routes; recheck privacy after asynchronous loading and before queued reporting. Share concurrent imports, catch failure and permit retry. Configured initial JS shrinks; total code is almost unchanged. Asynchronous instrumentation leaves an early-boot window, and default no-monitoring builds already tree-shook the SDK. No default bundle reduction or browser timing gain is claimed.

## ADR-009 — Use bounded disposable measurements and reproducible evidence

Benchmarks create only randomly named local test DBs, require explicit opt-in, reject destination overrides, and use synthetic data. HTTP tests require empty Redis, disabled external AI/email and exact cleanup; signals are verified on live test requests. Report source-tree IDs, all samples, concurrency, warmups and resource definitions. A shared host and narrow endpoint cannot establish production capacity. Native workloads remain inside authorized disposable Docker CI, never executed as untrusted host programs.
