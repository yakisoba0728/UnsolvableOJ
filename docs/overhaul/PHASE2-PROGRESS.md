# Phase II progress and resume contract

Checkpoint: 2026-11-16, after independent composition review of local `3d43b4dde170266a22e2a49043ba66c3919ce936`. Live GitHub is authoritative; re-read heads, open PRs and exact-head runs before resuming.

Original integration: `c8ba9712d1a29ac633519511e50428ef647edf66`. Current observed integration: `e97b08a238798f740438118818d8dd75e68173d8`. Main remains `6176015b63a1615cc2269172f246725ef08abab3`. [PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63) stays open and unmerged. No deployment or production data operation is authorized.

## Verified integration history

All five entries below received independent source review and all 12 jobs of the specified exact-source-head CI before merge. These are historical component gates, not evidence for subsequent heads.

| PR | Work | Tested source HEAD | CI run | Integrated commit |
|---|---|---|---|---|
| [64](https://github.com/yakisoba0728/UnsolvableOJ/pull/64) | TypeORM dependency correction and npm SBOM | `b483747c658a25154542149a13abec2dffbae638` | [43790101564](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43790101564) | `8a72b3701a94153a5b5ab353a6af5efc15378d3c` |
| [66](https://github.com/yakisoba0728/UnsolvableOJ/pull/66) | Private problem bookmarks | `6476ecab594078a7b9e9e7801d15c289dc6eeb9c` | [43792648475](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43792648475) | `8793dcd1604f51b501655da0a40660e31bc34d6c` |
| [65](https://github.com/yakisoba0728/UnsolvableOJ/pull/65) | Judge readiness, capacity and recovery | `f1985dd19e3baf094bf82131250fb46bc5398941` | [43794094432](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43794094432) | `71a27cb17d10008d9961ff467a8be05150b801bb` |
| [67](https://github.com/yakisoba0728/UnsolvableOJ/pull/67) | Immutable exams, start races, frontend ownership and re-audit | `19a085d35178fa3f1e6adc4443fbf93a8aaeca1e` | [43795876240](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43795876240) | `1b2ada7c3ebb097936c94bd19e09c5401a204f73` |

| [69](https://github.com/yakisoba0728/UnsolvableOJ/pull/69) | Bounded enterprise results and full-validation opt-in | `6f638e147b27ba0b57fbf1eca3a8f75075fccf0c` | [43798756788](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43798756788) | `e97b08a238798f740438118818d8dd75e68173d8` |

## Active work and honest evidence states

| Work | Observed state | Remaining gate |
|---|---|---|
| Owner results pagination / global scores / measured API and memory reduction | INTEGRATED PR #69 after all 12 full jobs passed, including real WebKit/Firefox, 74 native, 26 pipeline and 2 Compose cases | Combined final integration validation still required |
| Actual four-image vulnerability audit | IMPLEMENTED and REVIEWED; [PR #68](https://github.com/yakisoba0728/UnsolvableOJ/pull/68); all four scans ran and found HIGH/CRITICAL issues | Scan run [43796045174](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43796045174) is failed evidence; remediation, applicability review and rescan required |
| Image package patches / minimal go-judge security rebuild | REVIEWED `ef6e96ef9022eea9d8e729507811fc9edc6942eb`, published as `1b6700546e44d67a3a6d78fd8a1087500cca1fa5` | Actual Docker builds, language/pipeline/Compose regression and image rescan |
| Owned Redis daemon restart / interrupted rejudge | REVIEWED `dada9b51270f2ad991ec610d045c42a8e0a3d9cc`; safe fixture guards tested | Actual native scenarios have not yet executed; full combined CI required |
| Complete dev + production dependency audit | REVIEWED `b8b8a6d04d8bf133cfe8ddd0b921c46672eac889`; six fresh audit scopes zero; production lock entries unchanged | Combined exact-head CI |
| Candidate submission title / owner selected-version metadata | REVIEWED `b479145c2d717a90f80c8cf2030e0c5fc5b263ae` and `c1353035a4fd99e0c3f245bd50a779ffbf0f6866`; real API regressions pass | Three-engine pinned-summary cases and real exam/Judge browser flow in combined CI |
| Combined verification tree | REVIEWED `3d43b4d`; fresh Back 320 units, actual PostgreSQL API 209/209, Front checks; independent React DOM ownership/refresh/results probes pass | Publish verification PR against latest integrated base, exact-head full CI, integrate |

The first PR #69 run, 43797162669, reported overall success but executed only 11 jobs; native validation and the Firefox/WebKit selection were skipped. It was not accepted as full validation and the PR was not merged. An independently reviewed positive `full-validation` label now requests all component/native/browser checks and its `labeled` event triggers execution. This only adds coverage; no failure gate, assertion, rate limit or existing selection rule was relaxed.

## Resume order

1. PR #69 is integrated at the checkpoint above. Re-read integration before publishing or merging further work; do not reuse its CI as final-head evidence.
2. Publish reviewed image remediation onto PR #68, reconcile the latest integration, build/scan actual images, preserve all raw findings and independently resolve applicability. Unknown or unproven findings remain blocking. A header package is not the running host kernel.
3. Publish the reviewed combined verification change; execute the new owned Redis/rejudge scenarios and real exam browser flow. Diagnose failures without skipping tests or widening existing success thresholds.
4. Reconcile every advancing base, review the combined source and rerun its exact final HEAD. Update review/validation/final reports and PR #63 only from completed evidence.
5. Leave PR #63 unmerged and distinguish code integration readiness from deployment readiness. Dedicated execution-host security, long-duration load and real-user browser vitals remain separate obligations.

Coordinator owns publication/merges. Authors use isolated worktrees, reviewers do not review their own implementation. Git recreates local commits with equal tree hashes through the authenticated connector; remote source heads and actual CI merge commits must both be recorded. No background continuation is promised after the active session ends.
