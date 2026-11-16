# Phase V finite acceptance backlog

The owner requests the remaining engineering goals across UX, Judge/Vibe, DB/API, security and recovery. Discovery is bounded to changed or previously unverified areas. Existing implementations are reused. New P0/P1 evidence takes priority; speculative features and migrations do not.

| Stream | Finite initial work | Acceptance |
|---|---|---|
| CI foundation | Add Phase V target and identical full selectors | Actual selector regressions; full suites and four images; independent review |
| Frontend | Exact route/role inventory; shared picker focus; learning refresh geometry; layout-shift attribution | Reproduce before fix; targeted multi-engine responsive checks; raw bounded geometry; no WCAG/field claim |
| Judge/Vibe | All-eight-language bounded memory/verdict evidence; real disposable dedicated transport pipeline | Native classifications reported honestly; cleanup; persisted assessment; no paid AI or host-escape experiment |
| DB/API | Existing 5k export/deep-page checks plus bounded high-cardinality/source-transition correctness and resource evidence | Actual PostgreSQL, exact row/privacy/statistics oracle; EXPLAIN and adverse costs retained; no speculative index |
| Security/infra | Current shipping image/advisory/payload binding, strict policy and deploy boundaries | Independent applicability review; four fresh image scans; expiry unchanged; host limits explicit |
| Reliability/QA | Existing restore baseline, targeted fixture/runbook gaps, cross-review | Actual disposable execution and cleanup; precise rollback/stop conditions; full final source CI |

Implementation, testing, independent review, CI and integration are distinct milestones. Each feature must finish review and exact-source full CI before merging into `overhaul5/integration`. The final integration receives its own full gate and independent receipt. No old component CI substitutes for the final source.

## Resource bounds

No unbounded chaos or saturation. Keep existing CI deadlines and service caps unless a concrete measured requirement warrants a separate review. DB fixtures must fit the existing PostgreSQL512MiB/data256MiB budget and use statement/lock deadlines. Judge probes are sequential/bounded and preserve admission limits. Browser runs use finite samples and report test versus field data accurately. At most three subagents run concurrently; additional streams run when slots free.

## External gates

Dedicated host/kernel/VM, real firewall/egress/certificate operations, production-scale migration/backup/RTO/RPO, real-device/screen-reader and population field Web Vitals remain blocked by missing approved environments. Owner-selected repository licensing requires an owner decision. Explicitly deferred code work remains deferred, not relabeled as an environment blocker.
