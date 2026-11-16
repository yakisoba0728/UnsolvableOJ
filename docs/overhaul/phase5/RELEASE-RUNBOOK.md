# Phase V staging, release and recovery runbook

This runbook is an executable operator handoff for an **approved** staging or
deployment environment. No deployment, production database/Redis/volume change,
credential rotation or paid service operation was performed for Phase V.
Commands that change a running environment belong to its operator-approved
maintenance window. The source, CI, infrastructure and recovery gates below
must be satisfied first. Missing external evidence means stop; a repository
test cannot approve a real host or invent an operational RTO/RPO.
Shell blocks assume Bash. Stop on any failed command and preserve its output in
the private release record; do not continue by copying a later block.

## 1. Freeze the release and decide go / no-go

Record a private change ticket containing the candidate commit/tree, prior
working commit and image digests, exact CI run/attempt, source-versus-Actions
checkout correspondence, independent review, target host/project/database,
operators, maintenance deadline, backup identity and rollback decision owner.
Use the final Phase V receipt, not an implementation-time branch status. At the
Phase V baseline, #63 and #86 remain open; the manual sequence is #63 → #86 →
the new Phase V stacked PR, rechecked against the actual merge state.

From the already selected, clean release checkout:

```sh
: "${OJ_RELEASE_SHA:?Set the reviewed immutable commit}"
test "$(git rev-parse HEAD)" = "$OJ_RELEASE_SHA"
test -z "$(git status --porcelain)"
git show -s --format='commit=%H tree=%T parents=%P'
node scripts/check-production-compose.mjs
```

These are configuration/source checks; they do not deploy. Before an operational
go decision, require the following evidence:

| Gate | Go evidence | Stop condition |
|---|---|---|
| Required CI | All twelve required jobs at the actual final source/tree: dependency audit, four image jobs, change detection, Backend/API, Judge worker, two browser shards, native/pipeline/Compose, aggregate required | Failure, cancellation, missing required execution, stale base/tree or an unexplained skip |
| Recovery | Schema-2 `phase4-restore.json`: 31 migrations, all 37 table fingerprints, seeded products, writer refusal, archive/restore, populated rollback refusal, restored write and cleanup | Historical/schema-1 report, absent artifact, failed cleanup or only a local fixture proof |
| Runtime security | Fresh raw scanner/inventory and independently accepted exact component/advisory/image decision; check [security ledger](RISKS.md) and final security receipt | Changed cohort/payload/advisory, expired review, or any failed strict gate; raw HIGH177/CRITICAL5 at baseline is not zero |
| Runtime review deadline | Decision remains within **2026-11-30 00:00 UTC / 09:00 KST** | Do not renew expiry through a deployment ticket, repeated scan or this runbook |
| Release artifact | Image IDs/digests selected for this environment are the actually qualified artifacts | A rebuild changed the shipped artifact and was not requalified; source equality alone is insufficient |
| Infrastructure | Approved host/VM placement, kernel/privileged executor boundary, verified firewall/egress, no public DB/Redis/executor ports, actual DNS/TLS/proxy identity | Host/kernel/network assumptions without operational receipts |
| Recovery capacity | Representative approved staging migration/restore fits the agreed maintenance and disk budgets; recent independent offsite restore | Unknown migration locks, insufficient headroom, missing decryptable offsite copy or no recovery owner |

The source-bound frontend review and DOM tests do not replace real browsers.
The dedicated TLS protocol fixture does not validate an installed gateway.
Existing finite native recovery tests do not establish host-power-loss or
multi-hour saturation behavior. Their current external/deferred statuses remain
in [RISKS.md](RISKS.md) and the final external-gates receipt.

## 2. Select and inspect the environment

Use the existing approved project identity. Changing the project name selects
different named volumes. The base command below matches the seven-service
single-host template. Dedicated algorithm/Vibe deployments must use their
approved overlays and separate execution-host commands consistently; do not
silently fall back to embedded execution or run a second local executor.

```sh
: "${OJ_PROJECT:?Set the approved existing Compose project}"
: "${OJ_ENV:?Set the absolute protected environment file}"
: "${OJ_RECORD_DIR:?Set a private release evidence directory}"
test -f "$OJ_ENV"
umask 077
mkdir -p "$OJ_RECORD_DIR"
ojc() {
  docker compose --project-name "$OJ_PROJECT" --env-file "$OJ_ENV" \
    -f deploy/compose.yaml "$@"
}
ojc config --quiet
ojc config --format json | node scripts/check-sandbox-budget.mjs
ojc ps --all
docker network inspect dokploy-network \
  --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
```

Do not save expanded Compose output: it contains secrets. Verify the actual
container project/service labels, volume names and image digests before any
stop, restart or database command. Inspect only selected metadata, not full
environment dumps. Validate actual trusted proxy subnets/hops and two distinct
client IPs; `0.0.0.0/0` is not a trusted-proxy configuration. Public ingress goes
only to `front`; `/api/v1/internal/judge/heartbeat` must return 404 through it.

Check RAM/CPU/disk available **after** OS, Dokploy, other services, builds, WAL,
backups and a parallel restore database. The default memory ceilings total about
13.375 GiB; a 16 GiB host is a starting size, not a capacity result. Sandbox
memory is at least 4 GiB × configured concurrency + 2 GiB overhead. CPU caps
must fit the actual host. Verify cgroup/seccomp/no-fallback health and swap
constraints; do not disable them to obtain a healthy status. Record a free-disk
stop threshold based on the measured database, backup and temporary restore
sizes, then monitor it throughout the window. The small CI fixture does not
supply this production budget.

For dedicated Vibe, also validate the existing templates with the approved
private configuration:

```sh
docker compose --env-file "$OJ_ENV" -f deploy/compose.yaml \
  -f Back/deploy/vibe-dedicated.compose.yaml config --quiet
docker compose --env-file "$OJ_EXECUTOR_ENV" \
  -f Judge/deploy/vibe/compose.yaml config --quiet
```

These overlays require the configured Compose support for `!override` and an
independently approved mTLS gateway. [Phase IV transport](../phase4/VIBE-TRANSPORT.md)
documents exactly what the repository implements and which real controls remain
external. Its separate executor Compose file alone does not provide the gateway.

## 3. Stop admissions, drain work, then freeze writers

Use the approved maintenance ingress gate or stop `front` to stop public
admissions. Verify that every alternate/private API producer, scheduled import,
admin mutation, assessment client and email/provider request source is covered.
The repository has no universal maintenance-mode or multi-node drain command.
Keep the API, Redis and executor available while current Judge callbacks and
acknowledgements finish. Capture the administrator `/api/v1/admin/ops` queue,
submission and worker view immediately before closing ingress; keep private
operator access if the gateway supports it.

For the selected single-host project:

```sh
ojc stop front
# Read-only checks while the API, worker and Redis remain available.
ojc exec -T postgres psql -U unsolvable -d unsolvable_oj -X \
  -v ON_ERROR_STOP=1 -c \
  "SELECT status,count(*) FROM submissions WHERE status IN ('QUEUED','JUDGING') GROUP BY status"
```

Poll within the pre-agreed window. Require no new admissions, no queued/judging
submission left unexpectedly, no active/delayed queue work requiring completion,
and no unacknowledged callback. Keep an explicit record of any intentionally
retained queued item and its generation; a release with unexplained work is a
stop. There is no API in this change for forcibly marking a task acknowledged.
Do not rewrite leases, generations or verdicts, or flush Redis to clear a panel.

Close or finish Vibe/editor activity before terminating API replicas. The runner
has a 45-second run deadline plus separately bounded five-second cleanup, while
AI requests have a 60-second deadline; neither is a global in-flight request
counter or a guarantee that an arbitrary deployment sleep drains all handlers.
Use the actual ingress/application request observations. If their drain cannot
be established, retain maintenance and treat the interruption as an incident.

After work is acknowledged:

```sh
ojc stop --timeout 120 judge
ojc stop --timeout 120 back
ojc ps --all
ojc exec -T postgres psql -U unsolvable -d unsolvable_oj -X \
  -v ON_ERROR_STOP=1 -c \
  "SELECT application_name,state,count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY application_name,state"
```

The worker's signal handler waits for BullMQ close, then closes Redis; Compose
allows two minutes before forced termination. If that window is exceeded, stop
the rollout and record an interruption. Existing natural-lease recovery and
generation fencing are the recovery mechanism, not permission to erase work.
Inspect remaining sessions privately; another application writer means the
writer freeze is incomplete. Stop **all** API replicas and background writers
before schema work or the release-point backup. Leave PostgreSQL and Redis
running; executor shutdown, if required, follows worker/API drain. A CI `SHARE`
barrier in a disposable database does not perform this operational drain.

## 4. Take and verify the release-point backup

Record the ledger and aggregate data/XP/solve/goal/version counts before the
change. Keep these records private. Do not publish rows, user identifiers,
source code, refresh tokens, connection strings or backup contents.

```sh
ojc exec -T postgres psql -U unsolvable -d unsolvable_oj -X \
  -v ON_ERROR_STOP=1 -c 'SELECT id,timestamp,name FROM migrations ORDER BY id' \
  > "$OJ_RECORD_DIR/migrations-before.txt"
ojc restart postgres-backup
ojc logs --tail 20 postgres-backup
ojc exec -T postgres-backup ls -lt /backups
```

Select the **new completed** `.dump` created after writer freeze, not a `.partial`
or merely the newest old file. The backup service writes a partial file, renames
only after `pg_dump` succeeds, then applies local retention. Record its timestamp,
size and checksum, and verify the archive table of contents:

```sh
: "${OJ_BACKUP_NAME:?Select the completed release-point dump filename}"
[[ "$OJ_BACKUP_NAME" =~ ^unsolvable-oj-[0-9]{8}T[0-9]{6}Z[.]dump$ ]] || \
  { echo 'Invalid backup filename' >&2; exit 1; }
ojc exec -T postgres-backup pg_restore --list \
  "/backups/$OJ_BACKUP_NAME" > /dev/null
ojc exec -T postgres-backup sha256sum "/backups/$OJ_BACKUP_NAME" \
  > "$OJ_RECORD_DIR/backup.sha256"
OJ_BACKUP_CONTAINER=$(ojc ps -q postgres-backup)
test -n "$OJ_BACKUP_CONTAINER"
docker cp "$OJ_BACKUP_CONTAINER:/backups/$OJ_BACKUP_NAME" "$OJ_RECORD_DIR/"
chmod 600 "$OJ_RECORD_DIR/$OJ_BACKUP_NAME"
```

Copy that completed file through the already approved encrypted offsite channel,
verify the remote object's checksum/size and recoverability, and keep the key in
a separate failure domain. This repository does not provision or run offsite
copying. Do not create a new paid provider to satisfy the gate. A directory
listing or successful `pg_restore --list` is insufficient: the staging drill must
actually restore and verify a fetched offsite copy.

For an approved isolated PostgreSQL target, the following creates only a newly
generated validation database. Run it against staging/off-host recovery
infrastructure with the selected archive and sufficient private storage. The
`ojc` function must identify that approved environment. Never substitute the
live database name for the generated target.
The count queries below assume the recorded source has the Phase IV schema.
For an earlier source, record its actual table inventory and expected migration
ledger first, adapt the count queries to those existing tables, then rehearse
the full upgrade on the isolated restored copy. An expected absent old-schema
table must be documented; it is not permission to ignore a missing table from
an archive that should contain it.

```sh
(
  set -eu
  OJ_RESTORE_DB="oj_verify_$(openssl rand -hex 16)"
  oj_restore_created=0
  oj_restore_cleanup() {
    oj_restore_status=$?
    if [ "$oj_restore_created" = 1 ]; then
      ojc exec -T postgres-backup dropdb "$OJ_RESTORE_DB" || oj_restore_status=1
    fi
    exit "$oj_restore_status"
  }
  trap oj_restore_cleanup EXIT
  ojc exec -T postgres-backup createdb "$OJ_RESTORE_DB"
  oj_restore_created=1
  time ojc exec -T postgres-backup pg_restore --no-owner --exit-on-error \
    --dbname "$OJ_RESTORE_DB" "/backups/$OJ_BACKUP_NAME"
  ojc exec -T postgres-backup psql --dbname "$OJ_RESTORE_DB" -X \
    -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS migrations FROM migrations' \
    -c 'SELECT count(*) AS users,sum(xp) AS total_xp FROM users' \
    -c 'SELECT count(*) AS submissions,max(created_at) AS latest_submission FROM submissions' \
    -c 'SELECT count(*) AS solves,sum(awarded_xp) AS awarded_xp FROM user_problem_solves' \
    -c 'SELECT count(*) AS goals FROM learning_goals' \
    -c 'SELECT count(*) AS assessment_attempts FROM enterprise_attempts' \
    -c 'SELECT count(*) AS workspaces FROM vibe_attempts' \
    -c 'SELECT count(*) AS revisions FROM vibe_revisions'
)
```

For a fetched offsite file, replace the `pg_restore` invocation with
`ojc exec -T postgres-backup pg_restore --no-owner --exit-on-error --dbname
"$OJ_RESTORE_DB" < "$OJ_RECORD_DIR/$OJ_BACKUP_NAME"`. The archive must match
the recorded checksum. Compare counts, XP and migration ledger with the frozen
source; check owner/version/ledger relationships and independent statistics on
this isolated restored database. Use the complete schema/table comparison
protocol from [RELIABILITY.md](RELIABILITY.md) for the approved representative
dataset; its hardcoded synthetic product counts are **not** a production oracle.
Fail on missing/extra tables, inconsistent data, schema drift or cleanup failure.
Record restore wall time and data age with the dataset size; production RTO/RPO
remain unverified until this protocol runs on approved representative resources.

## 5. Apply migrations once, then start services in order

The registered chain is authoritative in
[`Back/src/database/data-source.ts`](../../../Back/src/database/data-source.ts).
At this increment there are 31 migrations, ending in this order:

| Migration | Behavior relevant to release |
|---|---|
| `1795800000000` | Pin assessment algorithm versions |
| `1795900000000` | Persistent private problem bookmarks |
| `1796000000000` | Version Vibe content/model history |
| `1796100000000` | Freeze submission/statistic writers while backfilling solver multiplicities and replacing triggers; not an online migration |
| `1796200000000` | Private learning-goal table; Phase V only strengthens its existing `down()` refusal |

No Phase V migration was introduced by the reliability change. A Phase IV
database should have no pending `up()` migration, but a deployment still on an
earlier source must rehearse its complete actual upgrade. Do not reorder or
manually mark migration rows. The API entrypoint automatically runs pending
migrations, so never start multiple new API replicas to race the migration.

Use the qualified new Back image with public/API writers still stopped. First
inspect pending migrations, then run once with an explicit **staging** budget:

```sh
ojc run --rm --no-deps --entrypoint node back \
  node_modules/typeorm/cli.js migration:show -d dist/database/data-source.js
ojc run --rm --no-deps \
  -e PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=120000' \
  --entrypoint node back node_modules/typeorm/cli.js \
  migration:run -d dist/database/data-source.js
```

The installed pg client reads `PGOPTIONS`; these commands limit lock wait to five
seconds and each statement to two minutes for the first staging rehearsal. A
timeout is a failed gate. Measure the required production window using approved
representative data; changing the budget requires an explicit updated operator
plan, not blind retries. Keep TypeORM's transactional migration mode. Compare the
ledger and schema after success and retain the actual exit status. Do not run
parallel manual SQL or bypass a migration guard.

Start stateful services/executors as required, then Back alone; its entrypoint
must see no pending migrations and become healthy. Start Judge only after the
API, Redis and sandbox are healthy. Validate internal operations and the owned
staging smoke before reopening public ingress:

```sh
ojc up -d --no-build --no-deps back
ojc ps back
ojc up -d --no-build --no-deps judge
ojc ps judge
# Only after the preflight/health/queue gates pass:
ojc up -d --no-build --no-deps front
```

On a multi-node deployment, migrate once with all writers stopped, restore one
API instance, verify, then add remaining compatible replicas and workers. Record
each node's source and image. This repository has no automatic distributed
migration lock/release coordinator. A rolling mixed-schema rollout requires its
own proven compatibility plan; it is not implied by these commands.

## 6. Post-start smoke and stop conditions

```sh
: "${OJ_PUBLIC_ORIGIN:?Set the approved HTTPS origin without trailing slash}"
curl --fail --silent --show-error --max-time 10 \
  "$OJ_PUBLIC_ORIGIN/api/v1/health" > /dev/null
test "$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' \
  "$OJ_PUBLIC_ORIGIN/api/v1/internal/judge/heartbeat")" = 404
ojc ps --all
```

In staging, use owned synthetic accounts for sign-in/token rotation; private
bookmark/goal isolation; algorithm AC/WA and retained XP on rejudge; assessment
creation/version pin/attempt/owner-only results/export; and Vibe save/run/reload
through the actual selected gateway. Use the approved deterministic AI fixture
or disabled provider path; do not incur paid model calls. Compare the restored
or pre-release ledger evidence, persisted goals and versioned workspaces. A
production smoke requires the operator's separately approved test-account plan.

Require fresh authenticated worker presence, queue acknowledgements, expected
final generations and stable error/resource signals. Stop admissions again on
schema error, missing goals or history, ownership mismatch, unexpected XP/solve
duplication, wrong final generation, sustained queue growth, unavailable worker,
failed sandbox security health, new server errors or failed backup. Do not call
an HTTP500 during a Redis outage a successful request; the historical recovery
test proves fail-closed admission and later retry, not continuous availability.

## 7. Rollback decisions and restore cutover

**Do not automatically run `migration:revert` when an image fails.** First keep
admissions closed and preserve the failed release's database, queue and logs.
Choose either a proven schema-compatible prior image or a reviewed forward fix.
The last known good image and current schema must be demonstrated compatible
on the restored staging copy. Retained goals and versioned assessment history
can make a schema downgrade unsafe even when application rollback is feasible.

Populated goals now produce:

```text
Cannot roll back learning goals with saved goals; preserve goal history before reverting.
```

Rollback also requires an active **READ COMMITTED** transaction. A transaction
with an old REPEATABLE READ or SERIALIZABLE snapshot can miss a goal committed
after its migration-ledger read even after obtaining the table lock. The
corrected migration checks isolation before destructive work and refuses with
`Learning goals rollback requires READ COMMITTED isolation.` If this occurs,
end that transaction and reconsider the rollback against current data; a
separately approved empty-schema rollback must start a new READ COMMITTED
transaction before the migration runner reads its ledger. Do not change
isolation inside an already established transaction or use an older binary to
bypass the check. The real PostgreSQL regression and review correction are
recorded in [RELIABILITY.md](RELIABILITY.md).

Treat this as an intentional preservation stop. Do not delete goals, alter the
migration ledger, disable the guard or use an old migration binary to force the
drop. Other existing guards protect solve/evidence, token/version and assessment
Vibe history. Empty-table down/up passing in CI does not authorize erasing live
product data. If a downgrade requires losing data, retain the current schema and
escalate the explicit recovery/data-retention decision to the operator/owner.

If a full data restore is approved, restore the selected verified backup into a
**new** recovery database and preserve the old database. Verify its ledger,
schema, product ownership, goals, versions, statistics and backup timestamp
before cutover. Point a private, isolated API/worker deployment to that database
with its own Redis namespace; it must not consume the live queue. Do not start
an API whose automatic entrypoint would apply an unapproved newer schema.
Validate the selected application image against the restored state first.

The current production Compose fixes the primary database name in its service
configuration. A real recovery cutover therefore requires a reviewed private
configuration change or operator-managed database promotion; it is not a
copy-paste `dropdb` of the existing service database. The operator must approve
which post-backup writes may be lost and reconcile Redis jobs/generations against
the restored PostgreSQL state before workers resume. There is no general
automatic queue-reconciliation command in this patch. Preserve the original
queue snapshot and use the application's fencing/recovery behavior under a
verified plan; never `FLUSHALL`, delete shared volumes or prune the host.

## 8. Credential and certificate rotation

Stage and verify rotations independently of a schema incident. Generate each
secret separately with a cryptographic generator (for example `openssl rand
-hex 32` into the approved secret store); never paste it into a ticket, command
history, expanded Compose output or application logs. The `.env`/Compose file
mount mechanism is not an encrypted secret manager.

| Credential | Required coordinated action and verification |
|---|---|
| PostgreSQL | Change the actual role password through the approved private DB-admin channel and update Back/backup consumers while writers are stopped. Changing only `POSTGRES_PASSWORD` does not change an initialized role. Verify a new connection with the new credential, old credential refusal and a new successful backup. |
| Redis | Stop consumers during this single-secret cutover; update server and every API/worker client together, preserve AOF/data, restart in dependency order and verify authenticated PING/queue acknowledgement. No eviction/flush workaround. |
| JWT | Replace the signing key in all APIs and require reauthentication; the existing single-key configuration does not provide overlapping key rings. Verify old access-token refusal and fresh login/refresh. Preserve refresh-token/account audit policy. |
| Judge API token | Rotate Back and every worker together; prove authenticated heartbeat/result callback and old-token refusal before admitting work. |
| Algorithm sandbox token | Rotate executor and algorithm workers together, maintaining authenticated readiness and anonymous refusal. |
| Dedicated Vibe bearer | Use a distinct Vibe token; update execution service/gateway forwarding and API together. Prove authorized access and mTLS-without-bearer denial. Do not reuse JWT/Redis/Judge tokens. |
| Email/provider | Update only approved server-side configuration, keep values out of `VITE_*`, verify the approved non-billable/disabled path, and separately authorize any paid request. |

For dedicated TLS rotation, record certificate serial/fingerprint, issuer, SANs,
validity, selected hostname and the approved revocation/expiry action. Verify
the new key matches the client certificate privately. Install CA trust overlap
on the approved gateway if its actual software supports it, then provision the
new API CA/client certificate/key files as read-only files readable by the API
UID and inaccessible to other ordinary users. Files must satisfy the existing
1..65,536-byte regular-file/PEM checks. Reload/restart the gateway using its
approved procedure; **restart Back** because the client identity is loaded at
provider construction. The repository does not implement gateway issuance,
reload or revocation.

Example certificate metadata and real gateway denial checks from the approved
private staging host (no secret/bearer in these command lines):

```sh
openssl x509 -in "$OJ_CLIENT_CERT" -noout -dates -serial -fingerprint -sha256
openssl s_client -connect "$OJ_GATEWAY_HOSTPORT" -servername "$OJ_GATEWAY_DNS" \
  -verify_hostname "$OJ_GATEWAY_DNS" -verify_return_error \
  -CAfile "$OJ_GATEWAY_CA" -cert "$OJ_CLIENT_CERT" -key "$OJ_CLIENT_KEY" \
  < /dev/null > /dev/null
oj_denied=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' \
  --cacert "$OJ_GATEWAY_CA" --cert "$OJ_CLIENT_CERT" --key "$OJ_CLIENT_KEY" \
  "$OJ_VIBE_HTTPS_ORIGIN/file")
case "$oj_denied" in 401|403) ;; *) echo 'Bearer denial failed' >&2; exit 1 ;; esac
```

Also require wrong CA/hostname, absent or revoked client identity and old bearer
to fail, and an authorized native Vibe run to persist correctly. Do not disable
hostname verification or mTLS to complete rotation. Remove old trust/identity
only after the real new path succeeds; revoke the old identity and verify its
denial. If the gateway cannot enforce or prove these operations, rotation and
dedicated deployment remain **BLOCKED_EXTERNAL_ENVIRONMENT**.

## 9. Retention, alerts and evidence ownership

The actual template writes a local dump at startup and every 24 hours, retains
`BACKUP_KEEP_DAYS` (default seven) after a successful dump, and reports unhealthy
if no completed dump is newer than 26 hours. These same-host files do not cover
host/disk loss. [Deploy documentation](../../../deploy/README.md) describes an
operator-configured six-hour offsite copy, independent retention and periodic
offsite drills; no offsite cron or alert service is installed by this change.

Before opening traffic, assign an on-call recipient and demonstrate a delivered
test alert through the approved monitoring system. The following are proposed
operational gates tied to existing signals, not claims that alerting is installed:

| Signal | Initial action threshold / response |
|---|---|
| Missing local backup | Existing 26-hour health threshold or any failed release-point backup: hold release, inspect backup/disk/authentication |
| Missing offsite backup | Older than 30 hours: alert and hold release until copy/decryption/restore is verified |
| Certificates / review expiry | Track actual NotAfter and the fixed Runtime review deadline; alert with enough renewal lead time, never continue past expiry |
| API readiness / worker presence | Failed dependency health or no authenticated worker while work waits: close admissions, inspect queue/API/Redis/executor; worker presence itself expires after 30 seconds |
| Queue / leases | Rising waiting/active/delayed/failed counts, stale judging beyond normal recovery window or repeated recovery generations: incident; retain IDs privately and inspect acknowledgements |
| Resource bounds | OOM/restart, Redis noeviction write refusal, disk below agreed restore/WAL reserve, lock wait over migration budget: stop rollout before exhausting storage |
| Data invariants | Goal/history loss, owner/version mismatch, duplicate award or statistics mismatch: stop admissions and preserve evidence |

Container logs rotate at 10 MB × three files. Preserve sanitized incident logs
before rotation; restrict executor logs because untrusted output can contain
user material. CI currently keeps dependency/SBOM, image and restore artifacts
30 days and native/Compose/browser evidence seven days. Verify the final workflow
values and export the accepted raw artifacts before expiry, together with their
GitHub digest, run/attempt, source/checkout tree and review receipt. Archive no
credentials, dumps, user source or hidden tests in public GitHub evidence.

Schedule approved offsite restore drills at least quarterly and before a
PostgreSQL major upgrade; keep their data size, recovery duration, selected
backup age, cleanup and invariant results. Establish production RTO/RPO and
alerting baselines from these actual exercises. Until then, operational
migration/recovery/retention, host isolation, gateway/certificate operations and
long-duration capacity remain external gates even when code integration is ready.
