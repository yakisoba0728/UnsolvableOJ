# Phase II independent re-audit register

This register separates preserved Phase I behavior, fresh execution, new defects, and remaining evidence gaps. The starting source is `c8ba9712d1a29ac633519511e50428ef647edf66`; GitHub PR54–62 were independently confirmed merged into integration, with PR63 still open to main.

## Rechecking the 25 Phase I entries

Fresh [CI43790101564](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43790101564) at security head `b483747c658a25154542149a13abec2dffbae638` reran the preserved application code with the reviewed ORM upgrade: 296 Back unit cases, 179 actual API cases, 26 native runtime cases, 17 real pipeline cases, two live Compose browser flows, 603 standard browser/unit instances and 74 additional Firefox instances. The prior final CI was inspected as historical evidence, not substituted for this execution. This is suite evidence, not exhaustive state-space or line coverage.

| Phase I ID | Independent source/test check and fresh evidence | Qualification |
|---|---|---|
| INF-001 | Required job depends on audit/images/components; executable failure/cancellation policy tests rerun | GitHub branches remain unprotected; no ruleset was installed |
| INF-002 | Changed-file selection avoids early pipe reader failure; large-diff policy regression rerun | Static workflow execution, not every GitHub event |
| INF-003 | Integration-target trigger and forced full final PR selection verified; new PR64 actually exercised it | Per-HEAD results still required after every integration |
| REL-001 | Execution/contract/Compose paths select full validation; policy tests and actual native job passed | Dangerous escape testing remains excluded |
| REL-002 | Judge context still excludes `.env`, `.env.*`, `*.env`; image job passed | Preventive rule, no historical secret exposure was inferred |
| BE-001 | Submission transaction retains attempt lock then fresh eligibility read; `enterprise-submission-concurrency.e2e-spec.ts` rerun | A separate stale **start** path was found in Phase II |
| BE-002 | Vibe workspace creation reads `clock_timestamp()` after parent lock; existing real lock tests rerun | Does not certify native Vibe runtime equivalence |
| BE-003 | Quota serialization retains `FOR NO KEY UPDATE`; existing FK/attempt concurrency coverage rerun | Phase II introduced and then corrected a different start/withdrawal lock cycle |
| FE-001 | Header identity key, abort cleanup and notification query epochs retained; notification browser regressions rerun | Enterprise pages had separate ownership gaps |
| FE-002 | Synchronous request guard and ID-based list deduplication retained; browser cases rerun | Offset pagination can still change under unrelated new rows |
| FE-003 | List retry, read failure state and authoritative reconciliation retained; browser cases rerun | Real network partitions are covered separately by service tests |
| FE-004 | Optional telemetry still defers SDK load and rechecks privacy; seven telemetry checks/build rerun | Phase I byte savings not reused as Phase II speedup |
| FE-005 | In-flight read set/query invalidation and final refresh retained; regression suite rerun | Phase I independent four-ordering scratch experiment itself was not repeated |
| JG-001 | Internal transport still uses redirect rejection; worker HTTP tests rerun | No arbitrary external target was probed |
| JG-002 | Authenticated readiness and anonymous rejection retained; unit/native tests rerun | Redis consumer readiness required a separate Phase II correction |
| JG-003 | Offset-based output comparator and byte-differential tests retained and rerun | Historical microbenchmark timings are not new measurements |
| JG-004 | Recovery-budget comment agrees with lease behavior in source | Documentation-only correction, no invented runtime exploit |
| SEC-001 | Shared invitation predicate requires verified email; source and real API tests rerun | Username invitations/owner/public policies intentionally remain valid |
| SEC-002 | Callback details use submitted immutable snapshot; sample membership/duplicates validated; unit/API tests rerun | Trusted internal token is still a material boundary |
| SEC-003 | Vibe runner anonymous readiness rejection retained and covered by existing tests | No real paid AI/provider request was made |
| SEC-004 | Optional auth with pending password change uses anonymous visibility; unit/API regressions rerun | Mandatory auth behavior remains separately enforced |
| DB-001 | Map-based score assembly retained; score semantic tests rerun | Unbounded SQL/HTTP result size remained and is addressed separately in Phase II |
| DB-002 | Two user-first indexes remain registered; real migration/index API cases rerun | Prior reading-only timings do not establish write cost; Phase II adds a separate bounded measurement |
| TOOL-001 | Benchmark protocol/query-override/effective-host guards read and retained | Phase I dedicated adversarial harness experiment not all replayed |
| TOOL-002 | Generated DB ownership, owned child cleanup and empty Redis checks read; integration runner tests rerun | The historical eight-case HTTP safety drill was not recounted as new execution |

The count remains 25 mixed correctness/privacy/performance/process items, including defects found in Phase I tooling. It is not a count of 25 independent exploitable vulnerabilities. No previously verified correction was intentionally reverted.

## Phase II findings and corrections

| ID | Finding | Evidence / disposition |
|---|---|---|
| P2-DEP | Production dependency graph still had three moderate nodes from two advisories | Fresh baseline audit reproduced; TypeORM1.1.3 removes the vulnerable chain; ORM/API/migration/CI verified and PR64 integrated |
| P2-EXAM-VERSION | Assessment statements and per-submission versions could drift between candidates | Original-source content/metadata regressions failed; immutable selection-time bindings, refresh policy, hidden-data boundary and migration added |
| P2-EXAM-START | Start could commit after invitation revocation or deadline change while waiting | The same two real PostgreSQL/API cases on baselinec8 returned201 instead of404/409; corrected cases pass in the combined199-case API suite |
| P2-EXAM-SNAPSHOT | Initial Phase II save could revert a concurrent version refresh | Independent reviewer reproduced2→1 stale aggregate; lock then fresh projection fixed; identical independent regression passed |
| P2-EXAM-LOCK | Initial Phase II start could deadlock against withdrawal | Independent reviewer reproduced PostgreSQL40P01/HTTP500; user-before-test ordering and active-token recheck fixed; identical independent regression passed |
| P2-FRONT-OWNER | Enterprise stale deletion/start callbacks could navigate after route or login change | Actual original React source failed two DOM probes; immutable revised and combined source passed; three-engine browser regressions added |
| P2-FRONT-DRAFT | Ordinary same-login token rotation discarded unsaved assessment edits | Actual source probe observed form disappear then original title return; identity-keyed retained fetch preserves draft; new-login/account/test changes reset it |
| P2-JUDGE-READY | Readiness did not describe actual Redis consumer connectivity | Initial candidate premature heartbeat independently reproduced; both consumer/main links now required; unit regression and native CI gate |
| P2-TEST-POPULATION | Existing ranking assertion counted withdrawn fixture users | Real full API and CI failed; explicit high-XP deleted-user exclusion added; fresh187/199-case runs passed |
| P2-TEST-MIGRATION | Migration test included other files' synthetic assessments | Full API failure corrected through rollback-only fixture isolation; negative migration assertions retained |
| P2-TEST-LOAD | New Judge workload exhausted the existing per-IP admission budget | First native CI74passed/pipeline20of26passed; bounded header-based pacing added outside measurement, with no policy/counter/IP bypass |
| P2-RESULTS | Whole-assessment result materialization remained unbounded | Paginated owner workflow/global-summary semantics and HTTP measurements in progress; not complete at this checkpoint |

## Remaining scope

No complete WCAG certification, physical-device test, real-user Web Vitals, production migration/restore rehearsal, hostile sandbox escape claim, or arbitrary-scale capacity certification is made. Privileged go-judge still requires a trusted dedicated execution-host boundary; namespaces/seccomp/cgroups and non-destructive tests do not make it a VM. Image-CVE execution, actual Redis daemon restart and rejudge interruption have separate work/evidence and cannot be inferred from npm audit or proxy-link recovery. Final per-HEAD review/CI/integration states belong to PHASE2-PROGRESS and the live PR records.
