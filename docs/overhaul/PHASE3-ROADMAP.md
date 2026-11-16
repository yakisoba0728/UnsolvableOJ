# Phase III scope and continuation roadmap

Recovery on 2026-11-16 established **Case A**: Phase II implementation, final
handoff and its final full CI were already complete. The immutable recovery
receipt is [PHASE3-BASELINE.md](PHASE3-BASELINE.md). The coordinator did not reset
the integration branch or recreate bookmarks, algorithm version pinning,
enterprise result pagination, queue recovery or earlier security fixes.

## Bounded implementation scope

The recovery admitted the learning dashboard, immutable Vibe assessment contract
and dedicated executor transport/configuration work. Source inspection then
confirmed the hot-problem recount bottleneck; the bounded statistics migration
and controlled SQL comparison were added to [tracking issue #72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72).
The browser measurement probe supports validation of that scope. It does not add
another product feature or turn this iteration into an unlimited redesign.

| Work | Acceptance boundary | Primary record |
| --- | --- | --- |
| Private learning dashboard | Authenticated 7/30/90-day SQL aggregation, visibility/ownership exclusion, real UI, late-request protection, three browser engines and actual Compose API/Judge assertions | [#73](https://github.com/yakisoba0728/UnsolvableOJ/pull/73), [learning contract](PHASE3-LEARNING.md) |
| Executor hardening | Verified TLS/mTLS, dedicated-mode validation, readonly worker, exact rendered topology/secret checks and real Redis/BullMQ negative transport tests | [#74](https://github.com/yakisoba0728/UnsolvableOJ/pull/74), [security boundary](PHASE3-SECURITY.md) |
| Vibe consistency | Immutable selected content/model, preserved project files, explicit refresh, migration/rollback guards, server-only fixtures, UI and native execution tests | [#75](https://github.com/yakisoba0728/UnsolvableOJ/pull/75), [Vibe contract](PHASE3-VIBE.md) |
| Problem-statistics scalability | Equivalent current-verdict counts, atomic statement deltas, actual lock races, reversible schema, same-work before/after evidence including regressions | [#76](https://github.com/yakisoba0728/UnsolvableOJ/pull/76), [database evidence](PHASE3-DATABASE.md) |
| Final validation | Separate source reviews; full CI on each current feature/base combination; full final integration CI; durable raw measurements and resume instructions | [final PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63), [validation](PHASE3-VALIDATION.md) |

Implementation, local testing, independent review, exact-source CI and integration
are separate states. Feature PR conversations and the final PR receipt identify
the actual source, merge checkout, integration commit and run. A historical green
run does not certify a later head.

## Remaining work, ordered by operational consequence

| Priority / state | Remaining work | Required evidence before claiming completion |
| --- | --- | --- |
| P1 / BLOCKED on a suitable owned environment | Actual executor VM/host separation, host kernel patching, private firewall/egress/Redis ACLs and privilege boundary | Dedicated safe environment, explicit infrastructure scope, observed host/network configuration and non-destructive isolation checks. No shared-runner sandbox escape experiment. |
| P1 / time-bound follow-up | Re-evaluate Runtime component applicability before **2026-11-30 00:00 UTC**, or immediately after relevant image/package/advisory changes | Fresh image inventory and scanner DB, exact component/reachability evidence, new review decision. No automatic extension and no claim that HIGH177/CRITICAL5 equals zero. |
| P2 / DEFERRED | Sustained eight-language mixed Judge load, multiple APIs/workers, repeated network faults, resource pressure and safe stop/resume | Finite isolated load plan; jobs/s, queue p50/p95/p99, CPU/RSS, errors/retries, consistency and resource cleanup. Existing short recovery scenarios are retained, not counted as new long-duration proof. |
| P2 / DEFERRED | All-language/all-verdict memory semantics | Representative compiler/runtime failures and pressure cases on a suitable host. Managed-runtime allocation failure must not automatically be relabelled MLE. |
| P2 / DEFERRED | Large distinct-solver cardinality, large source-code transition tables, bulk spill, XP contention, pool/lock/WAL/storage behavior | Representative bounded fixtures and same-work comparisons. The present short SQL experiment uses 200 users, short source strings and at most four clients. |
| P2 / DEFERRED | Production migration rehearsal | Drain old Vibe writers, rehearse both new migrations on a disposable representative copy, measure lock/backfill/storage cost, verify rollback refusal. This project has not performed a production migration. |
| P2 / DEFERRED | Whole-site visual/accessibility audit and frontend architecture follow-through | All routes/states and assistive/keyboard flows, large-history consumers, real-device measurements and long editor sessions. Inventory of 29 existing page modules is not a completed visual audit. |
| P2 / DEFERRED | Field LCP/INP/CLS and sustained frontend memory | Privacy-preserving field collection or explicitly approved device lab. Three warm CI visits and 15 scripted switches cannot establish field INP, population tails or leak freedom. |
| P2 / DEFERRED | Broader Vibe evaluation quality and deployment parity | Supported protocol evolution, provider/model-alias behavior, cost/rate budgets and failure UX. Stored model identifiers do not freeze provider weights or make AI output deterministic; no paid provider call was made. |
| P3 / DEFERRED | Further enterprise analytics/export, admin operations UI and learning features | A separately bounded user problem, authorization/data contract, implementation, tests and independent review. Do not register already-shipped Phase II features as new work. |

The dedicated algorithm-worker template does not move the API's Vibe execution
path onto a separate machine. The existing combined production Compose remains a
development/deployment template requiring its own operational isolation decision.
Code integration readiness and production deployment readiness are different.

## Exact resume procedure

1. Read the newest receipt on [PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63)
   and the latest checkpoint on [issue #72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72).
   Re-query actual `main`, `overhaul/integration`, open PRs/issues and active runs.
   Prefer current GitHub state over any older document checkpoint.
2. Fetch the repository and create a new feature branch from the **current**
   `origin/overhaul/integration`. Never reset it to the recovery baseline.
   Do not overwrite another contributor's branch or force-push.
3. Read this roadmap, the final report/validation receipt and the component
   documents relevant to the selected remaining item. Preserve Phase I/II work.
4. Install locked dependencies. Build before API suites that spawn compiled seed
   CLIs; do not run a deleting Nest rebuild concurrently in the same worktree.
   Use fresh owned PostgreSQL/Redis/Compose resources only. Native, browser and
   image checks require their actual supported environment.
5. Reproduce the selected issue, make a small scoped change, retain meaningful
   regressions, and obtain a reviewer separate from its implementation author.
6. Open the feature PR against `overhaul/integration`; require exact-head CI and
   the applicable native/browser/image gates. Update/revalidate on new integration
   changes. Record source SHA, tree, merge checkout, run and actual result.
7. Merge only verified work into integration. Re-run full final integration CI
   and update the existing final PR receipt. **Leave `main` and PR #63 unmerged.**

Do not use operational data as disposable fixtures, add paid services, make paid
AI calls, or loosen a failing gate to obtain a green result. If a new environment
or permission is actually required, record the concrete blocked action and keep
independent authorized work moving.
