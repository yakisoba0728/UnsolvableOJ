# Phase IV delivery and manual-review report

This increment implements the two product features and bounded engineering work fixed in [ROADMAP.md](ROADMAP.md). The exact final integration SHA, Actions checkout/tree, twelve-job result and independent QA disposition are recorded after testing in the final Phase IV pull request and [Issue72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72). That acceptance receipt certifies the final commit; this source document does not anticipate its own future CI.

## Starting gate and branch preservation

The read-only gate passed before Phase IV mutations. Phase III source 3bcba380f92bd2da8973e6c88c00cd14b03be08e, tree bb7a10752038434c79b51282a5227186143ff405, had [run43834915085](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43834915085) with all twelve actual jobs successful. Checkout 7bb0b27e6f7a57bf2ba743dc8a765ac2ac312ecc had the expected parents and identical complete tree. Existing independent C approval is preserved in [PR63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63#issuecomment-6912127737) and [Issue72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72#issuecomment-6912145086). PRs76/77/78 were actually merged. [BASELINE.md](BASELINE.md) holds the full receipt.

All feature PRs target overhaul4/integration. While PR63 is unmerged, the final Phase IV PR is stacked on overhaul/integration and remains open for the user. Neither main (6176015b63a1615cc2269172f246725ef08abab3 at the start gate) nor the Phase III integration branch is written by this work.

## Delivered scope

| Area | Actual change | Review surface |
|---|---|---|
| Full CI | Phase IV selects all existing heavy suites and four image builds/scans; expression fixtures protect selection | [PR79](https://github.com/yakisoba0728/UnsolvableOJ/pull/79) |
| Shared UX | Lazy-route focus, loading announcement, keyboard disclosure, same-route/account/breakpoint focus handling | [PR80](https://github.com/yakisoba0728/UnsolvableOJ/pull/80), [FRONTEND.md](FRONTEND.md) |
| Learning goals | Persisted private goal, KST date window, server-derived distinct solves, real editing/progress/reset/removal | [PR81](https://github.com/yakisoba0728/UnsolvableOJ/pull/81), [LEARNING.md](LEARNING.md) |
| Enterprise results | Authorized consistent-snapshot CSV, 5,000-attempt cap, formula neutralization, status/score distributions, actual download | [PR82](https://github.com/yakisoba0728/UnsolvableOJ/pull/82), [ENTERPRISE.md](ENTERPRISE.md) |
| Vibe boundary | Verified HTTPS/mTLS, distinct bearer, bounded transport/cleanup and dedicated-host operator templates | [PR83](https://github.com/yakisoba0728/UnsolvableOJ/pull/83), [VIBE-TRANSPORT.md](VIBE-TRANSPORT.md) |
| Judge evidence | Twenty-four real mixed-language jobs, three waves on the same two workers, retained quotas and resource/invariant evidence | [PR84](https://github.com/yakisoba0728/UnsolvableOJ/pull/84), [PERFORMANCE.md](PERFORMANCE.md) |
| Recovery | Disposable generated databases, full migration chain, pg_dump/restore, content/schema/ledger checks, rollback/reapply, restored writes and cleanup | [PR85](https://github.com/yakisoba0728/UnsolvableOJ/pull/85), [RELIABILITY.md](RELIABILITY.md) |

The frontend inventory covers thirty page modules and their shared shell. This is a common interaction improvement plus two complete product flows, not a claim that every page received a visual redesign or complete manual accessibility certification.

Existing tokens, page headers, dialogs, skeleton/error components and dynamic titles are reused. Bookmarks, rolling learning statistics, the ten-item review queue, immutable assessments, enterprise pagination, admin operations and Vibe admission limits are existing capabilities, not newly counted features. No framework rewrite or new runtime dependency is needed.

### Product contracts

Learning permits one goal per account, targeting 1–1,000 distinct eligible problems over 7/30/90 KST calendar days. Repeated AC counts once; tests, enterprise/private/unpublished problems and out-of-window solves do not count. Identical save preserves dates; explicit restart includes today's eligible solves. User-first locking, active-account/token-version checks, withdrawal cleanup and account-owned UI requests protect mutations. Real Compose coverage uses repeated real submissions to establish distinct progress.

Enterprise authorization, count and export rows share one REPEATABLE READ snapshot. More than 5,000 attempts fails explicitly instead of truncating. Scalar columns exclude source/workspaces/email/hidden tests/invitation secrets. Formula-leading values are neutralized; fields are escaped and responses no-store. Pending evaluations remain separate from scored results. The interface covers authenticated text responses, downloads, busy/error states and account/navigation cancellation. Actual DB tests cover ownership, all-page export, the 5,000/5,001 boundary and a concurrent join.

## Findings resolved during verification

| Observation | Implemented resolution |
|---|---|
| Same-account bearer refresh could abort a learning write and admit an older read | Separate identity from token refresh in effect ownership; held-PUT/rotation browser regression |
| A rapid responsive test omitted an observable desktop checkpoint | Observe the intermediate state while retaining the focus assertions |
| The next CI run exposed actual first-transition focus loss | Retain navigation ownership across hidden-element blur, clear on real outside focus/pointer action, and add search-focus preservation |
| Restore validated URL and cleanup order needed tightening | Bind all connections to the validated disposable URL and emit PASS only after owned-database cleanup |
| Six varchar-IN CHECKs changed deparse text after restore while all row fingerprints matched | PostgreSQL-parser normalization with stable representation, original identity/flags and exact other definitions; add exact column signatures |

The actual exported CHECK helper was tested on owned PostgreSQL17.11. All six cases became equal/idempotent; changed literals/operators remained unequal; temporary tables disappeared after success and deliberate failure/rollback. [The compact receipt](evidence/check-parser-proof.json) records the source digest. The upstream [PostgreSQL discussion](https://www.postgresql.org/message-id/1fa24f41862f214b44bcf94556db51c9946d28bd.camel@cybertec.at) describes the same array/per-element coercion representation. No casts, values or constraints are stripped from comparison.

Failed runs remain visible and are superseded only by successful corrected-source runs.

## Evidence and final gate

Independent QA did not implement the changes. Source review, local execution, Actions execution and integration remain separate states.

| Checkpoint | Successful exact-source run | Relevant actual execution |
|---|---|---|
| Foundation | [43841589126](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43841589126) | All twelve jobs and actual full-suite/four-image selection |
| Learning | [43844028059](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43844028059) | 341 backend units, 251 DB/API, native74, pipeline33, Compose3, required browser engines |
| Enterprise | [43844033659](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43844033659) | 343 units, 247 DB/API, real export/Compose/browser flows |
| Vibe transport | [43844845506](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43844845506) | 356 units, 243 DB/API, 16 actual TLS checks, existing native/Compose |
| Capacity | [43844858225](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43844858225) | Native74, pipeline34 including the new campaign, Compose3, browser/image gates |

Each listed checkpoint had twelve successful jobs and independently verified checkout/source tree equality. Counts differ by feature tree and must not be added as unique tests. The corrected recovery Backend job in run43847721447 separately passed 386 units, 255 DB/API, 16 TLS and the complete recovery: 31 migrations, 37 table fingerprints, 262,157-byte archive and cleanup. That Backend result alone is not an all-job gate; the combined PR85 run and final PR receipt supply the complete gate.

Final acceptance requires corrected PR80 focus cases, complete PR85 recovery, the combined native/pipeline/Compose/browser/four-image gate and independent final QA, bound to the current integration head, checkout, complete tree and run. Old green commits, skipped jobs or local helper success cannot substitute.

Local Chromium was blocked before assertions; later local TypeScript attempts were killed under memory pressure. They are not passing checks. A native PostgreSQL installation later found outside PATH was used solely in an owned temporary parser experiment. The local execution environment then became unavailable; already-published source and connector-accessible Actions remained authoritative. Subsequent remote composition uses the reviewed blobs, with the CI list retaining both new browser suites.

## Measurements and costs

The initial shared-navigation build increased index JavaScript from 381.92 to 383.16 decimal kB, gzip 122.98 to 123.34 kB: **+0.36 kB gzip**. This predates the final focus fix and product composition; it is a payload cost, not a speedup.

The retained twenty-four-job campaign measured **0.76635 active jobs/s** and **0.22194 wall jobs/s** over 108.14 seconds, including 76.14 seconds of admission waits. Queue p50/p95/p99 was **536/2,199/2,266 ms**. All jobs completed once with no failure/recovery/retry. Third-wave throughput was **3.89% lower** than the first. Active Node-worker CPU totaled 450 ms; lifetime peak RSS was 111,336 and 111,196 KiB. [PERFORMANCE.md](PERFORMANCE.md) preserves provenance and adverse drift.

These low-sample shared-runner observations do not establish saturation, population tails, production capacity, compiler/executor RSS or long-session leak freedom. Per-wave p95/p99 are maxima. No controlled before/after speedup is claimed. Recovery timings are taken only from an actual successful artifact, not estimated from the parser probe.

## Operational handoff

The completed gate makes this work eligible for **manual code review**, not blanket production approval. [SECURITY.md](SECURITY.md) records the preserved Runtime findings/expiry.

Remaining separate work: approved host/kernel isolation; live gateway/image/firewall/egress and certificate operations; native Vibe through that deployed gateway; the full eight-language verdict/memory matrix; sustained saturation/multi-hour resources; full compiler/executor instrumentation; field Web Vitals/editor heap; comprehensive manual screen-reader testing; production-volume recovery/retention/RTO/RPO. Existing restart/recovery tests still execute, but no new exhaustive failure campaign is claimed.

No production DB/Redis/volume operation, deployment, paid resource/model call, dangerous shared-host escape experiment, scanner exception extension or final protected-branch merge is performed. The next user action is to review the open final stacked PR and decide the merge/release sequence.
