# Phase III progress and exact resume checkpoint

Checkpoint date:2026-11-16. Current GitHub state always overrides this historical
document. [Issue #72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72) and
[final PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63) retain later
source/tree/run/merge receipts without requiring a self-referential source commit.

## Verified recovery

Phase II was already complete: integration45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4,
tree141e2df98ff4739c1c574bd2a3165858c2a9ebc9, allPR64–71 merged and final
run43809685401 all12 green. Older pending document sections were superseded by
later execution receipts. [PHASE3-BASELINE.md](PHASE3-BASELINE.md) records the
independent recovery and the preserved pre-existing Dependabot PRs51/52/53.

## Observed GitHub state at this checkpoint

- Main: `6176015b63a1615cc2269172f246725ef08abab3`, unchanged.
- Integration: `87cc1e724f3c5bba8ee4a1d3e138c16a18202f02` after PR75.
- Final PR63: OPEN / UNMERGED; no duplicate final PR created.
- Verified product PRs73/74/75 are integrated. PR76's current-base CI passed all12,
  but its merge is held for the later Runtime advisory change observed in PR77.
- Final evidence branch `overhaul3/phase3-validation` intentionally includes the
  pending reviewed DB source so its complete-stack browser probe can run while
  PR76 validates. It must not merge before PR76, a refresh to the resulting base,
  and a fresh final-head full CI. No pending state is represented as integrated.

| PR / branch | Accepted or candidate source | Full CI | State at checkpoint |
| --- | --- | --- | --- |
| [73](https://github.com/yakisoba0728/UnsolvableOJ/pull/73), `overhaul3/learning-api` | `b09d2289e2645334070f0d067e6f8dfdef5aac49` | [43816883930](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43816883930),12 success | INTEGRATED as `b6114fc4bd10bafa889097997aee70b7b284a38c` |
| [74](https://github.com/yakisoba0728/UnsolvableOJ/pull/74), `overhaul3/runtime-security` | `dfcf742963f7dde8d6a5ba72edc3dec1f0b7d96b` | [43818814392](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43818814392),12 success | INTEGRATED as `a30b0b358f88de506efe910c491d2f12ed980238` |
| [75](https://github.com/yakisoba0728/UnsolvableOJ/pull/75), `overhaul3/vibe-consistency` | `8e640b90709d37f979f4208c186c25440b96514f` | [43821157776](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43821157776),12 success | INTEGRATED as `87cc1e724f3c5bba8ee4a1d3e138c16a18202f02` |
| [76](https://github.com/yakisoba0728/UnsolvableOJ/pull/76), `overhaul3/database-performance` | `e3aa50c4cdcadaa0dd965a29086c0148b79261a8` | [43822819719](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43822819719),12 success | IMPLEMENTED / TESTED / INDEPENDENTLY REVIEWED / CI VERIFIED; merge held for newer security evidence |
| [77](https://github.com/yakisoba0728/UnsolvableOJ/pull/77), `overhaul3/phase3-validation` | `e23729640b0ce18b6bb5ab82c578dc1eb35c7392` | [43823181757](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43823181757), failed | Browser probe succeeded; Runtime advisory gate and required gate BLOCKED |

The exact source trees, Actions merge checkouts and actual counts are in
[PHASE3-VALIDATION.md](PHASE3-VALIDATION.md). Earlier green runs on older bases
were retained as history and never substituted for a refreshed source gate.

## Current local verification and remaining gate

Combined DB/Vibe/executor tree483d4e29db0274b07fc46decf62e4bc1f8a412b0 passed
lint/types/build,327 units,243 actual PostgreSQL/API cases in40files (95.73s),
and the full migration chain. Both new migrations remain ordered179600→179610.
The author-separated composition review found all incoming and feature blobs
preserved outside the explicit registration union. API and migrations ran after
the build, against fresh owned PostgreSQL17.11/Redis8.10.3 instances.

The final evidence work has retained the controlled DB samples, four source-bound
frontend builds, independent reviews and original failure logs. The browser
measurement protocol was executed in PR77's successful Compose job:3 visits,
15 period changes and18 real API/UI assertions. Its original ZIP/JSON and exact
source/tree/run provenance are retained, while independent raw-result review is
recorded separately. This does not override the overall run's security failure.

The newer scanner DB changed16 of the reviewed182 HIGH/CRITICAL advisory
fingerprints. Same990-file payload and same177/5 raw counts do not permit reuse of
old approval. Separate narrowly bound primary-source revalidation is in progress;
no evaluator weakening, DB rollback or expiry extension is authorized. Read the
latest [issue72 checkpoint](https://github.com/yakisoba0728/UnsolvableOJ/issues/72)
before resuming that work.

Next authorized actions: complete and independently review the fresh Runtime
evidence, pass full CI and integrate its separate response; refresh PR76 to the
actual new base and rerun full CI before merge. Then refresh the final evidence
PR, preserve browser review/results and complete reports, independently review
the composition, pass full CI and integrate. Verify the final PR63 integration
head, update its receipt and keep main unmerged.

## Limits and resume instructions

Runtime raw HIGH177/CRITICAL5 and the2026-11-30 00:00UTC applicability expiry are
unchanged. Host isolation/kernel, production migration, sustained mixed load,
all-language memory semantics and whole-site visual/accessibility completion are
not certified. [Roadmap](PHASE3-ROADMAP.md) gives priorities and evidence needed.

If interrupted, fetch actual GitHub state first, read the newest PR63/issue72
receipt and each open feature PR, then branch from the actual current integration.
Inspect ongoing Actions before dispatching duplicate work. Do not reset to this
checkpoint. Local/API commit identities may differ but complete trees are checked
before publication. Resolve incoming migrations/selectors by preserving both
contracts, rerun affected checks, and require current-head full CI before merge.
No force push, main merge, production operation or paid provider call is authorized
by this engineering checkpoint.
