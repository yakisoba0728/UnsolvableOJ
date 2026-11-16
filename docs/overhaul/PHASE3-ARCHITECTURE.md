# Phase III architecture and contracts

This is an incremental continuation of the verified Phase I/II tree. No framework,
database engine or judging engine was replaced. No production deployment or
schema operation was performed. Exact CI/integration receipts are recorded in
[PHASE3-VALIDATION.md](PHASE3-VALIDATION.md) and the existing final PR #63.

## Personal learning read model

`UsersController` exposes an authenticated `GET /users/me/learning` and delegates
the query to the new `LearningService`. Its DTO permits only 7, 30 or 90 days.
One PostgreSQL statement produces a consistent window of KST activity, current
public ordinary-problem statistics and bounded continuation targets.

There is no per-user cache, background materialization or new dashboard table.
The existing authenticated user ID is the only ownership selector. Test runs,
enterprise attempt IDs, private/unpublished problems and future-dated submissions
are excluded. Review suggestions additionally consult lifetime credited solve
evidence, so a later wrong answer does not reopen an already solved problem.

The response is bounded at 90 days, five difficulty categories, twenty tags and
ten review problems. SQL still processes matching submissions in the selected
window; bounded output is not constant database CPU. Old profile/history consumers
of full submission history have not all been migrated to this endpoint.

The React route is lazy. Account/login identity owns the whole screen; period
identity owns its request. Cleanup aborts obsolete work, and a microtask boundary
allows development StrictMode cleanup to cancel before starting network traffic.
The UI uses an exact daily table alongside the grouped visual chart, ordinary
keyboard controls and explicit loading, empty and retry states.

## Immutable Vibe execution contract

| Persisted object | Responsibility |
| --- | --- |
| `vibe_challenge_versions` | Canonical content-addressed JSON for task metadata, all initial files, editable paths, harness, fixtures, prompts and supported protocol identifiers; update rejection and referenced-version deletion protection |
| `enterprise_vibe_versions` | Assessment selection order, selected content digest and private model identifier |
| `vibe_attempts.challenge_version` | Required provenance shared by views, edits, runner, final scoring and staff/revision inspection |

Ordinary metadata edits retain selection contracts. The explicit pre-start refresh
updates current content/model. Unknown historical selections and inconsistent
archives fail closed instead of silently grading against the latest catalog.
The server projects only authorized public metadata and version IDs; no fixture,
harness, hidden diagnostic, AI system prompt or model setting is added to browser
responses. Runtime result counts determine the execution-score denominator.

This records the model name and evaluation inputs. It does not pin provider
weights, prove AI evaluation quality, or promise deterministic model output.
Provider calls in verification use approved doubles. A native API test preserves
the real HTTP, database, runner, sandbox and result persistence path while replacing
only the paid AI evaluation boundary.

Migration `1796000000000` embeds a frozen historical baseline rather than importing
the live catalog. It cannot reconstruct content that was never historically stored.
New attempts have no implicit version default. An operational rollout must stop old
writers at the migration boundary. Rollback refuses unsafe loss of selected content
or model provenance. See [PHASE3-VIBE.md](PHASE3-VIBE.md).

## Statistics write model

Migration `1796100000000` retains current-verdict statistics, separate from the
solve/XP ledger and retained learning-completion evidence. Rejudging can revoke a
credited solve and XP when no qualifying alternative remains; that ledger is not
immutable. Statement transition tables produce accepted/finished deltas
by problem and user. `problem_solver_counts` tracks accepted multiplicity; zero
removes a pair, and crossings of zero change distinct solver count.

Affected statistics rows are acquired in UUID order before applying pair deltas.
The counter FK targets the already-locked statistics row. No new user FK introduces
a reverse user lock edge; authoritative submission deletion drives user cleanup.
Same-problem writes still serialize, but the work inside that lock is proportional
to changed pairs instead of the problem's full history.

The schema adds positive/nonnegative consistency checks. Corruption that would
produce a negative multiplicity aborts the entire write. It is not silently clamped.
The upgrade reconciles statistics before filling counters and takes explicit writer
locks. Down restores the original recount function/trigger and retains submissions,
users, problems and XP. This is a blocking migration requiring rollout rehearsal.
The two new migrations must remain registered in chronological order.

Transition-table UPDATE processing also runs for heartbeat writes. Its measured
fixed overhead and additional counter storage/write costs are intentional recorded
tradeoffs, not omitted regressions. See [PHASE3-DATABASE.md](PHASE3-DATABASE.md).

## Dedicated executor boundary

The worker now parses and validates its environment before connecting. Dedicated
mode requires HTTPS callbacks, verified Redis TLS, bounded numeric settings and
distinct sufficiently long credentials. Optional CA/certificate/key files provide
private trust and mutual authentication. There is no verification-disable flag or
plaintext fallback in that TLS path.

The dedicated Compose template contains only the worker and go-judge. The worker
joins the application and internal sandbox networks; go-judge joins only the
internal sandbox network. Neither publishes a host port or mounts host data. The
worker uses UID/GID 1000:1000, dropped capabilities, no-new-privileges, a readonly
root and a bounded non-executable tmpfs. The sandbox retains the privileged mode
required by the current engine and its existing nested isolation controls.

The rendered-config checker accepts only the three own named Redis identity keys,
their canonical mount paths and the sandbox's single authentication environment
entry. Docker's decimal byte-string and absolute-secret-path normalization is
supported without permitting fractions, unsafe integers, inherited properties,
renamed paths or extra credentials.

Container networking is not VM isolation. A compromised privileged go-judge host
can obtain colocated worker credentials. Host kernel, actual firewall/egress/ACL
configuration and a real dedicated-host deployment remain unverified. The API Vibe
execution path is not relocated by this worker-template change.

## Public API and compatibility summary

| Surface | Compatibility decision |
| --- | --- |
| Learning GET | New authenticated endpoint; existing APIs retained |
| Enterprise Vibe metadata | Additive version summaries and explicit refresh field; archived selected labels are used |
| Internal Vibe runner | Explicit immutable content argument required; supported protocol checked |
| Database | Two ordered transactional migrations; new Vibe writers required after cutover; conservative rollback guards |
| Problem statistics API | Existing response and count semantics retained |
| Dedicated worker configuration | Previously implicit external encryption becomes an enforced TLS/HTTPS contract in dedicated mode; embedded development mode retained |
| Dependencies/runtime image | No new application dependency or runtime image package change introduced by these features |

Existing algorithm version pinning, bookmark ownership, enterprise result
pagination, lease/callback/rejudge recovery and CI failure conditions are preserved.
