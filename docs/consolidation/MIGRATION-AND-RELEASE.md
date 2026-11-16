# Migration, recovery and manual release

## Code review sequence

The final consolidation PR targets `main` directly and includes the complete
unmerged Phase I–V source plus reviewed corrections. After its exact-source CI
and independent QA pass, the user reviews **one** PR. Earlier PR63/86/92 can then
be closed without merging, with links to the replacement and preserved history.
Their old stacked merge order is historical and must not be followed for this
new consolidation.

No automated main merge, deployment, production migration, rollback, secret or
volume operation is authorized. If main changes, incorporate the new base and
repeat qualification. Do not revert an already-merged feature solely to make it
appear again in a PR diff.

## Database contracts

The existing 31 migrations and ordering remain unchanged. Core retained changes
include enterprise problem versions, private bookmarks, Vibe challenge versions,
incremental problem statistics and private learning goals. Existing up/down tests
exercise populated data, concurrent writers and isolation failure cases.

The goal down migration requires an active READ COMMITTED transaction, takes its
writer barrier and refuses populated retained goals. Higher-isolation stale
snapshots must fail rather than authorize data loss. Do not delete rows or use an
older binary to bypass that refusal.

The disposable restore harness runs the migration chain, acquires its writer
barrier, compares schema and ledger plus 37 exact table fingerprints, performs
pg_dump/pg_restore, tests populated rollback refusal and a post-restore write, and
cleans both generated databases. Its finite result is separate from production
data volume, offsite retention, downtime and RTO/RPO.

## Operator prerequisites

Before any authorized deployment, an operator must provide current code/image
qualification, an unexpired exact Runtime decision, dedicated host/kernel/network
evidence, credential/certificate ownership and rotation, backups and a verified
isolated production-like restore, writer-drain/reconciliation discipline, monitoring
and a tested stop/recovery decision.

The detailed [historical release runbook](../overhaul/phase5/RELEASE-RUNBOOK.md)
contains the operational commands and refusal conditions. Apply its migration,
backup, restore and stop/go guidance to the **new accepted consolidation SHA**;
its old stacked-PR references do not authorize merging the original stack.
The runbook's26-hour local and30-hour offsite backup-age alerts are requirements,
not proof that an offsite transfer or alert-delivery system exists.

If a deployment prerequisite is unavailable, retain
**BLOCKED_EXTERNAL_ENVIRONMENT**. Code eligibility for manual review never implies
deployment authorization, a safe production rollback, production capacity or an
operator-owned recovery objective.
