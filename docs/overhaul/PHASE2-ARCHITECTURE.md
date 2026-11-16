# Phase II architecture and decisions

The React/Vite frontend, NestJS API, PostgreSQL, Redis/BullMQ worker and go-judge topology is retained. Measurements and reproduced failures justify focused changes; no microservice split, language rewrite or new paid service is introduced. Consult PHASE2-PROGRESS for integration state rather than assuming every described implementation is merged.

| Boundary | Previous behavior / problem | Implemented decision and practical limit |
|---|---|---|
| Learning shortlist | No persistent private bookmark collection | Authenticated idempotent save/remove/status and a user/problem unique relation; list queries preserve ordinary visibility/search/filter/pagination. Private state follows the account; hidden/withdrawn content remains inaccessible. |
| Enterprise problem versions | Current problem metadata/content could change between candidates and submissions | Pin the complete immutable algorithm-problem version when selected. Ordinary saves retain the binding; an explicit refresh before scheduled start selects the latest version. Statement, samples, limits, judging and rejudge use the same bound snapshot. |
| Exam state transitions | Invitation/deadline decisions could become stale while waiting; an initial fix introduced a withdrawal lock cycle | Lock in the reviewed user-before-test order; use a fresh test projection and database time after locking, then recheck invitation/session state. Actual contention tests reproduce the old failures and preserve Phase I submission/finish guards. |
| Owner / candidate metadata | Current catalog titles could leak a later private version or misdescribe pinned tests | Owner detail exposes a six-field selected-version projection after authorization; candidate submission detail only copies the submitted snapshot title. Missing required snapshots fail closed. No hidden test cases/editorial are included. |
| Owner result volume | All candidates and detail rows materialized at once | Default 50, maximum 100 candidates in deterministic order; whole-test score summary plus page details share one REPEATABLE READ transaction. Page bounds, retries and a missing-page recovery are visible in the UI. Global summary is still O(N); deep OFFSET and large Vibe detail costs remain unmeasured. |
| Frontend request ownership | Late requests could redirect a newer route/account; same-login token rotation could erase drafts | Login/route identities own requests and async completion. A token refresh preserves in-progress state for the same identity; new login/account/test resets it. Result pages keep loading/error/focus and stale-row guards. |
| Judge readiness | Heartbeat could precede a usable queue consumer | Readiness requires both Redis links; metrics are optional and acknowledged only after result persistence, without source or hidden test data. Worker generations/leases remain the authoritative fencing boundary. |
| Dependency and build identity | Vulnerable ORM transitive chain; npm-only audit missed actual shipping packages | Ordinary compatible TypeORM update, explicit production + complete lockfile audits, validated npm SBOMs, actual OCI inventory/scans and targeted image fixes. Main-module and host-kernel coverage limits are recorded explicitly. |

## Data and API contract

Bookmark uniqueness/FKs and enterprise version bindings are enforced by migrations and real PostgreSQL tests. Version migration validation covers rollback and invalid historical references; fixture isolation prevents other synthetic tests from changing expectations. Development data preservation was not required, but no production migration or data operation was performed.

Results pagination is an intentional API change: a client requiring every candidate must traverse pages. Whole-test summary semantics, rounding, pending/perfect counts and authorization are preserved and covered by equivalence checks. The before/after performance comparison therefore measures a useful first-page task with equivalent global summary, not byte-identical responses. Existing consumers and UI were updated together.

Selected-problem owner detail is an explicit whitelist. Current-catalog lookup only determines whether an owner can follow a source link; it is never the authoritative exam title, difficulty or limits. Invitation/list/results endpoints do not inherit the owner-only projection. Candidate pre-start responses still exclude question contents.

## Runtime and operations boundary

The API remains stateless at the request layer; durable submission/version/lease state is in PostgreSQL and queue delivery is in Redis. The new finite recovery tests use generated disposable databases and owned child processes/containers. Redis clean AOF restart, proxy link failure, API restart, worker loss and stale/duplicate callbacks are distinguished rather than treated as equivalent incidents.

go-judge still uses a privileged Linux container for namespaces/cgroups/seccomp. This is a trusted execution-host boundary, not VM isolation. No shared-runner escape experiment was performed. A minimal pinned-source rebuild retains upstream v1.13.3 behavior while updating its toolchain/dependency and redacting authentication logs; native regression and image evidence are required before integration. Header-package applicability cannot establish the patch level or security of the running host kernel.

## Deferred structural work

Popular-problem XP/statistic write contention, very large learning-history distributions, deep result offsets, prolonged mixed failures, native Vibe execution equivalence and field LCP/INP/CLS remain explicit follow-up areas. Current measurements do not justify sharding, a new cache consistency protocol or service extraction. The Phase I community indexes improve measured reads but add measured write latency/WAL/storage; PHASE2-PERFORMANCE retains both sides of that tradeoff.
