# UnsolvableOJ engineering overhaul

Evidence-driven audit and implementation started2026-11-16. The actual baseline is remote `main` commit `6176015b63a1615cc2269172f246725ef08abab3`, independently checked through Git and GitHub API.

Changes improve assessment/identity correctness, notification privacy/recovery, internal execution boundaries, measured comparison/query/assembly costs, and integration validation. The established stack and public route shapes remain. This is a bounded engineering iteration, not a certification of every platform behavior.

Main is never automatically merged. Production servers/data/volumes/Redis and real API keys were not used. Phase I history remains in [PROGRESS.md](PROGRESS.md); current Phase II heads, review and gates are in [PHASE2-PROGRESS.md](PHASE2-PROGRESS.md). Final readiness and unresolved scope are reported explicitly.

## Phase II evidence

Phase II starts from the independently verified integration `c8ba9712d1a29ac633519511e50428ef647edf66`. It adds private problem bookmarks, immutable algorithm-problem versions in enterprise assessments, bounded results, corrected identity/concurrency boundaries, expanded real Judge recovery and actual artifact security checks. Results pagination is an intentional API change; the Phase I compatibility statement above does not describe this later contract.

| Question | Current evidence |
|---|---|
| What was delivered and what remains? | [Phase II engineering report](PHASE2-FINAL-REPORT.md), [live PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63) |
| What was independently rechecked? | [Baseline](PHASE2-BASELINE.md), [audit register](PHASE2-AUDIT.md), [bounded roadmap](PHASE2-ROADMAP.md) |
| What can users do? | [Bookmarks and product work](PHASE2-FEATURES.md), [immutable exams](PHASE2-ENTERPRISE.md), [pinned owner metadata](PHASE2-ENTERPRISE-SUMMARY.md), [results navigation](PHASE2-RESULTS.md) |
| What changed structurally? | [Architecture](PHASE2-ARCHITECTURE.md), [frontend request ownership](PHASE2-FRONTEND-OWNERSHIP.md) |
| What actually ran? | [Validation](PHASE2-VALIDATION.md), [independent reviews](PHASE2-REVIEW.md), [Judge matrix](PHASE2-JUDGE.md), [daemon/rejudge recovery](PHASE2-RECOVERY.md) |
| What was measured? | [Performance and limits](PHASE2-PERFORMANCE.md), raw files in `measurements/` and `evidence/` |
| How is security evidence scoped? | [Dependencies](PHASE2-SECURITY.md), image PR #68 and its retained scan/provenance records |
| Where should work resume? | [Current progress and source/run/merge mapping](PHASE2-PROGRESS.md); always re-read live GitHub |

## Phase I evidence map

| Question | Document |
|---|---|
| What was delivered and what is its readiness? |[Final engineering report](FINAL-REPORT.md), [live final validation record](https://github.com/yakisoba0728/UnsolvableOJ/pull/61) |
| What exists and how does data flow? |[Architecture/features](ARCHITECTURE.md), [API inventory](API.md), [machine inventory](INVENTORY.json), [data model](DATA-MODEL.md) |
| What dependencies and licenses were recorded? |[Locked dependencies](DEPENDENCIES.md) |
| What changed and why? |[Audit register](AUDIT.md), [ADRs](DECISIONS.md), [API behavior changes](API-CHANGES.md) |
| Who independently reviewed it? |[Review ledger](REVIEW.md) |
| What actually ran? |[Test results](TESTING.md), [coverage and limits](VALIDATION-COVERAGE.md), [worker recovery](RECOVERY.md) |
| What measurably improved? |[Performance and raw evidence](PERFORMANCE.md) |
| What remains? |[Backlog](BACKLOG.md), [progress/handoff](PROGRESS.md) |
| Detailed workstream evidence |[Backend](BACKEND.md), [Security](SECURITY.md), [Frontend](FRONTEND.md), [Judge](JUDGE.md), [Database](DATABASE.md), [Infrastructure](INFRASTRUCTURE.md), [Reliability](RELIABILITY.md) |

Implementation and review are separate responsibilities. Exact trees and heads are checked, and only applicable green CI plus reviewed changes enter `overhaul/integration`. Source review, mock tests, actual native execution and production readiness are not conflated. Specialist reports preserve their original workstream checkpoint; central progress/testing records carry later integration results.
