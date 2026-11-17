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

Raw environment, SQL, all timings/WAL/buffer samples, plans, constraints and source digest: [measurements/phase2-community-index-cost.json](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/measurements/phase2-community-index-cost.json).

Reproduce only against an explicitly owned disposable local PostgreSQL service:

```sh
npm run build --prefix Back
UNSOLVABLE_BENCHMARK=1 node Back/scripts/benchmark-community-indexes.mjs --with-writes
```

## Frontend delivery cost

The completed bookmark-only controlled build comparison is in [PHASE2-FEATURES.md](PHASE2-FEATURES.md). Initial entry gzip grew22 bytes; total emitted JavaScript gzip grew1,127 bytes at immutable feature35d9d77. These are file sizes and exclude later enterprise changes. They do not measure LCP, INP, CLS, browser main-thread CPU or memory leaks. Final combined bundle results, if measured, are a separate snapshot.

### Combined Phase II frontend snapshot

A fresh controlled build compares Phase I `c8ba9712d1a29ac633519511e50428ef647edf66`
with application composition local `b65c861eff79b0f7e795814d59e5904bf3aeb084`,
published as `d5dc5a9cfa627a505efeeac6458a7d9556b71e06`. Both worktrees were
clean and used the identical unchanged Front lockfile, Node24.22.1/npm11.9.0,
and `env -u VITE_SENTRY_DSN -u VITE_API_BASE_URL npm run build --prefix Front`.
This snapshot includes bookmarks, enterprise ownership/draft preservation,
selected-version metadata and bounded result navigation.

| Compressed artifact metric | Phase I | Combined Phase II | Change |
|---|---:|---:|---:|
| HTML module entry bytes | 381,317 | 381,551 | +234 |
| Entry gzip, level9 | 122,616 | 122,690 | +74 (+0.060%) |
| Entry Brotli, quality11 | 105,818 | 105,887 | +69 (+0.065%) |
| Total emitted JavaScript bytes | 1,462,761 | 1,470,378 | +7,617 |
| Total JavaScript gzip | 482,612 | 485,346 | +2,734 (+0.567%) |
| Total JavaScript Brotli | 410,297 | 412,793 | +2,496 (+0.608%) |

Totals sum separately compressed files, including lazy chunks and theme-init.js.
One fresh build per source measured deterministic artifact size; no build-time
or browser latency distribution is inferred. No heavy dependency was added to
Front. This is a measured delivery cost, not a claimed rendering speedup. Raw
per-file sizes/hashes and build provenance are in
[phase2-combined-frontend-bundles.json](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/measurements/phase2-combined-frontend-bundles.json).
LCP/INP/CLS and long-running browser CPU/memory remain N/A.

## Real authenticated owner-results HTTP

The bounded pagination change was measured against source `1011e35` before and `1b2b1e7` after, with the identical measurement script. Each condition uses a fresh owned PostgreSQL/Redis/API process. The sequence is before 1,000, after 1,000, after 5,000, before 5,000 candidates; the reverse order for the larger fixture reduces a simple warmup-order bias. Each fixture has two algorithm questions and one Vibe task with deterministic accepted, incorrect, missing and pending results. All global summaries and normalized first-50 result digests match.

Five requests warm the service. Three bursts each contain 20 requests at concurrency four, followed by one SQL-capture request. The real 100/minute ingress budget remains enabled, and no rate counter is cleared. Latency includes receiving and parsing the complete JSON response. The before response contains every candidate; the after response contains the first 50. This is an intentional API pagination change and a measurement of the first-page user task, not equal-byte serialization throughput or the cost of downloading every page.

| Median of three measured bursts | 1,000 before | 1,000 after | 5,000 before | 5,000 after |
|---|---:|---:|---:|---:|
| API p50 | 108.34 ms | 23.86 ms | 404.06 ms | 40.12 ms |
| API p95 | 167.82 ms | 33.80 ms | 521.46 ms | 60.77 ms |
| API p99 | 188.67 ms | 39.85 ms | 647.58 ms | 65.54 ms |
| Admitted burst RPS | 34.24 | 157.71 | 9.29 | 86.11 |
| API CPU per 20 completed requests | 590 ms | 120 ms | 2,250 ms | 160 ms |
| Complete response bytes | 746,019 | 38,065 | 3,731,355 | 38,068 |
| API peak RSS, maximum observed high-water mark | 342.79 MiB | 199.46 MiB | 462.00 MiB | 176.82 MiB |
| Errors / measured requests | 0/60 | 0/60 | 0/60 | 0/60 |

For 5,000 candidates, p95 falls 88.3%, p99 89.9% and measured API CPU per burst 92.9%. The three p95 samples span 477.76–671.19 ms before and 46.83–62.93 ms after. At 1,000 candidates the after p95 spans 32.97–86.55 ms; the median must not conceal that variation. A 20-request p99 is the sample maximum. These are finite admitted bursts, not sustained production RPS or a statistically established service-level objective. CPU and RSS cover the owned API child, excluding PostgreSQL, Redis and client.

Detailed result rows are bounded before per-candidate aggregation and Vibe loading. Whole-assessment statistics still inspect all candidates and remain O(N). Captured HTTP SQL statements increase from five to nine: authentication remains two, result reads increase from three to four, and the consistent `REPEATABLE READ` snapshot adds three transaction statements. At 5,000 candidates the captured detail query drops from 5,000 to 50 returned rows and from 56.080 to 3.113 ms; the new global-summary query takes 34.683 ms. These single EXPLAIN captures explain the work distribution and are not a separate query-latency distribution.

The fixture uses small synthetic reports. Deep offsets, large real workspaces, concurrent examiner writes, multi-API scaling and DB lock-wait distributions were not measured. Later benchmark edits add pre-connection safety validation; the raw records retain the original executed script hash. The positive measurement path was not retroactively relabeled with the final script hash.

Complete environment, application-tree hashes, raw requests, CPU ticks, SQL, plans, variation and equivalence evidence: [PHASE2-RESULTS.md](PHASE2-RESULTS.md) and [measurements/phase2-results-summary.json](measurements/phase2-results-summary.json).

## Real queue, worker and native execution

The accepted exact-head run is [43794094432](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43794094432), source `f1985dd19e3baf094bf82131250fb46bc5398941`, tree `7a4df22d030ec42f05651a4b021bb847573f226e`. All 12 jobs passed, including 74 native cases, 26 pipeline cases and two live Compose browser flows. Earlier failed admission-budget trials are not used as performance comparisons.

The runner reports four logical CPUs, AMD EPYC 7763, Linux 7.0.0-1017-azure and Node 24.22.2. Four mixed trials use one job in each of eight supported languages, one sample per job, concurrency one per worker, and alternating 1/2/2/1 worker counts after a Python warmup. Both configurations use the same implementation and runner. This measures scaling within Phase II; a Phase I-versus-II Judge speedup is **N/A**.

| Observed metric | One worker, two trials | Two workers, two trials |
|---|---:|---:|
| Eight-job burst throughput | 0.655–0.664 jobs/s | 0.719–0.767 jobs/s |
| Queue wait p50 | 0.500–1.795 s | 0.440–0.636 s |
| Queue wait p95/p99 | 11.577–11.693 s | 1.258–2.015 s |
| Submission HTTP p95/p99 | 60.58–65.73 ms | 63.99–70.20 ms |
| Aggregate Node-worker CPU per burst | 150 ms | 140–150 ms |
| Node-worker peak RSS per process | 107.79–108.19 MiB | 107.67–107.96 MiB |
| Accepted jobs | 16/16 | 16/16 |

Eight-job p95/p99 values are sample maxima. Admission pauses of 36.64 and 36.93 seconds occur outside timing and are retained in raw evidence; the real per-IP 20/minute limit is unchanged. Jobs/s is not sustainable arrival capacity. Node-worker CPU/RSS excludes the executor, compiler and solution processes; doubling workers roughly doubles that part of resident memory. API CPU/RSS is not reported because the API shares the test harness in this scenario. Compile-only overhead, executor CPU/RSS and whole-host efficiency remain **N/A**.

The same run observes Redis-link recovery in 2.44 seconds, API-link retry in 3.03 seconds, a two-worker duplicate with one execution, and real SIGKILL/natural-lease recovery at 77.42 seconds (final result at 79.72 seconds, one recovery, stale callback 409). The separate owned API process restart takes 1.55 seconds and completes three accepted submissions in 8.16 seconds with XP 10 once. Link disruption is distinct from a Redis daemon restart; the later restart/rejudge follow-up has its own evidence and is not inferred from these measurements.

Exact raw records and hashes are committed under [evidence/judge-run-43794094432](evidence/judge-run-43794094432/provenance.json). [PHASE2-JUDGE.md](PHASE2-JUDGE.md) defines verdict coverage and limitations.

## Explicit unmeasured domains

Production-sized mixed concurrent writes, full-platform CPU/RSS, distributed queue clocks, cold-cache API capacity, sustained load, long-duration failure combinations and real-user browser vitals remain unmeasured. Current evidence supports the stated bounded improvements and recovery cases, not an extreme-scale production capacity claim.

## Rebuilt runtime: additional accepted capacity observation

The accepted image source `0e70a2fe6d725362bcb248836c3697d310e16742`
was measured again in full CI43805214804. The original artifact, four JSON
records, exact source/checkout/tree and independent review are retained in
[evidence/judge-run-43805214804](evidence/judge-run-43805214804/provenance.json).
This is an additional same-code worker-scaling observation. It is not a
controlled comparison with run43794094432 or a Phase I/II speedup.

Environment: Node24.22.2, Linux7.0.0-1017-azure, four logical CPUs reported as
AMD EPYC9V74 on a shared Actions runner. Each trial submitted eight actual
accepted languages through HTTP/PostgreSQL/BullMQ/worker/go-judge/callback,
after Python warmup, in1/2/2/1-worker order. Normal20/min admission pauses
remain outside each timed burst. Two trials per worker count supply these
observed ranges; p95/p99 are eight-sample maxima.

| Metric | One worker | Two workers | Scope |
|---|---:|---:|---|
| Jobs/s | 0.795–0.815 | 0.910–0.942 | Admitted finite burst |
| Queue wait p50 | 1.373–1.410s | 0.122–0.375s | Two trial medians |
| Queue wait p95/p99 | 1.881–9.407s | 1.209–1.299s | Sample maxima; one-worker variability retained |
| HTTP submission p95/p99 | 30.86–62.25ms | 53.93–58.27ms | Sample maxima, not all API traffic |
| Worker CPU per eight jobs | 100–110ms | 110–140ms | Aggregate Node-worker procfs deltas |
| Per-worker peak RSS | About107MiB | About107MiB each | Two processes roughly double this part of RSS |
| API-only or compiler/executor CPU/RSS | N/A | N/A | Harness shares API; compiler/executor not measured |

The broader single-worker queue range reinforces why these data must not be
presented as steady-state tail estimates or a causal runtime-image speedup.
All jobs completed; duplicate/stale/recovery assertions passed in the same
finite run. Long-duration saturation, production hardware and isolated
compiler/executor profiling remain unmeasured.
