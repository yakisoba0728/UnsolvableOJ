# Phase II progress and resume contract

Implementation checkpoint: 2026-11-16 04:54 UTC, after PR #68 integration and independent actual-image/full-CI verification. Live GitHub is authoritative; re-read heads, open PRs and exact-head runs before resuming. The later final-evidence PR and post-merge integration run are recorded in the final verification receipt on PR #63; this immutable document does not predict its own future commit or CI result.

Original integration: `c8ba9712d1a29ac633519511e50428ef647edf66`. Observed implementation integration: `bfb6adaa28d5d99d34d6bc8051f06fe1aa0c6ee3`. Main remains `6176015b63a1615cc2269172f246725ef08abab3`. [PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63) stays open and unmerged. No deployment or production data operation is authorized.

## Verified integration history

All seven entries below received independent source review and all 12 jobs of the specified exact-source-head CI before merge. These are historical component gates, not evidence for subsequent heads.

| PR | Work | Tested source HEAD | CI run | Integrated commit |
|---|---|---|---|---|
| [64](https://github.com/yakisoba0728/UnsolvableOJ/pull/64) | TypeORM dependency correction and npm SBOM | `b483747c658a25154542149a13abec2dffbae638` | [43790101564](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43790101564) | `8a72b3701a94153a5b5ab353a6af5efc15378d3c` |
| [66](https://github.com/yakisoba0728/UnsolvableOJ/pull/66) | Private problem bookmarks | `6476ecab594078a7b9e9e7801d15c289dc6eeb9c` | [43792648475](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43792648475) | `8793dcd1604f51b501655da0a40660e31bc34d6c` |
| [65](https://github.com/yakisoba0728/UnsolvableOJ/pull/65) | Judge readiness, capacity and recovery | `f1985dd19e3baf094bf82131250fb46bc5398941` | [43794094432](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43794094432) | `71a27cb17d10008d9961ff467a8be05150b801bb` |
| [67](https://github.com/yakisoba0728/UnsolvableOJ/pull/67) | Immutable exams, start races, frontend ownership and re-audit | `19a085d35178fa3f1e6adc4443fbf93a8aaeca1e` | [43795876240](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43795876240) | `1b2ada7c3ebb097936c94bd19e09c5401a204f73` |
| [69](https://github.com/yakisoba0728/UnsolvableOJ/pull/69) | Bounded enterprise results and full-validation opt-in | `6f638e147b27ba0b57fbf1eca3a8f75075fccf0c` | [43798756788](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43798756788) | `e97b08a238798f740438118818d8dd75e68173d8` |
| [70](https://github.com/yakisoba0728/UnsolvableOJ/pull/70) | Exam metadata, complete audits, owned Redis/rejudge recovery and live exam flow | `d5dc5a9cfa627a505efeeac6458a7d9556b71e06` | [43800127993](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43800127993) | `e7caa9b3aa23ac051e3a786780bc3b8c0780affa` |
| [68](https://github.com/yakisoba0728/UnsolvableOJ/pull/68) | Actual shipping-image remediation, precise component evidence and enforced gate | `0e70a2fe6d725362bcb248836c3697d310e16742` | [43805214804](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43805214804) | `bfb6adaa28d5d99d34d6bc8051f06fe1aa0c6ee3` |

## Active work and honest evidence states

| Work | Observed state | Remaining gate |
|---|---|---|
| Owner results pagination / global scores / measured API and memory reduction | INTEGRATED PR #69 after all 12 full jobs passed, including real WebKit/Firefox, 74 native, 26 pipeline and 2 Compose cases | Combined final integration validation still required |
| Actual four-image vulnerability audit | INTEGRATED #68 after all12 full jobs; Back/Front/Judge raw PASS, runtime separately PASS_WITH_REVIEWED_COMPONENT_FINDINGS | Raw runtime177 HIGH/5 CRITICAL remain visible; exact182 header decisions/990 files; expiry2026-11-30; host UNVERIFIED |
| Image package patches / minimal go-judge security rebuild | INTEGRATED #68; actual native74/pipeline28/Compose3, auth-redaction and505-package Go import guard passed | Lower runtime findings, main-module `(devel)` coverage and remaining version-tagged infrastructure are disclosed |
| Owned Redis daemon restart / interrupted rejudge | INTEGRATED #70; pipeline28 including both new scenarios passed; original artifact/digests retained | Abrupt power loss, corruption and multi-hour chaos remain unverified |
| Complete dev + production dependency audit | INTEGRATED #70; all six actual CI scopes zero | Dated advisory result, separate from image/host findings |
| Candidate submission title / owner selected-version metadata | INTEGRATED #70; actual API209, three-engine pinned-summary regressions and live exam/Judge flow passed | No private-current-version title or hidden test cases are exposed by the new projection |
| Combined verification tree | INTEGRATED #70, then #68 at source0e70 after all12 jobs: Back320, API209, native74, pipeline28, Compose3, actual browser707 + browser-free unit85 | Final evidence PR and post-merge final integration HEAD receive their own full CI; see PR #63 final receipt |

The first PR #69 run, 43797162669, reported overall success but executed only 11 jobs; native validation and the Firefox/WebKit selection were skipped. It was not accepted as full validation and the PR was not merged. An independently reviewed positive `full-validation` label now requests all component/native/browser checks and its `labeled` event triggers execution. This only adds coverage; no failure gate, assertion, rate limit or existing selection rule was relaxed.

## Resume order

1. The seven implementation PRs above are integrated. Re-read PR #63's live final receipt before further work; do not reuse an earlier component run as final-head evidence.
2. The final-evidence branch contains the consolidated report, original artifacts, independent review and measured tradeoffs. Its own independent review and full CI are required before integration; after merge, all12 jobs must execute again at the final integration HEAD. The coordinator records that exact head/tree/run in PR #63 without another source mutation.
3. Preserve raw scanner counts and the narrowly reviewed component evidence. Every changed/new/missing reviewed record, altered byte proof or expiry blocks reuse. Host-kernel readiness stays unknown; the review is never automatically renewed.
4. Leave PR #63 open and main unchanged. If a final required job fails, record the failure and stop any readiness claim until it is corrected and rerun.
5. Dedicated execution-host security, production rehearsals, long-duration load and real-user browser vitals remain separate obligations. PHASE2-FINAL-REPORT lists the other deferred items.

Coordinator owns publication/merges. Authors use isolated worktrees, reviewers do not review their own implementation. Git recreates local commits with equal tree hashes through the authenticated connector; remote source heads and actual CI merge commits must both be recorded. No background continuation is promised after the active session ends.
