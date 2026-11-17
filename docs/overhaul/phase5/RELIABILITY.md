# Phase V recovery and rollback evidence

## Accepted actual restore and integration — PR91

**INDEPENDENTLY_REVIEWED / CI_VERIFIED / INTEGRATED into Phase V integration.**
[Run 43905864054, attempt 1](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054)
passed all twelve required jobs. The
[independent acceptance receipt](evidence/reviews/backend-pr91-independent-review.json)
binds PR91 source `281d0f1a30cd772cf7417e3affb8c98be252f405`, Actions checkout
`9aa843fad33b30270ab346bc62c4865c17697ff3` and base
`e8b08d6ab86181859d9491d15d1881a6b10262eb`. Source, checkout and integration
merge `a6588f7bedc87228c11852d8664fe20ec6b3ece3` have the same complete tree,
`0f191c89a17b984cae8706cb02137ab0e4e2c3a4`.

The [original schema-2 restore report](evidence/backend-run-43905864054/phase4-restore.json)
is **PASS**. This is the actual guarded Docker `pg_dump`/`pg_restore` execution,
superseding the earlier CI-pending checkpoint below:

| Executed check | Actual result |
|---|---|
| Fresh migration chain and legitimate empty rollback/reapply | All 31 migrations; both stages passed |
| Populated fixture | 128 users, 24 problems, 2,056 submissions, 12 goals, 24 problem versions, 128 solves, eight assessment candidates/workspaces and sixteen Vibe revisions |
| Stop-writer barrier | `SHARE` across all 37 public tables; a concurrent write was refused; barrier held through the dump |
| Restored state | All 37 table counts/digests equal, schema comparison passed, restored migration ledger complete |
| Populated downgrade and restored writes | Goal rollback refused with fingerprints/schema/products retained; restored verdict/statistics and goal-update checks passed |
| Source / restored database bytes | 11,278,003 / 11,589,299, each below 64 MiB |
| Custom archive | 270,084 bytes; SHA256 `4b7b3024c42252b5048195635c2d6849154306dbedc2b1929ab6ae1c475e3b36` |
| Timings | Dump 124.624 ms; restore 142.817 ms; whole rehearsal including cleanup 1,027.631 ms |
| Cleanup | Both generated databases removed before PASS |

The [independent backend checks](evidence/backend-run-43905864054/backend-independent-checks.json)
verify the immutable source, original report hash, limits, product oracles,
stage outcomes and actual hosted test log. The corrected `e9bc90d` migration
source is carried forward exactly; all **five rollback-guard regressions**
passed within the **261-case real PostgreSQL API suite**. The complete migration
regression also passed, closing **P5-RELIABILITY-001** for this accepted source.

The archive bytes and databases were deliberately not retained. The preserved
JSON contains archive size/SHA256, table counts/digests, the schema-comparison
method and stage evidence. Equality and write/refusal outcomes rely on the
reviewed source assertions and their successful hosted execution; this receipt
does not claim an independent replay from a retained dump. The finite synthetic
timings are neither production RTO/RPO nor a capacity or performance-improvement
claim. This acceptance does not pre-approve a later final source/documentation
commit or any production deployment.

## Historical implementation and local checkpoints

The following records preserve the original defect, failed candidate, independent
review correction and local-only evidence. Their implementation-time pending
statuses are superseded by the exact PR91 acceptance above; raw evidence bytes
and the distinction between local fixture proof and hosted restore are retained.

## Finding and implemented correction

The last migration, `LearningGoals1796200000000`, previously dropped
`learning_goals` unconditionally. The existing restore fixture left that table
empty, so its successful final-migration rollback/reapply did not test saved-goal
preservation. A real PostgreSQL regression reproduced the loss before the
implementation changed: one saved goal existed, `down()` succeeded, and
`to_regclass('learning_goals')` became null. The probe always rolled its enclosing
transaction back. No existing database or user data was changed.

The [baseline log](evidence/reliability/goal-rollback-baseline.log) retains the
failure. Its two unselected cases are the explicit baseline test-name filter;
they are not skipped candidate acceptance tests. The candidate changes only
`down()` in the existing migration: require an active READ COMMITTED transaction, acquire
`ACCESS EXCLUSIVE` on the goal table, refuse if any row exists, and drop only
the empty table while holding that lock. `up()`, migration registration, API
contracts and the schema are unchanged. The lock covers both the check and the
drop, so an in-flight writer cannot commit a goal between them.

Five new real-PostgreSQL tests in
[`learning-goal-migration.e2e-spec.ts`](../../../Back/test/learning-goal-migration.e2e-spec.ts)
verify transaction refusal, exact row/ledger preservation on populated refusal,
old-snapshot refusal for both higher isolation levels, and the concurrent-writer
case. The latter observes the pending database lock,
commits the writer, requires the rollback to refuse, and checks the goal survives.
All thirteen targeted tests passed, including the eight existing learning-goal
tests and their legitimate empty-table down/up check. The existing full-chain
migration regression also passed. This is a defensive rollback correction, not
a new migration or an instruction to downgrade a live database.

### Independent review correction: P5-RELIABILITY-001

The first candidate `f6f11ed41865226a26a86927d1fe97a8a961915f` required a
transaction and an exclusive lock but did not restrict isolation. Independent QA
found that a REPEATABLE READ or SERIALIZABLE transaction could read the migration
ledger, retain that old snapshot, then miss a goal committed by another connection
before the lock. The migration dropped the table inside the probe transaction.
All probe transactions were rolled back and the committed goal survived cleanup.

The original independent [JSON](evidence/reliability/goal-isolation-independent-baseline.json)
and [probe script](evidence/reliability/goal-isolation-independent-baseline.mjs)
are retained byte-for-byte, including their original historical scratch paths.
This was a blocking review finding, not an accepted limitation. PostgreSQL's
[LOCK documentation](https://www.postgresql.org/docs/17/sql-lock.html) explains
that a late table lock does not refresh an established higher-isolation snapshot.

The correction checks `SHOW transaction_isolation` before locking or dropping and
refuses anything other than READ COMMITTED. It does not change an existing
transaction's isolation or assume that a table lock refreshes a snapshot. The two
new tests establish their old snapshot with a migration-ledger read, commit a
goal through a separate connection, and require the explicit isolation refusal
while the table still exists. Rows and ledger remain exact after rollback.
Both tests first failed against the previous implementation, then passed with
the correction; default READ COMMITTED concurrent-writer refusal and legitimate
empty down/up continue to pass. [Complete captures](evidence/reliability/goal-isolation-tests.json)
preserve the failures, the 13-pass candidate suite, full migration rerun and
fixture rerun. Three unselected baseline cases come from the explicit test-name
filter; the candidate suite has no skips. Independent re-review was still required
at that author checkpoint; the corrected source and actual hosted execution are
now accepted in the receipt above.

## Extend the existing restore gate

The existing
[`phase4-restore-rehearsal.mjs`](../../../Back/scripts/phase4-restore-rehearsal.mjs)
path and artifact name remain stable for CI. The new report is schema 2. The
fixture adds representative product history to the existing 128 users, 24
problems, 2,048 mixed/test submissions, 128 bookmarks and bounded source payloads:

| Synthetic records | Count | Checked relationship |
|---|---:|---|
| Private learning goals | 12 | Saved rows survive refusal and restore; a restored goal can be updated |
| Algorithm content versions | 24 | Assessment algorithm pin references its version |
| Solve ledger entries | 128 | Submission owner/problem, retained XP evidence, non-test status; synthetic user XP equals this ledger |
| Assessment and candidates | 1 / 8 | Candidate ownership and pinned algorithm/Vibe content |
| Assessment algorithm submissions | 8 | Candidate owner, pinned problem version, test-only classification, no XP award |
| Vibe workspaces | 8 | Candidate owner, challenge version and model match the assessment pin |
| Vibe revisions | 16 | Baseline/save history and current workspace files match the current revision |

The total submission count is now 2,056. Four synthetic candidates/workspaces
are completed and four remain open. The Vibe report explicitly records an
unavailable model; no provider call, user-code execution or live XP award is
performed by seeding. Relationship checks establish database consistency, not
API authorization. Existing real API ownership/assessment suites remain required.

The sequence is now:

1. Create two exact, randomly named owned databases and apply all 31 migrations.
2. Verify legitimate **empty** final rollback/reapply before seeding.
3. Seed product/ledger history in one bounded transaction and check its semantic
   oracle. Require the source database below 64 MiB.
4. Hold a transaction-scoped `SHARE` lock on every public table through all
   source fingerprints, schema reads and `pg_dump`. A separate writer with a
   100 ms lock timeout must fail. This is a real stop-writer barrier in the
   disposable fixture; it is not evidence that deployment writers were drained.
5. Release the barrier after the custom archive succeeds; restore into the
   second generated database and require it below 64 MiB.
6. Compare all 37 table counts/digests and the existing schema oracle. CHECK
   definitions retain PostgreSQL's stable parser normalization; other schema
   comparisons and all constraint flags remain intact. Verify the complete
   migration ledger, then require populated goal rollback to refuse and retain
   every table fingerprint, schema value and product relationship.
7. Update a restored verdict and independently recount problem statistics;
   update a restored goal and recheck product relationships.
8. Close connections, remove only the generated databases, and emit PASS only
   after cleanup succeeds.

The original fail-closed wrapper remains mandatory: `CI=true`, `NODE_ENV=test`,
`PHASE4_REHEARSAL=disposable-ci`, a plain loopback PostgreSQL URL, the owned
Actions service container ID, and an inspected PostgreSQL 17 CI image. The
configured existing database is an admin connection, never a fixture target.
No Docker substitute or environment spoof was used locally.

Bounds remain finite: 30-second fixture statements, two-second fixture/barrier
lock waits, 60 seconds each for dump/restore, a custom archive below 32 MiB and
64 MiB per generated database. The Backend job has its existing 15-minute
ceiling. A 64 KiB fixture `work_mem` is transition pressure, not a claim of
measured disk spill or peak PostgreSQL memory. Cleanup runs after failures; an
entire CI process/runner kill is outside the JavaScript `finally` guarantee.

## Historical actual local execution

The two goal-test `.log` displays omit only trailing empty lines for Git
whitespace hygiene. Their complete original UTF-8 captures, byte counts and
SHA256 values are preserved losslessly in
[goal-rollback-captures.json](evidence/reliability/goal-rollback-captures.json).

| Check | Observed result | Evidence / boundary |
|---|---|---|
| Baseline populated rollback | **FAIL as reproduced**; saved table dropped inside a rolled-back test transaction | [Raw failure](evidence/reliability/goal-rollback-baseline.log) |
| Initial candidate real PostgreSQL goal/migration suite | **11 passed** before independent QA exposed the higher-isolation coverage gap | [Historical result](evidence/reliability/goal-rollback-candidate.log); superseded by the corrected 13-case suite |
| Higher-isolation baseline regressions | **2 failed as reproduced** against `f6f11ed`; table dropped under old REPEATABLE READ and SERIALIZABLE snapshots | [Complete captures](evidence/reliability/goal-isolation-tests.json); destructive transactions rolled back |
| Corrected candidate real PostgreSQL goal/migration suite | **13 passed**, two files, no candidate skips | [Complete captures](evidence/reliability/goal-isolation-tests.json) |
| Existing migration regression after isolation correction | **PASS**: historical upgrade, evidence/idempotency/refusal, fresh full rollback/reapply | [Complete captures](evidence/reliability/goal-isolation-tests.json); the expected username-case refusal is retained |
| Shared fixture and populated refusal | **PASS**: 31 migrations, 37 preserved table fingerprints, 12 goals and all product oracles | [Source-bound JSON](evidence/reliability/fixture-proof.json), [executable narrow proof](evidence/reliability/fixture-proof.mjs) |
| Restore environment/name guards | **2 passed** | `node --test Back/scripts/phase4-restore-rehearsal.test.mjs` |
| Backend lint, typecheck and production build | **PASS** | Normal local module paths; no compiler/source relaxation |
| Actual custom archive/restore | **NOT_EXECUTED locally** | Docker was unavailable locally; the later accepted PR91 CI executed the guarded full entrypoint as recorded above |

The local fixture proof used an owned PostgreSQL 17.11 cluster and Node 24.22.1.
It records source-file SHA256 values, its base commit, safe table counts/digests,
database bytes and successful removal of its generated database. It does not
claim a dump, a restored database, a writer barrier run, provider execution,
native judging or production readiness. The local services used their own data
directory and loopback ports; the process launcher stopped them in `finally`.

For an already owned disposable PostgreSQL instance, the narrow proof can be
repeated from the repository root after building Back:

```sh
NODE_ENV=test PHASE5_FIXTURE_PROOF=disposable-local \
  node docs/overhaul/phase5/evidence/reliability/fixture-proof.mjs
```

`DATABASE_URL` must point to that owned loopback instance with CREATEDB
permission. The proof creates and removes only its generated `oj5_fixture_*`
database. For the full restore, use the existing Actions database step; its
owned container identity is not a local workaround:

```sh
# In Back, within the existing owned Actions PostgreSQL service step.
PHASE4_REHEARSAL=disposable-ci \
PHASE4_POSTGRES_CONTAINER=<owned-actions-postgres-service-id> \
  node scripts/phase4-restore-rehearsal.mjs
```

## Existing recovery evidence reused

[Phase II recovery](../PHASE2-RECOVERY.md) already demonstrates clean owned
Redis/AOF stop/start, API crash/replacement, ordinary worker loss, interrupted
rejudge with natural lease expiry, stale/duplicate callback fencing and unique
XP/solve/learning/notification evidence. Those finite scenarios remain in the
required pipeline. This change does not repeat them as new work or reinterpret
a clean Redis stop as power-loss/corrupt-AOF recovery.

[Phase IV reliability](../phase4/RELIABILITY.md) and the
[Phase V starting receipt](BASELINE.md) supply the accepted original 31-migration,
37-table restore baseline. That historical success does not establish execution
of this richer schema-2 fixture. The current feature and final integration
receipts must bind full CI to their actual source/checkout trees.

## Readiness and handoff

The corrected rollback/restore implementation is independently reviewed, verified
in the actual PR91 full CI and integrated at the source/tree recorded above. The
workflow selects the new `*.e2e-spec.ts` file and runs/uploads the existing restore
entrypoint/report; this stream required no replacement restore workflow. A later
final source/base still requires its own applicable full CI and acceptance.
Do not reuse a schema-1 report to satisfy the schema-2 gate.

The [release runbook](RELEASE-RUNBOOK.md) makes staging preflight, drains,
migration sequencing, backup/restore, rollback refusals, credentials, alerts and
external stop/go conditions explicit. Actual production migration lock windows,
data-volume recovery time/loss objectives, offsite retention, deployment network
controls, gateway certificate operations and host failure recovery remain
**BLOCKED_EXTERNAL_ENVIRONMENT**. No operational resources were changed.

The independent review of frontend source `75763aa23decb164fd9d369590099c9365e42400`
is a separate reviewer duty, recorded in
[FRONTEND-INDEPENDENT-REVIEW.md](evidence/reliability/FRONTEND-INDEPENDENT-REVIEW.md).
It is not self-approval of this reliability implementation.
