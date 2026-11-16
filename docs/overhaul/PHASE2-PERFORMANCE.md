# Phase II performance evidence

Measurements below have separate scopes. A smaller response, a warmed SQL plan, a frontend bundle size, an admitted Judge burst and sustained whole-service capacity are different quantities. No historical Phase I number is reused as a fresh Phase II result.

## Independent index recheck and write cost

The Phase I user-first community relationship indexes were retained. A fresh run compared the same database with those two indexes absent and then applied the actual production migration `1795700000000`. This isolates the index effect; it is not a comparison of entire old/new deployments.

Source: `276b1a04b5d4e4f9219768a7751449a44452c870`, `Back/scripts/benchmark-community-indexes.mjs --with-writes`. An independent reviewer checked the immutable script delta, exact fixture row accounting, measurement boundaries and unchanged effective-loopback/owned-database guards before results were accepted.

Environment: Linux6.18.57, AMD EPYC9V74, nine visible logical CPUs (not a claim of nine dedicated cores), Node24.22.1, PostgreSQL17.11, 64MiB shared buffers, 4MiB work_mem, max_connections100. The local HTTP measurement was deliberately held until this run finished; no concurrent root build/load was scheduled. Shared-host noise is still possible.

Dataset: 10,000 users, 2,000 posts, 200,000 votes and 200,000 saves. Single connection/concurrency1; three warmups and seven measured samples per mode/operation. The read SQL is captured from the actual `CommunityService.mine` implementation. All ordered results match by SHA-256. SQL read plans were warmed, with zero shared-read blocks.

| Database execution median | Without indexes | With indexes | Difference |
|---|---:|---:|---:|
| Voted profile query | 9.358 ms | 1.414 ms | −84.9% |
| Saved profile query | 8.420 ms | 1.312 ms | −84.4% |
| Insert 1,000 votes | 15.942 ms | 19.440 ms | +21.9% |
| Insert 1,000 saves | 17.125 ms | 20.878 ms | +21.9% |
| Delete 1,000 votes | 5.507 ms | 6.438 ms | +16.9%, overlapping ranges |
| Delete 1,000 saves | 5.948 ms | 5.193 ms | −12.7%, overlapping ranges |
| INSERT plan WAL bytes, either table | 175,064 | 263,064 | +50.3% |
| DELETE plan WAL bytes, either table | 54,000 | 54,000 | unchanged in these samples |

The inserts actually commit 1,000 distinct new relations, verify201,000 rows, then delete the same relations and verify200,000 rows. They do not rely on rolled-back inserts that leave accumulating index entries. VACUUM/ANALYZE/INDEX_CLEANUP happens outside timing. The seven insert ranges were15.274–24.833→18.806–23.603ms for votes and14.795–23.634→18.736–22.312ms for saves. Delete ranges overlap and include outliers; the differing delete medians are not a demonstrated general speedup/regression.

The raw artifact also records whole SQL-call time, including driver/EXPLAIN serialization/commit: insert medians17.130→20.857ms and18.989→22.076ms. EXPLAIN WAL bytes describe the plan, not complete cluster/device write amplification. CPU/RSS and concurrent database lock wait were not measured in this experiment.

The two indexes each occupy9,961,472 bytes. Combined creation took205.54ms on this uncontended fixture. That does not predict production migration lock duration: ordinary transactional CREATE INDEX can block writes, and a populated deployment still needs a migration/rollback rehearsal. The extra index improves the measured read path while adding measurable write/log cost. There is no basis here to remove it or to add more indexes without workload evidence.

Raw environment, SQL, all timings/WAL/buffer samples, plans, constraints and source digest: [measurements/phase2-community-index-cost.json](measurements/phase2-community-index-cost.json).

Reproduce only against an explicitly owned disposable local PostgreSQL service:

```sh
npm run build --prefix Back
UNSOLVABLE_BENCHMARK=1 node Back/scripts/benchmark-community-indexes.mjs --with-writes
```

## Frontend delivery cost

The completed bookmark-only controlled build comparison is in [PHASE2-FEATURES.md](PHASE2-FEATURES.md). Initial entry gzip grew22 bytes; total emitted JavaScript gzip grew1,127 bytes at immutable feature35d9d77. These are file sizes and exclude later enterprise changes. They do not measure LCP, INP, CLS, browser main-thread CPU or memory leaks. Final combined bundle results, if measured, are a separate snapshot.

## Judge and HTTP evidence checkpoints

The exact Judge scenario and metric definitions are in PHASE2-JUDGE.md when that PR is integrated. Worker CPU/RSS refers to the owned Node worker PIDs, not the sandbox/compiler/go-judge service or whole host. Eight-job trial p95/p99 values are sample maxima; jobs/s applies to admitted bursts, with rate-limit pauses outside that interval. One-versus-two-worker scaling is not a Phase I-versus-II speedup.

The separately implemented owner-result pagination benchmark uses actual HTTP/API/PostgreSQL execution and records global-summary equivalence, response bytes, p50/p95/p99, bounded RPS/error counts and owned API resources. Its results will be linked only after execution/review. No throughput or latency values are prefilled in this document.

Production-sized mixed concurrent writes, full-platform CPU/RSS, distributed queue clocks, cold-cache API capacity, long-duration failure load and real-user browser vitals remain distinct unmeasured domains unless later exact evidence explicitly closes them.
