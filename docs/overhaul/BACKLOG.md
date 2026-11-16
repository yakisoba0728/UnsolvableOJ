# Frozen scope and outstanding work

This iteration implements the confirmed remediation register in AUDIT.md. Features are limited to practical notification retry/recovery and safer existing workflows; no unbounded product expansion is claimed. New substantive scope requires separately bounded acceptance criteria, except a newly confirmed critical defect needed for safe integration.

## Remaining engineering and operational work

| Priority / status | Work | Evidence needed / acceptance criterion |
|---|---|---|
| P2 design decision | Bind enterprise task content/version at test start or creation | Decide whether edits during scheduled/active assessment are allowed, then migrate explicit bindings and test review/rejudge semantics. Current submissions snapshot at acceptance, not at assessment creation. |
| P2 capacity, UNMEASURED | Representative mixed-language sustained Judge throughput, queue delay, CPU/RSS and recovery under load | Controlled isolated executors; repeated per-language/mix/concurrency trials, queue percentiles, no production target. Comparator benchmark is insufficient. |
| P2 scaling observation | Hot-problem statistics/XP updates, unpaginated enterprise exports and large profile histories | Realistic distributions and EXPLAIN/lock traces; preserve learning evidence correctness, pagination and authorization. No unsupported cache/shard rewrite. |
| P2 operations, UNVERIFIED | Dedicated executor host and configuration parity | Apply/verify CPU/PID/capability budgets on the isolated executor template; prove network/credential separation on intended hosts. Privileged same-host container is not VM isolation. |
| P2 operations, UNVERIFIED | Off-host backup/restore drill and migration rollout | Measure restoration and application recovery with synthetic dumps, failure cases and storage loss; plan transactional index lock time before any production migration. |
| P2 validation, PARTIAL | Sustained Redis disconnect/reconnect, worker/API restart under mixed traffic | Existing finite lifecycle/pipeline tests cover specified cases; extend to sustained load with reconciliation and data consistency metrics. |
| P2 supply chain, PARTIAL | Image CVE scan, SBOM and dependency-license governance | Review transitive artifacts/licenses and runtime image digests with an approved scanner; npm production audit alone is insufficient. Repository has no top-level license grant. |
| P2 provider behavior, PARTIAL | External AI/email reliability and policy | Deterministic rate-limit/timeouts/prompt-adversarial fixtures, consent and delivery semantics; real paid/secret-bearing calls require separate operational setup. |
| P2 browser quality, PARTIAL | Manual visual/a11y assessment and browser performance | Existing browser/layout/keyboard/mobile suites provide bounded evidence; no comprehensive WCAG audit or real device/field loading metrics. |
| P2 operations, UNVERIFIED | Production ingress/TLS/CDN/proxy and monitoring | Owner validates actual deployment topology, canonical worker API URL, secrets/rotation, alerts, host capacity and sandbox health. No production system was contacted. |
| P3 UX/product | Richer exports, learning/editor tools and operational dashboards | Validate user problem, define measurable acceptance tests and prioritize after correctness gates. No implementation claimed. |

## Required before final merge readiness

All feature PRs must pass applicable exact-head CI and independent review; combined migration/API and final full native/browser/pipeline/Compose CI must pass. No confirmed P0/P1 from this iteration may remain unresolved. Record current status in PROGRESS.md and FINAL-REPORT.md. Operational follow-ups remain distinct from reviewed code readiness; main is left for the user to review and merge.
