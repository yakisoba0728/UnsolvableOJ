# Phase II bounded implementation roadmap

Newly confirmed P0/P1 defects may interrupt this scope. Feature count is not a gate; correctness and evidence are.

| ID | User/system problem | Acceptance criteria |
|---|---|---|
| P2-DEP | Three known production dependency warnings | Remove vulnerable dependency chain without forced override; fresh production audit; Nest/type/unit/build, migrations and full HTTP regression; independent review and exact-head full CI |
| P2-BOOKMARK | No private cross-device shortlist for coding problems | Idempotent authenticated save/remove/status; server-side bookmarked list preserving search/filter/pagination; visibility and account isolation; useful accessible controls, errors/retry; migration/API/browser regressions |
| P2-EXAM-VERSION | Exam content can drift between candidates and submissions | Pin full algorithm-problem version when selected; unchanged selections remain pinned; explicit refresh before scheduled start; same statement/sample/limits/Judge version; hidden data excluded; rejudge preserves assessment version; atomic migration and API tests |
| P2-EXAM-START | Start can wait across policy/deadline changes | Lock test before fresh invitation/time decision; serialize with edit/delete while allowing parallel candidates; actual DB contention regressions |
| P2-EXAM-UI | Delayed mutations and session changes can redirect or erase another context | Login/route ownership and stale completion guards; same-login refresh preserves unsaved edits; actual React DOM before/after and selected three-engine browser regressions |
| P2-JUDGE | Insufficient capacity/negative-verdict/recovery evidence | Bounded real queue/worker trials; per-language/mixed workloads, queue percentiles/jobs per second/CPU/RSS; expand verdict matrix; distinguish link disruption from service-process restart; duplicate/stale fencing and learning/XP checks |
| P2-SUPPLY | npm audit does not describe shipping artifacts | Validated CycloneDX metadata from lockfiles; truthful runtime/build scope, pinned external actions review; distinguish image scan and deployed-image SBOM gaps |
| P2-VERIFY | New work needs independent integration evidence | Separate reviewer, exact-head CI, combine with latest integration, rerun final head full CI, leave #63 unmerged |

Current stack is retained unless dependency compatibility supplies concrete reasons for a targeted update. Unpaginated enterprise results, large-history query distributions, long-duration mixed failures, image CVE execution and browser vitals are investigated after core changes; any deferred item is explicitly recorded rather than claimed complete. New feature expansion stops until these core acceptance criteria are met.

The following bounded extension was admitted during the implementation/review gates: **P2-RESULTS**, paginated owner results with preserved whole-assessment summary, deterministic order, owner authorization, accessible page navigation, and real HTTP/DB before/after evidence. This does not authorize an unbounded feature expansion. All remaining investigations retain explicit completed/blocked/deferred accounting.

## Integration sequence

IMPLEMENTED → TESTED → INDEPENDENTLY REVIEWED → CI VERIFIED → INTEGRATED. Coordinator owns GitHub publication/merge; authors use isolated worktrees. All feature PRs target existing `overhaul/integration`. No force push, main merge or deployment.

## Implementation checkpoint closure

The seven implementation PRs in PHASE2-PROGRESS are integrated after independent
review and exact-source full CI. P2-DEP, BOOKMARK, EXAM-VERSION (algorithm
problems), EXAM-START, EXAM-UI, RESULTS and SUPPLY have the stated bounded code
and test evidence. P2-JUDGE includes all eight languages, actual natural-lease
and owned Redis/API/rejudge recovery, and finite worker-scaling trials; full
MLE coverage, sustained extreme-scale capacity and dangerous host-isolation
experiments are explicitly outside the completed evidence.

P2-VERIFY closes only when the final evidence PR passes its own review/full CI
and the post-merge exact integration HEAD passes all12 jobs. PR #63 stores that
final receipt without predicting future hashes in this report. The wider
unimplemented investigations remain in PHASE2-FINAL-REPORT, with operational
readiness separate from code integration.
