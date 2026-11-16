# Database and performance audit

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.
Branch: `overhaul/database-performance`.

## Scope and inventory

Reviewed all 25 baseline migration files, the explicit TypeORM migration registration, database/TLS and Redis configuration, shared pagination, and database access in community, enterprise, users, missions, email, authentication, administration and submission/queue paths. This is a schema/query audit, not an assertion that every possible concurrent application behavior was exercised.

A freshly migrated PostgreSQL 17.11 catalog contains 30 application tables plus TypeORM's migration table, 48 foreign keys, 31 primary keys including the migration table, 20 CHECK constraints and five SQL UNIQUE constraints. Additional unique indexes, such as case-insensitive usernames and partial notification uniqueness, are separate from UNIQUE constraints. The complete constraint catalog is included in the database benchmark artifact.

Core relations use PostgreSQL foreign keys; immutable problem snapshots and version numbers preserve historical judging contracts. Newer modules use parameterized SQL and JSONB/array state rather than additional TypeORM entity classes. `synchronize` is disabled. Existing tests exercise historical backfills, refusal of unsafe rollbacks, and fresh migration round trips.

## Adopted findings

| ID | Priority | Observed issue | Change | State |
|---|---|---|---|---|
| DB-001 | P2 performance | Enterprise score assembly scanned the entire project row array for every candidate/task; its CPU cost grew quadratically. | Index rows by attempt and challenge once; preserve request order, missing/working/pending/complete states and score calculation. | IMPLEMENTED → TESTED; independent review/CI pending |
| DB-002 | P2 performance | Profile saved/voted queries filter by user, while their primary keys lead with post ID. Real plans scanned unrelated relationship rows. | Add two non-unique `(user_id, post_id)` indexes in reversible migration `1795700000000-community-profile-indexes`. | Measured → IMPLEMENTED → TESTED; independent review/CI pending |

No REST request/response contract changed. No existing index, constraint or data column was removed. No database was reset outside the generated disposable benchmark/integration databases.

## Enterprise result assembly measurement

`Back/scripts/benchmark-enterprise-scores.mjs` contains the baseline algorithm and imports the production replacement. It uses five fresh child processes per input/mode, alternates mode order, and verifies SHA-256 digests of the entire output are identical. Fixture rows deliberately include missing, working and unevaluated tasks and are returned in reverse candidate order. Each case has one supported vibe challenge per candidate.

| Candidates | Project rows | Before median wall time | After median wall time | Before median CPU | After median CPU |
|---|---:|---:|---:|---:|---:|
| 100 | 85 | 0.3484 ms | 0.2769 ms | 0.618 ms | 0.405 ms |
| 1,000 | 857 | 5.3351 ms | 0.7973 ms | 7.028 ms | 1.393 ms |
| 5,000 | 4,285 | 139.0050 ms | 4.3188 ms | 145.552 ms | 8.819 ms |
| 10,000 | 8,571 | 541.4035 ms | 7.0064 ms | 543.068 ms | 10.061 ms |

At 10,000 candidates, peak child-process RSS increased from 75,356 to 76,996 KiB. The map uses additional memory to remove repeated searches. Peak RSS includes the child runtime, fixtures and result digest; it is not incremental allocation accounting. The benchmark excludes SQL, HTTP and output serialization timing and does not establish end-to-end API latency or throughput.

Raw samples/environment: `Back/benchmarks/enterprise-scores.json`.

## Real PostgreSQL profile-query measurement

The benchmark captures the exact saved/voted SQL from `CommunityService.mine`, creates a new `unsolvable_benchmark_<random>` database, applies the baseline migration chain, seeds synthetic fixtures and applies the production index migration. Only the generated database is modified or dropped. The configured database is used solely for CREATE/DROP DATABASE. An explicit opt-in and local test server are required.

Environment: PostgreSQL 17.11, Node 24.22.1, Linux 6.18.57, AMD EPYC 9V74, nine visible logical CPUs; 64 MiB shared buffers, 4 MiB work_mem, 30 max connections. Dataset: 10,000 users, 2,000 posts, 200,000 saved relations and 200,000 vote relations. One connection, concurrency one, three warm-ups and seven `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` samples per query/mode. Identical ordered response payloads, including hidden-post filtering, were verified by digest.

| Exact service query | Before execution median | After execution median | Shared hit blocks before → after | Returned rows |
|---|---:|---:|---:|---:|
| Voted profile posts | 8.542 ms | 0.790 ms | 1,688 → 195 | 18 |
| Saved profile posts | 7.797 ms | 0.854 ms | 1,688 → 195 | 18 |

All measured plans were warmed (`Shared Read Blocks = 0`); these are database execution times, not a cold-cache or HTTP load test. The full plan and all timing samples are stored in `Back/benchmarks/community-indexes.json`. The earlier exploratory run showed the same plan improvement; final numbers above come from the rerun applying the actual migration class.

Each new index occupied 9,961,472 bytes for 200,000 rows. Inserts/deletes must maintain one additional index per relationship table; write-throughput impact was not measured. The migration uses ordinary transactional CREATE INDEX, so a future deployment on populated tables must account for index-build locking. This task did not run a production migration.

## Actual validation

- Baseline build initially hit a worktree-only TypeScript declaration path error due to symlinked dependencies. Replacing the symlink with immutable local hardlinks resolved it without changing application types or compiler checks.
- Final `npm run check --prefix Back`: lint, typecheck, build, **279 unit tests / 19 files passed**; four new result-assembly semantic tests are included.
- Actual PostgreSQL migration verification: **passed** legacy upgrade, guarded rollback cases, fresh install, all **26** migrations down/up, and existing data/history checks. An expected duplicate-username rejection appears in the log as part of the passing negative test.
- Actual PostgreSQL/Redis API tests: **18 tests / four files passed** (`community-profile-indexes`, `community`, `enterprise`, `enterprise-vibe`). The new test verifies migration registration produces valid, ready, non-unique user-first indexes.
- Real database benchmark using the production migration: **passed** with identical result digests.
- Enterprise fresh-process benchmark: **passed**, full output digests match in every sample.
- `git diff --check`: passed.

Native binaries were used under one awaited shell invocation, keeping test servers and clients in the same process/network namespace. They were terminated in `finally`; integration/benchmark runners removed their generated databases. There was no real provider call, operational data, production Redis, or Docker deployment.

## Reproduction

```sh
npm run build --prefix Back
node Back/scripts/benchmark-enterprise-scores.mjs
# DATABASE_URL must already identify a disposable local PostgreSQL server with CREATEDB permission.
UNSOLVABLE_BENCHMARK=1 node Back/scripts/benchmark-community-indexes.mjs
npm run test:migrations --prefix Back
npm run test:e2e --prefix Back -- test/community-profile-indexes.e2e-spec.ts test/community.e2e-spec.ts test/enterprise.e2e-spec.ts test/enterprise-vibe.e2e-spec.ts
```

The application dependencies come from the existing lockfile. Test-only PostgreSQL/Redis binary provisioning is environment-specific and is not added as an application dependency.

## Remaining database and capacity risks

- `refresh_problem_stats` serializes each problem's statistics and recounts its finished submissions for relevant writes. It is a documented growing write cost; replacing it requires mixed rejudge/delete/concurrency tests and a representative write workload, not only a read benchmark.
- Enterprise result exports still return all candidates and retain all queried project rows. This change removes quadratic lookup but does not paginate an unbounded report or reduce SQL result size.
- Notification, community and ranking pages retain offset/count work; search uses substring/tag conditions. Existing indexes help some paths, but representative large-volume workloads are needed before changing their contracts or adding search indexes.
- Some referencing FK columns lack a dedicated leading index (for example solve anchors and notification actors). This is a workload-dependent cascade/maintenance cost, not by itself a confirmed correctness flaw. Only the two measured reverse profile indexes are added here.
- PostgreSQL pool sizing is not explicit in application configuration. Replica counts, background consumers and connection limits need a measured deployment budget.
- The API Redis client limits retries; the worker uses the long-lived BullMQ connection contract. Enqueue IDs include generation, completed/failed retention is bounded, and retries/backoff/recovery exist. Actual Redis reconnect/queue throughput under load remains a separate integration gate.
- Assessment problem IDs are stored in an array rather than a join table of immutable task-version references. Changing task-version semantics is a product/data-model decision; this pass did not alter it without a complete lifecycle regression design.

No P0/P1 database vulnerability was newly established in this bounded pass. The findings above do not certify unrelated application authorization or production capacity.
