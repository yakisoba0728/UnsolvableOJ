# UnsolvableOJ engineering overhaul

Evidence-driven audit and implementation started2026-11-16. The actual baseline is remote `main` commit `6176015b63a1615cc2269172f246725ef08abab3`, independently checked through Git and GitHub API.

Changes improve assessment/identity correctness, notification privacy/recovery, internal execution boundaries, measured comparison/query/assembly costs, and integration validation. The established stack and public route shapes remain. This is a bounded engineering iteration, not a certification of every platform behavior.

Main is never automatically merged. Production servers/data/volumes/Redis and real API keys were not used. Review current state in [PROGRESS.md](PROGRESS.md); final readiness and unresolved scope are reported explicitly.

## Evidence map

| Question | Document |
|---|---|
| What exists and how does data flow? |[Architecture/features](ARCHITECTURE.md), [API inventory](API.md), [machine inventory](INVENTORY.json), [data model](DATA-MODEL.md) |
| What changed and why? |[Audit register](AUDIT.md), [ADRs](DECISIONS.md), [API behavior changes](API-CHANGES.md) |
| Who independently reviewed it? |[Review ledger](REVIEW.md) |
| What actually ran? |[Test results](TESTING.md), [coverage and limits](VALIDATION-COVERAGE.md) |
| What measurably improved? |[Performance and raw evidence](PERFORMANCE.md) |
| What remains? |[Backlog](BACKLOG.md), [progress/handoff](PROGRESS.md) |
| Detailed workstream evidence |[Backend](BACKEND.md), [Security](SECURITY.md), [Frontend](FRONTEND.md), [Judge](JUDGE.md), [Database](DATABASE.md), [Infrastructure](INFRASTRUCTURE.md), [Reliability](RELIABILITY.md) |

Implementation and review are separate responsibilities. Exact trees and heads are checked, and only applicable green CI plus reviewed changes enter `overhaul/integration`. Source review, mock tests, actual native execution and production readiness are not conflated. Specialist reports preserve their original workstream checkpoint; central progress/testing records carry later integration results.
