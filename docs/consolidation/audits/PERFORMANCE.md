# Independent Front review and controlled performance audit

## Decision and scope

Reviewer: `/root/performance_testing`. Worktree: `/workspace/scratch/c0f7c387c945/oj-performance`, branch `internal/consolidation-performance`.

**The original Front commits `6d7919c183704f0af73f14762a3a2486c5820023` and `7d15a11216f4170181d29f66eab9ddd30a348349` pass this independent source review and their 12-case actual-component DOM regression harness.** The review found no integration blocker in the changed ownership logic, including Settings' own synchronous identity update after an accepted mutation.

This reviewer separately reproduced and implemented the Vibe start defect authorized by the coordinator. Its isolated commit is **`5d5e94d123a8f9d8bc1da97ef1bc7eea0acbcd58`**. That new code requires the coordinator's independent review; this report does not approve its own implementation.

The final measured Front candidate includes all three corrections. It adds **474 uncompressed JavaScript bytes, 197 summed per-file gzip bytes, and 465 summed per-file Brotli bytes** versus the exact Phase V baseline. The HTML module entry is 23 bytes smaller uncompressed and 27 bytes smaller with gzip, but 136 bytes larger with Brotli. These are bundle measurements, with no runtime speedup claim.

All work was local to the isolated worktree and scratch evidence directories. No remote write, PR change, dependency change, workflow selector change, production request, paid resource, or browser security-mode change was made.

## Exact source binding

| Role | Commit | Tree |
|---|---|---|
| Published consolidation baseline | `c3367954cf55584d3007ebe33c1c13aa9d6eed70` | `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` |
| Original Front author HEAD | `7d15a11216f4170181d29f66eab9ddd30a348349` | `d3c7687499d35fa39412396cc6d358ca9efd945e` |
| Independently cherry-picked Front equivalent | `0395b618e80ca0d0097bd0f27f982ca56416a7c9` | `d3c7687499d35fa39412396cc6d358ca9efd945e` |
| Final Front candidate with Vibe correction | `5d5e94d123a8f9d8bc1da97ef1bc7eea0acbcd58` | `b853a53ae9db2a84388707bbd40022196ba2dc29` |

The final `Front` subtree is `df7596ff304e82efb122e7dbfa0c34f105bb9fcd`. Both source snapshots used for the final bundle comparison had empty working diffs. The original Front tree and the independent cherry-pick tree were compared and are identical. This permits integration using the author's original commits, followed by only the Vibe-specific commit above; the coordinator should not also pick this worktree's equivalent prerequisite copies.

Source receipts: `performance-evidence/review-source-binding.json` and `performance-evidence/bundle-source-final.json`. The coordinator's later combined repository HEAD is not the HEAD measured here. A matching Front subtree can bind the emitted code to the integrated Front content, while full repository acceptance still requires the final combined-source CI.

## Independent review of the original Front corrections

### Community writes

The changed App keys use account/login identity and path, rather than the rotating access token. The reused `useRequestOwner(getNavigationVersion, true)` still captures mounted state, navigation version, and login identity. An ordinary refresh therefore keeps the pending form and its completion together. A different account or a new login for the same account invalidates ownership. The duplicate post-page ownership hook was removed in favor of the existing common guard.

The reviewer inspected the actual App, authentication provider, API retry path, shared request-owner hook, composer, and post page. The shared guard's identity-only option does not disable navigation or mounted checks. No server authorization or request contract was changed.

### Settings identity update and mutation serialization

Settings now checks the current login identity and mount status before accepting an asynchronous completion. The shared `writing` ref serializes username, password, and device mutations; the disabled mutation controls also convey pending state in the UI. This prevents two accepted session replacements from racing each other.

The subtle success path was reviewed explicitly. `setSession(next)` synchronously updates the authentication provider's identity ref. Immediately afterward, the accepted Settings mutation sets `formIdentity.current` to that new identity, releases its write guard, and sets its completion status. The layout effect recognizes that this form already owns the accepted replacement and retains its success feedback. Unrelated new logins take the reset path, clearing the three password fields and mutation statuses before paint. Stale success, failure, or device completion cannot replace the new login's state. Routine automatic token refresh retains identity and does not clear an in-progress form.

The 12 independent DOM cases used the actual App/AuthProvider/router and source components, with controlled synthetic fetch responses. They did not copy simplified ownership functions into a test surrogate. This reviewer installed its own locked Front dependencies and an isolated jsdom dependency directory before running them.

| Original Front candidate case family | Result | Evidence |
|---|---|---|
| Post creation and answer: same-login refresh, different account, same-user new login | 6/6 passed | `performance-evidence/independent-community.json` |
| Username and password: same-login refresh, different account, same-user new login | 6/6 passed | `performance-evidence/independent-settings.json` |

The source receipt in these reports is clean HEAD `0395b618e80ca0d0097bd0f27f982ca56416a7c9`. The harness's `pending` observation is sampled before releasing the delayed response. For Settings replacement cases a disabled button can also mean an unchanged username or empty password; post-response acceptance is established by its explicit feedback/session assertions, rather than inferring a remaining request from that field.

## Reproduced Vibe start defect and narrow correction

The previously unverified `VibePage.start` candidate was reproduced against the original Front candidate. While the attempt-creation response was delayed, replacing the account, logging in again as the same user, logging out, or leaving the page all still allowed the old completion to navigate its blank popup to the old attempt. All four stale cases failed. Normal completion and same-login 401 refresh were successful controls.

This is a **P2 stale navigation/login UX defect**. The proof does not establish cross-account content disclosure: server-side attempt authorization remains authoritative.

The correction captures the existing login/navigation/mounted ownership guard before starting the request. A stale completion closes only the captured popup opened by that request. Successful and failed completions update navigation/error/pending state only while ownership remains current. The Vibe route key now also includes login identity and navigation entry, so a same-user new login receives fresh pending/error state. The normal popup path and the popup-blocked same-tab fallback retain their existing behavior. No new API, feature, retry policy, or dependency was introduced.

Portable proof source: `Front/scripts/consolidation-vibe-start-dom-probe.mjs` in the Vibe commit. The same final probe was run against a separate pre-Vibe worktree at clean `0395b61...` and final clean `5d5e94d...`.

| Vibe case | Before | After |
|---|---|---|
| Normal start | Passed | Passed |
| Same-login refresh | Passed | Passed |
| Different account during request | Failed: popup navigated | Passed: no navigation; request popup closed |
| Same-user new login during request | Failed: popup navigated | Passed: no navigation; request popup closed |
| Logout during request | Failed: popup navigated | Passed: no navigation; request popup closed |
| Navigation away during request | Failed: popup navigated | Passed: no navigation; request popup closed |

Matched raw reports: `performance-evidence/vibe-start-before-matched.json` and `performance-evidence/vibe-start-final.json`. The before run intentionally exits 1 with four failed assertions; its output is retained. The first reproduction and its original scratch probe are also retained as `vibe-start-before.json`, `vibe-start-before.log`, and `vibe-start-dom-probe.mjs` in the evidence directory. The final portable probe uses a controlled popup object under jsdom; it is not a native browser popup test.

Seven native browser regressions were appended to the already selected `Front/tests/session-refresh.spec.ts`: four stale successes, one stale failure, and refresh with a popup available or blocked. The stale-success tests also open an unrelated tab and assert that it remains open. Chromium, Firefox and WebKit already select that spec, so no selector changes are necessary. Discovery now reports **75 test entries: 25 per engine**, of which seven per engine are the new Vibe cases. Discovery is not execution.

## Final verification performed locally

| Check | Result | Raw evidence |
|---|---|---|
| Final community actual-component DOM | 6/6 passed, clean `5d5e94d...` | `performance-evidence/final-community.json` and `.log` |
| Final Settings actual-component DOM | 6/6 passed, clean `5d5e94d...` | `performance-evidence/final-settings.json` and `.log` |
| Final Vibe actual-component DOM | 6/6 passed, clean `5d5e94d...` | `performance-evidence/vibe-start-final.json` and `.log` |
| `npm run check --prefix Front` | Exit 0 | `performance-evidence/final-front-check.log` |
| Production TypeScript and Vite build | Passed within Front check | Same log |
| Answer leakage guard | All 10 protected answers absent from bundle | Same log |
| Telemetry privacy regressions | 7/7 passed | Same log |
| E2E TypeScript | Passed | Same log and `vibe-test-types.log` |
| Three-engine session-refresh discovery | Exit 0, 75 entries | `performance-evidence/session-refresh-discovery.log` |
| `git diff --check` | Exit 0 before commit | Command output; final worktree clean |

The final DOM source receipt is 18/18 across these three families. This complements the separate 12-case independent review run; it is not an additional native browser pass count.

Native browser passes recorded by this worker: **0**. The Front author's local Chromium startup was blocked by the environment's socket policy before app assertions; this worker did not bypass that restriction or lower browser security. Physical-device, screen-reader, paint/layout, full backend, and long-session editor validation are not covered by jsdom. The coordinator's new full DB/native/browser CI remains necessary for the integrated final source. Older successful runs do not substitute for it.

## Controlled bundle measurement

Baseline and final candidate used Node `v24.22.1`, the same installed `Front/node_modules` directory, byte-identical `Front/package-lock.json` and `vite.config.ts`, and no `VITE_*` environment variables. The baseline and candidate Vite builds were run sequentially. Output directories belonged to this worker's isolated worktrees; no root or other worker build output was changed.

Lockfile SHA-256: `728910bbbdfbc955cede2da1d604f9508e475cde4ce3222f5502d70ee238a644`.

Vite configuration SHA-256: `f97642699ba719d5f7ca9fea383d4ad4222768435b8506702d098fbea3c37c5e`.

The committed `Front/scripts/measure-bundles.mjs` reads emitted files and records each file's SHA-256 and exact byte count. It uses gzip level 9 and Brotli quality 11. The entry row measures only the HTML module entry. The total sums every emitted JavaScript file, including lazy chunks and `theme-init.js`; it is not a measurement of one page load. Compression settings may differ from a serving CDN and from Vite's console size estimate.

| Metric, bytes | Phase V baseline | Final Front candidate | Delta | Change |
|---|---:|---:|---:|---:|
| HTML module entry, uncompressed | 383,981 | 383,958 | −23 | −0.00599% |
| HTML module entry, gzip level 9 | 123,403 | 123,376 | −27 | −0.02188% |
| HTML module entry, Brotli quality 11 | 106,467 | 106,603 | +136 | +0.12774% |
| All emitted JS, uncompressed | 1,494,009 | 1,494,483 | +474 | +0.03173% |
| All emitted JS, summed per-file gzip | 492,887 | 493,084 | +197 | +0.03997% |
| All emitted JS, summed per-file Brotli | 419,149 | 419,614 | +465 | +0.11094% |

The adverse total-size and Brotli results are retained. The existing greater-than-500-kB `ProblemMarkdown` chunk warning remains visible in both build outputs. This work is correctness maintenance, not a performance optimization claim. Build durations occurred on a shared host with concurrent tasks and are not used to infer improvement. No LCP, CLS, INP, parse, rendering, heap, network, CPU, capacity, or end-to-end speed result is inferred from bundle size.

Final raw file measurements: `performance-evidence/bundle-comparison-final.json`. Compact arithmetic and source receipt: `performance-evidence/bundle-summary-final.json`. Build logs: `baseline-build.log` and `final-front-check.log`. The earlier community/Settings-only comparison is preserved separately as `bundle-comparison.json` with `bundle-source.json` and `candidate-build.log`; it is not mislabeled as the final Vibe-inclusive candidate.

## Retained historical evidence after cleanup

The following scripts were run read-only against the coordinator's `UnsolvableOJ` worktree after its evidence cleanup:

```sh
python3 scripts/check_consolidation_evidence.py --verify-git
python3 docs/overhaul/phase5/evidence/performance/verify-performance.py
```

Both exited 0. The final archive receipt verified **51 archived files and 13,205,154 original bytes** against immutable Git originals; it also found 415 valid local Markdown targets at this inspection. The target count can increase as the coordinator writes further documentation. The original historical raw evidence remains recoverable from immutable Phase V commit `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`.

The performance verifier passed **10,875 checks**, with zero network calls, Git calls, or benchmarks executed. It retained the foundation, database, judge, Phase II scaling, recovery, browser and bundle source sections, and recomputed their arithmetic. It retained the failed candidate observations and corrected/composed historical candidate receipts. Its measured-byte binding covers the specifically listed DateTimePicker, LearningGoalPanel, and lockfile inputs; it is not a claim that every current application source file was historically measured.

Receipts: `performance-evidence/archive-check-final.json` and `performance-evidence/historical-performance-final.json`. Earlier independent receipts are retained as `archive-check.json` and `historical-performance.json`. These establish retained integrity and arithmetic, not replay of the old experiments or current CI acceptance.

## Reproduction and handoff

All evidence paths in this report are relative to `/workspace/scratch/c0f7c387c945/`. The isolated jsdom dependency lock and package description are copied to `performance-evidence/jsdom-package-lock.json` and `jsdom-package.json`; repository dependencies remain unchanged.

```sh
# Run from oj-performance. The supplied probe directory contains jsdom 31.0.1.
node Front/scripts/consolidation-session-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-performance /workspace/scratch/c0f7c387c945/performance-probe final-community.json community
node Front/scripts/consolidation-session-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-performance /workspace/scratch/c0f7c387c945/performance-probe final-settings.json settings
node Front/scripts/consolidation-vibe-start-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-performance /workspace/scratch/c0f7c387c945/performance-probe vibe-start-final.json
node Front/scripts/consolidation-vibe-start-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-performance-pre-vibe /workspace/scratch/c0f7c387c945/performance-probe vibe-start-before-matched.json
npm run check --prefix Front
node Front/scripts/measure-bundles.mjs /workspace/scratch/c0f7c387c945/oj-performance-baseline/Front/dist /workspace/scratch/c0f7c387c945/oj-performance/Front/dist
```

The baseline directory is detached at `c3367954...`; the pre-Vibe directory is detached at `0395b61...`; each uses the same installed dependency directory. The pre-Vibe probe's four failures are expected and must remain visible.

Coordinator actions remaining: independently review the Vibe-only commit, integrate approved changes, bind the measured Front subtree to the integration content, and run the unchanged final-source CI including native Chromium/Firefox/WebKit and the actual DB/native acceptance work. This worker's independent approval applies only to the original Front commits stated at the start of the report.
