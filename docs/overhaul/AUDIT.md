# Audit scope and findings

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`, re-read from GitHub at task start. Structural inventory: 453 tracked files, 112 method/path declarations, 13 controller files, 35 frontend routes, 25 original migrations and 30 application tables. Counts describe discovery, not line coverage.

## Scope accounting

| Area | Inspection and runtime evidence | Limits |
|---|---|---|
| Frontend | Whole-tree/routes/dependencies indexed; principal auth/request/editor/enterprise/community/Markdown/notification/telemetry paths reviewed; build/privacy/type/unit and real CI browser suites | Not every visual state manually exercised; no browser load/interaction timing claim |
| Backend | Controllers, DTOs, modules, transactions, queue/XP/session and authorization paths inspected; real Nest/PostgreSQL/Redis tests and controlled lock races | Existing behavior is not an exhaustive specification; external AI/email calls use deterministic substitutes |
| Judge | All worker/runtime source and configuration reviewed; byte-differential/transport/unit tests; native isolation/language/pipeline/Compose CI | No sandbox escape research or production host test; mixed-language sustained throughput unmeasured |
| Database | Migrations and live catalog inspected; 30 app tables, 48 FKs, 20 CHECKs, 5 SQL UNIQUE constraints (unique indexes additional); migration round trips and real query plans | Representative production cardinalities/write pressure/lock distributions unavailable |
| Security | Auth/session/RBAC/owner/enterprise/callback/sandbox/provider boundaries reviewed; confirmed before/after unit and HTTP regressions | No guarantee against every attack, dependency or model prompt-injection behavior |
| Infrastructure | Compose, Dockerfiles, CI, proxy, resource budgets and backups read; images and native disposable flows built/tested in Actions | Production host, CDN/TLS, off-host restore and image-CVE/SBOM drill not executed |
| Documentation/assets | Full tracked inventory; execution and operation guidance inspected | Static assets are not counted as application security review |

See specialist reports and VALIDATION-COVERAGE.md for executable-suite mappings. Seven distinct specialist agents participated, with at most three children active alongside the coordinator. Implementation/reviewer separation and exact-tree evidence are in REVIEW.md.

## Confirmed remediation register

This register includes correctness, privacy, performance and verification-process defects, plus defects caught in newly written tooling. It is not a count of independently exploitable security vulnerabilities. P1 process entries are explicitly distinguished from application defects. States are updated through PROGRESS.md and exact-head CI evidence; no item is INTEGRATED solely because its local test passed.

| ID | Priority | Finding / correction | PR or evidence |
|---|---|---|---|
| INF-001 | P1 process | Aggregate required CI omitted audit/image failures; include all required dependencies | #54 |
| INF-002 | P2 | Changed-file pipe could misclassify large image diffs; avoid early-reader SIGPIPE | #54 |
| INF-003 | P1 process | Integration target lacked PR validation; enable integration and full final checks | #54 |
| REL-001 | P1 process | Execution changes could enter integration without native gates; risk-path full selection | #57 |
| REL-002 | P2 preventive | Judge build context omitted `.env.*` exclusion; add it, without alleging a leaked secret | #57 |
| BE-001 | P1 | Submission authorization could expire/change before insertion; lock and freshly check inside transaction | #59, BACKEND.md |
| BE-002 | P1 | Workspace deadline check used transaction-start time after waiting; post-lock wall clock | #59 |
| BE-003 | P2 | Quota/attempt/FK lock cycle; retain serialization with NO KEY UPDATE | #59 |
| FE-001 | P1 privacy | Notification state/replies outlived login identity; remount/abort by identity | #56, FRONTEND.md |
| FE-002 | P2 | Duplicate page requests/rows; synchronous ownership and ID deduplication | #56 |
| FE-003 | P2 | Failed loading/reads lacked truthful recovery; retry and explicit failure state | #56 |
| FE-004 | P2 performance | Configured telemetry loaded SDK in initial entry; defer optional adapter with privacy rechecks | #56 |
| FE-005 | P2 introduced/reviewed | Initial patch mishandled overlapping reads/stale lists; independently reproduce four orderings and reconcile | #56, REVIEW.md |
| JG-001 | P2 | Internal API followed redirects; reject redirects | #55, JUDGE.md |
| JG-002 | P2 | Readiness did not prove auth enforcement; require anonymous rejection | #55 |
| JG-003 | P2 performance | Line-count amplified comparator allocation; constant auxiliary state | #55 |
| JG-004 | P3 | Incorrect recovery-budget comment; align with actual lease release | #55 |
| SEC-001 | P1 | Email invitation did not require verified mailbox ownership; shared verified predicate | #60, SECURITY.md |
| SEC-002 | P2 defense | Detailed callback self-labelled diagnostic visibility; validate immutable case membership | #60 |
| SEC-003 | P2 defense | Vibe readiness did not prove auth enforcement; anonymous rejection | #60 |
| SEC-004 | P2 | Pending-password identity retained privileged optional-route visibility; anonymous visibility until replacement | #60 |
| DB-001 | P2 performance | Reverse profile lookup lacked user-first indexes; add two measured composite indexes | #58, DATABASE.md |
| DB-002 | P2 performance | Enterprise score assembly repeatedly scanned all rows; index once | #58 |
| TOOL-001 | P2 introduced/reviewed | New benchmarks checked URL text rather than effective DB destination; reject overrides/protocol mismatch | #58 and audit-evidence |
| TOOL-002 | P2 introduced/reviewed | New HTTP harness cleanup/ownership gaps; bounded cleanup, empty Redis and signal handling | audit-evidence, 8-case safety evidence |

Totals for this bounded register: **25 items: P0 0, P1 7 (4 application/privacy + 3 process), P2 17, P3 1**. Public summaries omit operational exploit instructions. No P0 was established; that is not proof that none can exist. Deferred observations in BACKLOG.md are separate from these confirmed remediations.

Application tests follow DISCOVERED → REPRODUCED → IMPLEMENTED → TESTED → REVIEWED → INTEGRATED. Pure preventive/documentation changes have static/configuration evidence instead of an invented failing exploit. BLOCKED and UNMEASURED remain explicit states.
