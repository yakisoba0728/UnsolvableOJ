# Phase IV fixed scope and acceptance

This increment builds on Phase III. Bookmarks, the 7/30/90-day learning dashboard and ten-item review queue, immutable assessments, paginated enterprise results, admin queue/worker operations and Vibe attempt/concurrency limits already exist and are not counted as new features.

## Product scope — exactly two new features

1. **Private learning goals.** One persisted goal per account, target 1–1000 distinct public ordinary problems over 7/30/90 KST calendar days. Idempotent unchanged save preserves dates; explicit restart resets the window; removal is idempotent. Progress is server-derived, excludes tests/enterprise/private content and counts repeated AC once. Acceptance includes real migration/API isolation/withdrawal/concurrency, empty/error/expired/completed states and keyboard/mobile/account-transition browser coverage.
2. **Safe enterprise result export and distribution.** Authorized examiner/admin exports a scalar allowlist from a consistent snapshot, max 5,000 attempts, with explicit rejection rather than silent truncation above the cap. No source/workspace/hidden tests/email/invitation secrets. Spreadsheet formula neutralization and CSV escaping are required. Existing aggregate summaries gain useful status/score distribution without loading all detailed attempts. Acceptance includes ownership boundaries, pending-score parity, limits, hostile cells and actual browser download/error/account-change behavior.

## Engineering streams

| Stream | Fixed work | Acceptance and limits |
|---|---|---|
| CI / integration | Phase IV branch wiring and preserved full validation | Both selectors require every suite and four real image builds; policy regressions, independent review and actual CI |
| Shared UX | Existing route/state inventory; evidenced route focus/loading and mobile navigation fixes | Preserve dynamic titles, keyboard order, query/hash changes and account isolation; targeted browser and responsive regressions; no wholesale rewrite |
| Vibe runtime | Dedicated execution transport policy and isolated topology template | Fail-closed verified TLS/auth configuration and tests; privileged execution excluded from application template; host isolation remains unverified until an approved host exists |
| Reliability / data | Bounded disposable migration/backup/restore and finite workload evidence | Data/score invariants, resource bounds and honest fixture/host limitations; no production operations or unbounded benchmark loop |
| Independent QA | Cross-review implemented modules plus complete integration CI | Implementation, local testing, review, exact-source CI and integration tracked separately |

## Stop conditions

No new feature beyond the two above is added without replacing an existing scoped item. Do not reopen completed Phase III implementations. Use finite workload sizes and repetitions and preserve negative outcomes. Real host/kernel testing, production migration, paid-model evaluation, field LCP/INP/CLS and multi-hour saturation remain explicitly unverified/blocked when no suitable owned environment is available.

Milestones: M0 gate receipt; M1 fixed backlog; M2 implemented feature and engineering PRs; M3 verified product/performance/reliability evidence; M4 independent integration QA and full CI; M5 final manual-review PR and resumable report. Incomplete milestones remain incomplete rather than being relabeled as finished.
