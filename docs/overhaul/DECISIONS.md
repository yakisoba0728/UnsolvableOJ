# Architecture decisions

## ADR-001 — Keep the existing stack and narrow changes to evidenced defects

Status: accepted for this iteration. React/TypeScript/Vite, NestJS, PostgreSQL/TypeORM, Redis/BullMQ and go-judge remain. The baseline already has extensive security and lifecycle tests. A full rewrite would add migration and correctness risk without a measured benefit. New work concentrates on observed temporal/privacy defects and measured allocation/initial-loading costs.

## ADR-002 — Enforce the same review/CI gate for the integration branch

Status: implemented in PR #54. Feature PRs target `overhaul/integration`. `CI required` includes dependency audit and Docker builds. The final integration→main PR requests all components plus WebKit/native/Compose validation, irrespective of changed paths. Main is never automatically merged; no deployment is performed. Existing branch settings are unchanged.

## ADR-003 — Treat lock acquisition as preceding time-sensitive authorization

Status: backend implementation under verification. A decision made before a lock wait can expire while queued. Submission/workspace authorization must be re-evaluated after relevant locks using PostgreSQL `clock_timestamp()` and the effective assessment deadline. Related business writes must serialize with finish. Row-lock strengths should protect updates while permitting unrelated FK KEY SHARE checks.

## ADR-004 — Preserve Judge verdict semantics while bounding comparison allocations

Status: implemented, independent review/CI pending. Replace per-line Buffer arrays with numeric offsets. Byte equality and ASCII trailing-whitespace behavior remain unchanged; an exhaustive bounded differential test validates semantics. A reproducible fresh-process benchmark records elapsed/CPU time and peak RSS. The result is not presented as end-to-end Judge throughput.

## ADR-005 — Keep transient UI state within an authenticated login identity

Status: frontend implementation under verification. Notification contents and asynchronous replies belong to a specific account/login. Account changes invalidate old operations. Page-load requests are single-flight and failed read mutations remain visible as failures. This adds small state/control code rather than a new state-management dependency.
