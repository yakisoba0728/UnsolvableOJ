# Phase III: bounded problem-statistics write cost

## Scope and contract

The baseline is integration commit `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`.
Phase II's problem-list statistics remain the API contract. This change addresses
the database trigger's full-history recount on every terminal submission write.
It does not change XP awards, retained learning evidence, Judge verdicts, problem
visibility, enterprise scoring, API responses, or authorization.

Migration `1796100000000-incremental-problem-stats.ts` replaces that recount with
statement deltas. The original recount function remains intact for migration
rollback and the controlled comparison. Existing Phase II code is preserved.

The contract remains:

| Field | Meaning |
| --- | --- |
| `solver_count` | Distinct users with at least one current, non-test `ACCEPTED` submission |
| `accepted_count` | Current non-test `ACCEPTED` submissions, including multiple submissions by one user |
| `finished_count` | Non-test submissions outside `QUEUED`, `JUDGING`, `SYSTEM_ERROR`, and `CANCELLED` |

An accepted verdict changed by rejudging can therefore reduce the current solver
count. The separate solve/XP ledger and retained learning-completion evidence
have different semantics and are deliberately not used for these counters.
The solve/XP ledger is not immutable: rejudging the credited submission can revoke
the solve and its XP when no qualifying alternative remains. An ordinary later
wrong submission does not itself revoke an earlier credited acceptance.

## Implementation and concurrency

`problem_solver_counts(problem_id,user_id,accepted_count)` stores one positive
multiplicity for each currently accepted problem/user pair. Its primary key is
`(problem_id,user_id)`. Reaching zero removes the row. A newly positive pair adds
one solver; another accepted submission for an existing pair adds no solver.
The count constraint requires positive values. `problem_stats` also enforces
`0 <= solver_count <= accepted_count <= finished_count`.

Separate `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` statement triggers use
PostgreSQL transition tables. Old contributions are negative; new contributions
are positive. They are grouped by problem/user before applying changes. This
handles bulk writes and direct problem/user reassignment without assuming that a
row trigger sees one newly changed row at a time. A separate `AFTER TRUNCATE`
trigger clears both derived tables when all submissions are removed.

Every affected problem-statistics row is locked in UUID order before any
multiplicity changes. Updates for one hot problem still serialize on its existing
statistics row. Work inside that lock depends on changed pairs, rather than the
problem's total submission history. This is not a claim that arbitrary multi-
statement transactions are deadlock-free, or that XP/user-row contention is fixed.

The multiplicity foreign key references `problem_stats(problem_id)`, which the
trigger has already locked. Referencing `problems(id)` directly would introduce
a statistics-to-problem lock when a new solver counter is inserted. The author
found that additional lock edge during review and corrected it before proposing
integration; a real concurrent regression test holds the problem row locked while
another transaction completes a new solver's submission.

There is intentionally no user foreign key on this internal derived table.
The authoritative `submissions.user_id` foreign key is unchanged. Physical user
deletion cascades through submissions, whose delete transition removes the
corresponding multiplicities. A new user foreign key would acquire a user lock
while holding the statistics lock, reversing the user-deletion lock order.
The regression suite holds a user row locked, commits a separate verdict update,
then deletes the user and checks that no multiplicity remains.

The existing restriction on deleting a problem with submission history remains.
After explicit disposable-history cleanup, deleting the problem cascades through
its statistics row to the counter table. No user-facing deletion permission is
added.

Count-equivalent writes perform no statistics or counter updates. However, an
UPDATE transition-table trigger also executes for unrelated updates such as lease
heartbeats. That adds fixed processing overhead compared with the old trigger's
`UPDATE OF status,is_test` restriction. Heartbeat costs and small-history costs
are measured and reported with the improvement for large histories.

## Migration and rollback

Both directions require an active transaction and obtain `SHARE ROW EXCLUSIVE`
locks on `submissions` and `problem_stats`, in that order. Upgrade first reconciles
the existing statistics from authoritative submissions, including missing legacy
statistics rows, and then fills the new multiplicities. The new foreign key thus
never depends on an unrepaired parent cache.

Upgrade includes a full-history read and blocks submission writers. It is **not
an online production migration**. A deployment plan must drain or pause writers,
bound lock acquisition, and measure backfill time/storage on a representative
disposable copy. Only isolated development/test databases were migrated here.

Rollback removes the new triggers and derived table, removes the new consistency
constraint, and restores the original recount trigger. It preserves submissions,
users, problems, XP, and existing correct aggregate values. The dedicated test
performs down/up/down/up over populated history inside a transaction and checks
the original statistics and a full-recount oracle. The repository's full migration
runner additionally exercises installation, historical upgrades, rollback guards,
fresh rollback, and reapplication.

Direct privileged edits to either derived table are not an application contract.
An inconsistent negative multiplicity aborts the write instead of silently
returning incorrect counts; repair requires reconciliation under an appropriate
writer lock. This change does not add a production repair endpoint.

## Verification record

Code revision: `0db44816f533a69ef0297ba427e4ca28451a17f2` (following implementation
commit `9ccc50647229f386a2f5cf8bfc5185e80d3bdf45`).

Author checks completed on the revision:

- Backend lint, type checking, all 320 unit tests, and production build.
- Eleven dedicated real-PostgreSQL tests: every verdict and test flag; bulk
  rejudging and deletion; 160 deterministic mixed/bulk mutation steps with a full
  recount after every step; unchanged aggregate tuple identity for irrelevant
  updates; blocked concurrent completions; stable multi-problem lock order;
  insert versus delete for one solver with commit and rollback; physical-user
  deletion; locked-problem/new-solver completion; transactional truncate;
  problem-history deletion restrictions; and populated migration/repair/rollback.

- All 220 PostgreSQL/API tests passed in the stable-build run (36 files,
  88.89 seconds). The full migration runner passed historical upgrades, evidence
  and rollback guards, fresh installation, complete fresh rollback, and reapply.
- A separate reviewer built `0db4481` in another worktree and passed the eleven
  repository tests plus two independent probes (13 total): first-stat-row
  creation races with the preceding writer's commit or rollback, and atomic
  rejection of a verdict write after deliberate multiplicity corruption.
  Those two independently authored probes are preserved unchanged as
  `Back/test/incremental-problem-stats-races.e2e-spec.ts` so future CI runs them.

Exact remote CI remains a separate gate; the coordinator records its immutable
commits and run URLs before integration.

An initial full API attempt overlapped a Nest rebuild in the same worktree. Nest
temporarily removed `dist`, so three existing seed-CLI tests could not import the
compiled datasource. The implementation gates were unchanged. The stable-build
rerun is sequential: build first, then API tests and migration checks. No compiled
output is rebuilt while a suite that spawns the seed CLIs is running.

## Controlled performance method

`Back/scripts/benchmark-problem-stats.mjs` requires `NODE_ENV=test`,
`UNSOLVABLE_BENCHMARK=1`, a literal loopback PostgreSQL address, and no connection
query overrides. It creates a uniquely named database, migrates and seeds that
database only, then drops that same database in `finally`. The configured database
is only the connection used to create the disposable database.

The finite fixture sizes are 1,000, 10,000, and 50,000 historical submissions for
one problem, 200 synthetic users, and 64 separately identified target submissions.
Historical verdicts are 70% accepted and 30% wrong answer, with 140 historical
solvers in each size. Larger history size does not imply larger solver cardinality
in this fixture.
Both modes use identical data and SQL. Each fixture runs the original recount,
incremental, incremental, original recount sequence. Every workload is checked
against a full-recount oracle; incremental multiplicities are also checked against
the authoritative submissions. Three warmup cycles per database connection and
explicit vacuum/analyze occur outside timing. Fixture autovacuum is disabled;
server durability settings remain enabled and are included in the evidence.

Each mode has two rounds of these workloads:

| Workload | Fixed work per round | Reported latency unit |
| --- | --- | --- |
| Serial completion | 64 committed `JUDGING` to `ACCEPTED` updates, one client | One update |
| Concurrent completion | Same 64 updates, four clients on separate target rows | One update, including lock/commit/driver time |
| Bulk rejudge cycle | Seven pairs of 64-row `ACCEPTED` and `JUDGING` updates | One two-statement cycle, 128 changed rows |
| Heartbeat only | 64 committed lease/time updates while `JUDGING` | One update |

The script captures every sample, p50/p95/p99, elapsed time, PostgreSQL process
CPU ticks, endpoint RSS, Node client CPU, cluster WAL insert-LSN differences, and
derived-table size. PostgreSQL CPU has 10 ms clock-tick granularity in this
environment; endpoint RSS is not peak memory. WAL includes trigger writes but may
include checkpoint/full-page effects; the raw per-round values are retained.

This is a comparison of the **database write path**, using the original trigger
on the current schema. It is not HTTP throughput, Judge jobs/s, queue-wait timing,
XP-award throughput, a complete old-application deployment, or production sizing.
The runtime is a shared cloud host; other host load and physical page/cache state
are not fully controlled. Cross-over rounds mitigate order bias without making
the run a statistically powered production SLO test. Long-duration stability,
larger concurrency, database pool exhaustion, and very large distinct-solver
cardinality remain separate work. The fixture source is the short string
`fixture`; transition-table memory/spill behavior for very large source code and
large bulk updates was not measured. Endpoint RSS cannot establish that bound.

The pre-correction `9ccc506` run is retained only as an exploratory check outside
this report's final performance evidence. All final performance claims must use
the corrected migration hash recorded by the final benchmark artifact.

## Final measured results

Final raw evidence: [phase3-problem-stats.json](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/measurements/phase3-problem-stats.json).
An independent reviewer recomputed all quantiles, throughput values, pooled CPU
and WAL totals, per-round oracle digests, and all three source hashes against
`git show 0db4481`; the [independent calculation record](evidence/phase3-database-benchmark-review.json)
confirms agreement for all twelve rounds. No initial-run results are substituted.

The final run used PostgreSQL 17.11, Node 24.22.1, 64 MiB shared buffers, 4 MiB
work memory, synchronous commit/fsync/full-page writes enabled, and WAL compression
disabled. The shared Linux environment exposed nine logical CPUs from an AMD EPYC
9V74 host. Recorded one-minute host load was 1.36 at the start and 2.89 at the end.
One attempt immediately before this run failed to create its temporary directory
because the shared filesystem reported `ENOSPC`. It never started PostgreSQL or
measured any write. The identical retry completed after free space recovered;
no external files or production resources were deleted to make it pass.

Latency below is in milliseconds. Each ordinary workload has 128 samples per
mode (two rounds of 64); the bulk workload has 14 cycles per mode. Consequently,
bulk nearest-rank p95 and p99 are both the observed maximum, not a reliable estimate
of a long-run tail. All samples, including the 121.23 ms incremental bulk outlier,
remain in the evidence.

| History | Workload | Before p50 | After p50 | Before p95 | After p95 | Before p99 | After p99 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Serial completion | 1.014 | 1.038 | 1.418 | 1.509 | 2.391 | 1.903 |
| 1,000 | Concurrent completion | 2.698 | 2.259 | 7.788 | 7.051 | 10.533 | 10.243 |
| 1,000 | Bulk rejudge cycle | 57.011 | 7.343 | 196.646 | 10.064 | 196.646 | 10.064 |
| 1,000 | Heartbeat only | 0.515 | 0.714 | 0.932 | 1.078 | 1.707 | 2.127 |
| 10,000 | Serial completion | 4.552 | 0.901 | 6.290 | 1.130 | 8.264 | 1.244 |
| 10,000 | Concurrent completion | 13.753 | 2.392 | 45.801 | 9.218 | 73.536 | 13.503 |
| 10,000 | Bulk rejudge cycle | 460.811 | 8.299 | 703.904 | 11.006 | 703.904 | 11.006 |
| 10,000 | Heartbeat only | 0.434 | 0.694 | 0.584 | 0.966 | 0.757 | 1.244 |
| 50,000 | Serial completion | 30.952 | 1.137 | 55.389 | 2.269 | 174.645 | 4.348 |
| 50,000 | Concurrent completion | 85.039 | 2.782 | 343.766 | 5.715 | 576.107 | 7.625 |
| 50,000 | Bulk rejudge cycle | 3,831.966 | 10.223 | 4,998.534 | 121.228 | 4,998.534 | 121.228 |
| 50,000 | Heartbeat only | 0.452 | 0.884 | 0.740 | 1.213 | 1.182 | 2.195 |

For the 50,000-row fixture, serial completion p95 fell 95.9% and concurrent
completion p95 fell 98.3% within these fixed workloads. The four-client workload
completed its 128 pooled updates at 30.58 versus 1,188.38 **SQL updates/second**.
Those are committed database updates, not full judge jobs or API requests.

The regression tradeoffs are explicit: at 1,000 history rows, serial p95 rose
6.4% (1.418 to 1.509 ms), and heartbeat p95 rose at every tested size. At 50,000
rows the heartbeat increase was 63.8% (0.740 to 1.213 ms). The redesign is justified
by the bounded hot-problem and bulk-write cost; it is not uniformly faster for
every statement or a zero-overhead cache.

For the largest fixture, CPU and WAL totals cover both measured rounds of each
mode. Completion/heartbeat totals each cover 128 updates; bulk covers 14 cycles,
or 1,792 changed rows. CPU is summed across the participating PostgreSQL processes.

| Workload | Before PostgreSQL CPU ms | After PostgreSQL CPU ms | Before WAL bytes | After WAL bytes |
| --- | ---: | ---: | ---: | ---: |
| Serial completion | 4,660 | 90 | 112,864 | 101,800 |
| Concurrent completion | 4,150 | 120 | 97,640 | 99,456 |
| Bulk rejudge cycle | 55,040 | 220 | 1,372,208 | 1,054,848 |
| Heartbeat only | 40 | 70 | 69,536 | 69,496 |

WAL did not improve in every workload: concurrent completion wrote approximately
1.9% more WAL. Counter maintenance adds writes, while avoiding the old aggregate
upsert/recount updates can remove other writes. Full-page and checkpoint effects
also affect these short-run values. No universal write-amplification reduction is
claimed.

The new counter relation occupied 65,536 bytes including its index in each measured
fixture after reset, with 140 live solver pairs. Storage grows with distinct
accepted problem/user pairs, not just with the number of problems. At 50,000
history rows the sampled database-process RSS endpoints ranged from 35,252 to
57,324 KiB across both modes; the same backends and shared buffers were reused.
This does not isolate a memory saving or establish peak/long-term memory bounds.
The single uncontended 50,000-row upgrade took 47.85 ms in this fixture; it is not
a production migration or lock-duration estimate.

## Reproduction and continuation

Use an owned disposable PostgreSQL server with `CREATEDB`, matching the recorded
server settings when comparing numbers. From `Back`, after `npm ci` and
`npm run build`:

```sh
NODE_ENV=test UNSOLVABLE_BENCHMARK=1 \
  DATABASE_URL=postgresql://test_user@127.0.0.1:5432/postgres \
  node scripts/benchmark-problem-stats.mjs \
  --output=../docs/overhaul/measurements/phase3-problem-stats-rerun.json
```

The benchmark is capped at three fixtures of at most 50,000 historical rows each,
four database clients, a 30-second statement timeout, and a 10-second lock timeout.
It never seeds or drops the configured database. Test fixture source, row counts,
warmup/round ordering, raw timings, and source hashes are included in its output.
Do not overwrite the recorded evidence with a different revision or environment;
keep reruns separate and explain the comparison.

Next work remains: representative large solver cardinality; large-source and bulk
transition-table memory/spill behavior; longer mixed API/XP/Judge workloads; and
production rollout planning without applying that rollout. The coordinator must
run the full required CI on the final feature/integration heads and keep the main
PR unmerged. These local database results do not replace those gates.
