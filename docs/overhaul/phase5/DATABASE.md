# Phase V PostgreSQL/API qualification

## Disposition and exact scope

**IMPLEMENTED / LOCALLY TESTED. Independent review, remote CI and integration are separate gates recorded by the coordinator.**

The Phase IV source is `d0159b1f844bf0608415dded9e84af566c8e2041`,
with its existing final CI `43852089830`. Phase IV already tested the exact
5,000/5,001 CSV cap, snapshot consistency and 123-candidate pagination. Those
features are preserved. This increment adds bounded scale observations and
API regression assertions for their previously unmeasured compositions.

No new application defect was established by this work. No runtime SQL, index,
migration, authorization, rate limit, queue contract or application dependency
was changed. There is no Phase IV-to-V performance improvement claim. The
previous controlled trigger and first-page comparisons remain historical
observations with their original scope and tradeoffs.

| Added work | Verified contract |
| --- | --- |
| Deep HTTP results at the CSV cap | Page 100 returns the final 50 of 5,000 candidates, page 101 is empty, global score/status totals remain complete, and source/hidden fixtures/email remain absent |
| Revoked-token HTTP regression | A stale owner token is rejected before CSV or results service access; a freshly authenticated session reaches the resource-hiding 404 contract |
| SQL qualification harness | Existing page/summary/export/learning SQL executed against fixed larger synthetic fixtures with full `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` and exact correctness oracles |
| Distinct-solver statistics | 5,000 distinct accepted users for one problem match the full-recount and per-user multiplicity oracles |
| Large-source bulk transition | 256 rows with 32,768-byte deterministic synthetic sources transition from accepted to wrong answer; a reverse transition is rolled back, preserving authoritative rows and derived counts |
| Safety and evidence | Literal-loopback/test/opt-in preconditions, generated database names, bounded statements/temp files/database size/duration, sanitized failure report and owned-database cleanup |

This is qualification code and regression coverage, not a speculative rewrite
of a working database path.

## Immutable local execution

The final local harness ran at source commit
`f037d5c91f6b9cc5561fb46a3e7ed13d0289aa77`, complete tree
`01f16eb13077f3e12b99d34b14a5cca6b7057bef`, with an empty recorded dirty-path list.
The artifact also binds the harness and each measured application SQL/migration
source by SHA256. The measured application source remains identical to Phase IV.
Later documentation-only commits do not alter those measurements.

- [Complete raw local qualification](evidence/database-local-f037d5c.json):
  **PASS**, seven workloads, 31 migrations, all correctness oracles passed,
  generated database created and dropped, total **3,237.517 ms**.
- [Actual targeted API execution](evidence/database-targeted-api.txt):
  **26 tests in five files passed**, including the existing export/results/learning
  dashboard/learning-goal suites and the new export-revocation test.
- Backend lint and type checking passed. The two Node safety tests passed.
- A baseline run before adding assertions passed **25 tests in four files**.
  The 26-test candidate count includes those existing stories; it is not 26 new
  scenarios.

Environment: PostgreSQL **17.11**, Node **24.22.1**, Redis **8.10.3** for the API
suite, Linux **6.18.57**, AMD EPYC 9V74 host exposing nine logical CPUs.
PostgreSQL used 64 MiB shared buffers, 4 MiB default work memory, 30 maximum
connections, synchronous commit/fsync/full-page writes enabled and WAL
compression disabled. The harness uses a pool maximum of four; these read
samples are serial and do not measure pool saturation. All data and services
were disposable and task-owned. Binaries were reused read-only; no existing
cluster, existing Redis process or existing database was modified.

## Fixed limits and stop conditions

`Back/scripts/phase5-db-qualification.mjs` requires `NODE_ENV=test`,
`PHASE5_DB_QUALIFICATION=disposable`, and a plain PostgreSQL URL containing a
literal loopback host. Hostname resolution, remote targets, URL search/hash
connection overrides and missing credentials are rejected before database work.
The configured database is used only to create/drop a generated
`oj5_db_<32 lowercase hex>` database. It is never migrated or seeded.

The fixed fixture contains 5,000 candidates and 10,000 enterprise submissions;
20,000 learning submissions, exactly half inside the window; 5,000 distinct
accepted solver pairs; and 256 large-source rows, totaling 8 MiB of logical
large-source text. The owned database peaked at **33,035,955 bytes** in the local
run, below its 160 MiB checked limit. Table/row counts are not caller adjustable.

Each session has a 15-second statement timeout, 2-second lock timeout and
15-second idle-in-transaction timeout. A 32 MiB `temp_file_limit` is set on the
new database **before opening its pool**, so new connections inherit it; the
recorded session settings confirm that value. The bulk transition uses 64 KiB
work memory. The 180-second total timer requests cancellation only for queries
in the generated database, and stage guards stop further work. This is a soft
cancellation deadline, with statement timeouts and cleanup bounding the remaining
work; it is not an operating-system hard-kill deadline.

Signals follow the same cancellation/cleanup path. Cleanup never drops a
configured or caller-named database. Failure artifacts retain the stage and
error name/code without SQL parameters or connection URLs; reporting is still
attempted if disconnection fails. Abrupt machine loss remains outside what an
in-process `finally` block can guarantee.

## Measured current-source behavior

For each read: one untimed warmup, five serial query samples, complete result
checks and then a separate EXPLAIN execution. Times include PostgreSQL work,
driver transfer and result decoding; CSV construction/privacy checks run outside
the measured SQL interval. These are SQL observations, not end-to-end HTTP
latency, Judge throughput or production capacity.

| Workload | Rows returned | p50 ms | p95 / p99 ms |
| --- | ---: | ---: | ---: |
| First enterprise page, offset 0 | 50 | 3.557 | 4.367 |
| Deep enterprise page, offset 4,950 | 50 | 3.191 | 4.221 |
| Complete 5,000-candidate summary | 1 | 34.497 | 98.131 |
| Complete scalar export projection | 5,000 | 47.506 | 78.465 |
| 90-day learning view over 20,000 history rows | 1 | 19.047 | 21.631 |

With `n=5`, nearest-rank p95 and p99 both equal the observed maximum. The deep
page's slightly lower median in this one shared-host run does not show that deep
pagination is intrinsically faster. The 98.131 ms summary and 78.465 ms export
outliers remain in the raw evidence.

Every workload's five normalized result digests agree. The export's independent
oracle expects 2,500 scores of 50 and 2,500 scores of 100, average 75, and a CSV
containing all 5,000 data rows. Learning independently expects 10,000 in-window
submissions, 5,000 accepted submissions, nine distinct solved problems, eighteen
attempted problems, ninety daily entries and nine review entries. Source text,
password hashes, synthetic emails and private statements do not appear in the
result projections.

The 5,000-solver insert took **284.859 ms** in one observation. The complete
counter relation including its index occupied **638,976 bytes**; it also contains
the learning fixture's solver pairs, so this is not an isolated per-solver memory
cost. After the 256-row committed bulk rejudge, all solver/accepted counts were
zero and finished count remained 256. Reversing the verdict inside a transaction
restored the counts to 256, and rollback returned exactly to the committed zero
solver/accepted state.

That committed EXPLAIN transaction took **8.383 ms**, with **195,400 bytes** of
cluster-LSN WAL advancement. Its plan recorded eight temporary blocks written
and zero read at the top-level update node. TOAST references and trigger-internal
work mean these numbers do not establish total transition-table memory or all
internal temporary IO. The 8 MiB logical sources were present, but the test does
not claim 8 MiB were materialized in each transition table. WAL includes
checkpoint/concurrent-cluster effects if present and is not a write-amplification
comparison.

Client RSS grew during the qualification: query endpoints ranged from about
82.74 MiB during paging to **150.42 MiB** for the later learning samples. Export
endpoints reached about **146.75 MiB**. This is the Node measurement process,
which retains evidence/results between workloads; it is neither PostgreSQL RSS
nor production API peak RSS. Forced-GC, a controlled memory comparison and a leak
claim are absent. Per-sample client CPU and RSS, all plans, buffers, WAL and source
bindings are retained in the JSON.

## Failed attempts and corrections

The first new deep-page assertion mistakenly assigned the `n % 3` fixture's
active and expired remainders to the wrong categories. Actual database results
showed 1,667 finished, 1,666 active and 1,667 expired; the independent arithmetic
oracle was corrected. This was a test-authoring error, not an application fix.

A later added stale-token request was initially placed after all existing export
requests in the same fixture. It correctly hit the unchanged five-per-minute
export limiter and returned 429 before authentication. The [original failing
execution](evidence/database-auth-test-admission-failure.txt) is preserved.
The new revocation case now runs in its own ordinary integration-test app, using
the repository's existing per-file isolation. No rate limiter was removed,
throttle override added, timeout extended or expected failure relabeled as a
pass. The corrected five-file run passed all 26 cases.

## CI reproduction and remaining limits

After `npm ci --prefix Back` and `npm run build --prefix Back`, execute from
`Back` with an owned local/CI PostgreSQL service:

```sh
NODE_ENV=test PHASE5_DB_QUALIFICATION=disposable \
  DATABASE_URL=postgresql://test_user@127.0.0.1:5432/postgres \
  node scripts/phase5-db-qualification.mjs
```

The coordinator wires the safety tests and this execution into the existing
Backend job and preserves `Back/reports/phase5-database.json` on both success and
failure. Exact-head CI and independent review receipts are recorded on the
Phase V PR; this local result does not pre-approve them.

Still **DEFERRED_NONBLOCKING** in this bounded increment: histories well beyond
20,000 per learner, enterprise sets beyond the current export cap, long mixed
XP/queue/API contention, true pool exhaustion, production-scale distinct-solver
cardinality, long-term resource ceilings, PostgreSQL process CPU/RSS sampling
and a new controlled baseline/candidate performance comparison. Existing finite
race/rejudge regression suites remain part of required CI, rather than being
counted as new capacity measurements.

Production migration locking, backfill costs, backup size/RTO/RPO and live
operations require an approved representative environment and remain
**BLOCKED_EXTERNAL_ENVIRONMENT**. No production operation was attempted.
