# Disposable backup and restore rehearsal

`Back/scripts/phase4-restore-rehearsal.mjs` runs only with explicit disposable-CI opt-in, `NODE_ENV=test`, a loopback PostgreSQL connection and the owned Actions PostgreSQL 17 container ID. It creates two random databases, never uses the configured existing database as the fixture, and only drops names it successfully created in this invocation.

The fixture applies the complete current migration chain and seeds 128 synthetic users, 24 public problems, 2,048 mixed accepted/wrong submissions, duplicate solve evidence, test runs, 128 bookmarks and bounded 16-KiB source rows. A 64-KiB transaction work_mem creates bulk-transition pressure; this is not proof of a measured spill volume or a large production workload.

The rehearsal creates a custom pg_dump archive, restores it into the second generated database, and compares every public table's row count/content digest plus indexes, constraints and non-internal trigger definitions. The restored migration ledger must be complete. It then rolls back/reapplies the last migration, checks submission/XP/statistics semantics, and changes a restored verdict to verify triggers against an independent aggregate.

All generated connections/databases must be cleaned up before PASS evidence is emitted. No archive or synthetic source rows are uploaded: the artifact contains only source/run binding, bounded counts/digests, stage timings, archive size/SHA256 and limitations. Raw connection strings, PostgreSQL errors and archive bytes are excluded from logs.

## Verification state

The two environment/cleanup-target guard tests passed locally. Independent source review identified and resolved a validated-connection mismatch and success-before-cleanup issue. Real PostgreSQL/Docker execution is required in the exact-source Back CI job; local unit success is not a restore result.

The existing full-chain, historical schema, rollback/reapply and refusal checks remain unchanged. This additional rehearsal is a finite synthetic recovery check. Production RTO/RPO, operating-system restore, real data volume, production writer locks, migration windows and operational backup retention remain unverified.

Run in the existing owned Actions database step after the backend build and API suite:

```sh
PHASE4_REHEARSAL=disposable-ci \
PHASE4_POSTGRES_CONTAINER=<owned-actions-postgres-service-id> \
node scripts/phase4-restore-rehearsal.mjs
```

`CI=true`, `NODE_ENV=test` and the existing loopback `DATABASE_URL` must already be set. The compact output is `Back/reports/phase4-restore.json` and is retained by the workflow. An absent or failed report does not satisfy the gate.
