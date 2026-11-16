# Phase III — immutable Vibe assessment content

Implementation baseline: `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`. This is an
implementation and local-verification checkpoint. Independent review, exact-head
GitHub CI, native sandbox execution and integration are separate gates recorded
in the work PR and Phase III progress ledger after they actually complete.

## Problem and accepted behavior

Phase II froze algorithm questions. Vibe assessment selection still stored only
`post-search-v1`; the workspace, AI prompts, runner harness, tests and result title
read mutable module exports. A deployment changing those exports could therefore
give candidates different instructions or grade previously saved code against
later fixtures. A source comment asking maintainers to change the ID did not
enforce that boundary. Final scoring also assumed exactly eleven cases.

The same supplied-contract regression was executed with the actual Phase II
`vibe.runner.ts` and failed. The corrected runner passed without changing the
assertion. The temporary original-source substitution was restored immediately.
This is a runner-contract unit reproduction, not a complete deployed before/after
system test: [before](evidence/phase3-vibe-runner-before.log),
[after](evidence/phase3-vibe-runner-after.log).

- Each content version archives public task metadata, initial files, editable
  paths, harness, public/hidden fixtures, assistant/reviewer system prompts and
  supported runner/reviewer protocol identifiers.
- SHA-256 covers the complete canonical JSON representation, independent of JSONB
  object-key ordering. Arrays retain their order. Existing content is deduplicated
  by its digest; archives cannot be updated and referenced versions cannot be
  deleted.
- Enterprise selection binds that version before candidates start. Ordinary
  metadata saves and reordered unchanged selections keep their version. An
  explicit `refreshVibeVersions: true` selects current content only before start.
  The selection also retains the private AI model identifier; ordinary saves
  preserve both content and model, and explicit refresh updates both.
  Removing and re-adding is a new selection. An archived selection remains usable
  after its ID leaves the current catalog; refreshing such an ID is refused.
- Read-only archived project files are copied into the real compile workspace
  along with editable saved files; the screen, AI and runner see the same project.
- Each practice/workspace records its version. Rendering, save/apply validation,
  AI assistance, execution, final scoring, reevaluation and staff/revision views
  read the same archived contract. The runner requires its content argument;
  there is no implicit current-catalog execution fallback.
- Missing or unsupported snapshots and inconsistent hashes fail closed. Missing
  assessment bindings return 503 instead of selecting current content.
- Outcome denominators come from the selected public and hidden cohort. A six-case
  version can earn 40/40; it is not divided by the old hardcoded eleven.

The tests remain server-side. Candidate and owner metadata projections do not
return fixtures, harness, AI instructions, model configuration or archive objects.
Existing owner/candidate authorization, invitation, revision, busy-operation and
score-visibility checks are retained.

## Data model and migration

Migration `1796000000000` adds:

| Object | Contract |
|---|---|
| `vibe_challenge_versions` | One immutable content JSONB document per 64-character digest; composite challenge/version key |
| `enterprise_vibe_versions` | Assessment/challenge selection, digest, private AI model and unique bounded position; assessment deletion cascades the selection |
| `vibe_attempts.challenge_version` | Required composite FK to archived content, with a reverse lookup index |

The migration embeds a frozen baseline document. It does not import the live
catalog. Historical records are bound **at the migration cutoff**; this cannot
reconstruct earlier deployment content that was never stored. Existing saved
files, revision rows and reports remain unchanged. Unknown historical challenge
references abort rather than being omitted. If historical workspaces for a test/task
contain one model identifier, that observed identifier is retained. Multiple
historical model identifiers cause atomic refusal. A test without a workspace
uses the migration-time configured model, or the frozen `gpt-6-luna` default;
that cutoff choice does not reconstruct an unknown earlier selection policy.

New attempt writes must provide a version. There is deliberately no column
default silently assigning old content. A production rollout must stop old Vibe
writers at the migration boundary and deploy the compatible application before
resuming them. Mixed old/new writer operation is not claimed safe. No production
migration was performed.

Rollback preserves baseline records and can be reapplied. It refuses rollback
after a non-baseline version is referenced by an assessment or workspace, or a
selected model differs from the legacy configuration to which rollback would
return, avoiding silent loss of grading provenance. A production-scale migration lock/storage
rehearsal is still required.

## Additive API and interface contract

| Surface | Added or changed behavior |
|---|---|
| `GET /vibe/challenges` | Public challenge gains `version`; no server-only content |
| Owner test create/list/detail/update | `vibeChallengeVersions: [{challengeId, version}]`, `vibeVersionPolicy: "ON_SELECTION"` |
| Owner test detail | `selectedVibeChallenges: [{id, version, title, difficulty, stack, durationMin}]`; six-field whitelist after authorization |
| `PATCH /enterprise/tests/:id` | Optional boolean `refreshVibeVersions`; independent of algorithm refresh |
| Candidate/result `vibeTasks` | Title comes from the selected version; `challengeVersion` identifies it |
| Practice history/workspace/staff review | `challengeVersion`; content uses that archive |
| Staff revision response | `challengeVersion` beside the retained editable files |

The frontend companion changes use authorized selected metadata for owner detail,
results labels and edit forms, retain catalog-removed selections, and provide a
separate explicit refresh checkbox. Five browser cases cover retained labels,
intentional refresh and selection removal. Their implementation/type/build checks
and actual browser execution belong to the frontend PR/CI record; backend tests
do not certify browser behavior.

## Additional privacy correction

The runner formerly suppressed hidden-test diagnostics only when a display name
started with the Korean word `숨김`. The new implementation uses the server-side
public/hidden cohort classification. A renamed hidden case therefore cannot
expose expected output or submitted private fixture data through failure details.
The selected-contract unit and native regression both use a hidden case without
that prefix.

AI calls use archived instructions and templates, the selected/saved attempt model, and
actual message/event/run identities. Unit tests replace the provider function;
Ordinary API tests replace assistance/evaluation and the runner. No paid model request was made. Existing
request limits, timeout and no-retry settings remain. This records the requested
model identifier, not the provider's underlying weights or deterministic output.

Independent review reproduced two additional contract gaps in `c3fa9b2`: the
workspace model still followed a later configured model, and read-only template
files were absent from compile payloads. Both were corrected before acceptance.
The model test simulates a later deployment's model policy by replacing the
configuration getter. Current environment validation allows only `gpt-6-luna`;
this is not an exploitable model switch under the present allowed environment.
Likewise, the baseline template did not yet import a read-only source module.
These are concrete future-version consistency corrections, not newly discovered
current P1 exploits. [Model reproduction](evidence/phase3-vibe-model-before.log)
and [template reproduction](evidence/phase3-vibe-template-before.log) retain the
independent reviewer evidence. The template reproduction observes compile
payloads; it does not claim native execution.

## Validation checkpoint

All local DB work used owned PostgreSQL 17.11 and Redis 8.10.3 instances with fresh
temporary storage and random loopback ports. Existing databases and Redis data
were not used. The integration runner creates/drops its own disposable database.

| Verification | Observed checkpoint |
|---|---|
| Original runner selected-contract regression | 1 failed, demonstrating current-catalog execution |
| Corrected identical regression | 1 passed |
| Backend lint/types/units/build | 327 unit cases passed; final work-PR checks are separate |
| Selected version/model/migration + existing Vibe APIs | 24 passed across 4 files after review corrections (13 new cases) |
| Existing Vibe/enterprise/result/submission concurrency plus new contract | 26 passed across 5 files at the earlier four-case version checkpoint |
| Migration chain | Legacy upgrade, fresh installation, rollback/reapply, preserved evidence and refusal cases passed |
| Full PostgreSQL/API regression | 219 passed before the model correction; post-correction full run recorded separately when complete |
| Native Vibe validation | Four direct-runner cases plus one real HTTP/API/DB/runner case implemented/typechecked; only the paid AI provider is replaced in the latter; exact-head Actions execution required |
| Frontend browser behavior | Companion cases require exact-head Actions; local browser startup is unavailable |

Raw local evidence: [version/migration API](evidence/phase3-vibe-version-api.log),
[migration chain](evidence/phase3-vibe-migrations.log),
[model/template correction API](evidence/phase3-vibe-model-api.log). Initial author verification
caught a test-file brace error and a missing `initialFiles` field in the AI review
prompt; both were fixed before acceptance. The archived-template AI regression
now checks the actual outgoing provider-call payload using a test double.
The model follow-up's first author check caught an unintended type change in the
algorithm binding parameter map; it was restored before any accepted build.
Its first API run also hit cumulative start quotas from unrelated test cases.
The fixture now clears only its owned test Redis throttle keys between cases,
matching the existing enterprise Vibe suite; product limits and assertions remain
unchanged.
A local full-suite attempt also overlapped `nest build` (which deletes `dist`)
with seed-CLI tests, causing four `ERR_MODULE_NOT_FOUND` failures. This author
execution error is recorded separately from product failures. The same unchanged
application is rerun after the build, without relaxing any assertions.

Reproducible project commands, with an owned PostgreSQL/Redis fixture configured:

```sh
npm run check --prefix Back
cd Back
node scripts/check-migrations.mjs
node scripts/run-integration.mjs e2e
node scripts/run-integration.mjs pipeline test/vibe.pipeline-spec.ts
```

The last command requires the dedicated disposable go-judge service configured
by existing CI. Four direct-runner cases cover the public/custom-test flow plus all hidden
checks, selected hidden-cohort identity and diagnostic privacy, compilation
failure, and runtime error/forged output. The fifth case saves a project through
HTTP, runs its selected version in the real sandbox, submits the same revision,
retains the outcome when the mocked AI provider is unavailable, and reloads the
persisted result. It does not use a browser and does not establish a full browser
Vibe workflow. No sandbox escape experiment is used.

## Costs and remaining limits

The current archived JSON serializes to 8,937 UTF-8 bytes (not a measured PostgreSQL
storage size) per distinct challenge version; each
workspace stores a 64-character reference rather than duplicating all content.
Operations read/hash that small archived document. Enterprise result metadata is
read once per selected task, bounded by the existing 20-task assessment limit,
not once per candidate. No latency, CPU, RSS or throughput improvement is claimed.

The historical result benchmark fixture was extended to provide explicit versions
when the archive schema exists. The older in-memory score benchmark now compares
its historical projection, explicitly excluding the newly added version field.
Previously recorded performance evidence is unchanged; no fresh benchmark result
is claimed by this feature.

This snapshot freezes the project/test and evaluator input contracts. The binary
Node/esbuild/go-judge versions still belong to the independently built/scanned
runtime image and can change across deployments. Exact cross-image execution
equivalence, historical pre-migration content, provider determinism, production
rollout/backup rehearsal and host isolation remain separate unresolved scopes.
