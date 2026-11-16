# Phase V frontend implementation and evidence

## Actual accepted-candidate CI observations

The corrected source `49a3674e76f79b0d1626b12f02862825c189bdff` was executed on current base `6d8556c07fd370ee97d7c55798286f5b2885cf4c`. Actions checkout `8d59c05bcc2161e3088355daf63756ed655ac234` has those two parents and the same tree `c90c955a3f4c8cd1e28f26a77a5845b9bf874cd1` as the source. Full run [43901468081](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43901468081), attempt1, completed all12 jobs successfully. Independent acceptance and the subsequent integration merge are recorded in PR89 and the final validation ledger.

Actual ordinary Playwright results were403+87 on shard1 and402+87 on shard2: **979 entries =894 real-browser cases +85 browser-free units**. The four actual Compose browser cases are separate. All **42 new UX cases** passed:14 each in Chromium, WebKit and Firefox. One additional Chromium editor observation passed. These are case counts under the selected project configuration, not a claim that every route/state is covered in all engines.

The source-bound UX artifacts contain **24 geometry JSON records and48 PNGs** for320/375/768/1440px × light/dark × three engines. All tracked-tree checks are clean; fonts are loaded at both compared samples. Recomputed toolbar and summary shifts are zero in every case, and no case exceeds the one-CSS-pixel horizontal-overflow allowance. Representative mobile/light and desktop/dark screenshots were independently inspected. WebKit uses its configured device scale2; other selected engines use1, so screenshot pixels are not silently equated to CSS coordinates.

The editor run lasted40,019.391ms for its observation protocol and40,104.838ms overall, recording13 heap samples,20 successful actions and10 successful autosaves with zero unexpected requests/page errors. Field INP stays null. All13 optional `performance.memory` samples report the same coarse19,300,000 used bytes,26,000,000 total bytes and3,760,000,000 limit. That resolution does not establish zero allocation or absence of a leak. The EventTiming buffer retained its maximum200 entries and discarded176 more; it is explicitly truncated and cannot represent all interactions. Action wall times include automation, assertions and autosave debounce, and are not processing/paint latency. See [PERFORMANCE.md](PERFORMANCE.md) and the original artifacts for all raw values and limits.

The new live Compose attribution probe observes three warm navigations with LCP candidates[368,368,368]ms and CLS[0.048731330235799154,0.048731330235799154,0.048731330235799154]. Fifteen dependent period switches have a46.9ms median and52.1ms maximum, retaining the adverse maximum. Each navigation exposes a footer-associated shift and a later24px movement of goal-descendant and toolbar boxes. These are impacted elements. Fonts are loaded at the two snapshots per navigation, but their status is not sampled at shift time; no initiating cause is established. This initial-loading observation is distinct from the controlled same-owner goal-refresh stability test above.

### Failed attempts retained

Run43897227270 at source771ca0f12d79653e2ef160501676fe3d1854e23e was rejected before any job executed because the coordinator used `success()` in a workflow with-input. The correction uses step outcomes in that context, with an eighteenth independently passing policy regression.

Run43898203434 at source500329305615070e4e9edbde0ca9215539ed1cc4 completed9 successful jobs and3 failed jobs (both browser shards and required). Shard1 had8 failures/395 passes; shard2 had9 failures/393 passes. The17 new failures arose at exact Git provenance reads under the container's different HOME; affected remaining geometry assertions and editor observation did not complete. Firefox was not executed after the failed shard steps. The source correctionf872de5a344dfa1055fdd5864cf7ff92936fff61 limits readonly Git trust to the real module-derived checkout per subprocess. Independent8-case reproduction preserves ordinary/wrong-path rejection, immutable SHA/tree, dirty-state accuracy and unchanged global configuration. The corrected fresh run above supplies actual browser acceptance. No pixel tolerance, font wait, assertion, existing timeout or browser selection was relaxed.

## Original implementation and local checkpoint

## Fixed scope

Baseline source: `d0159b1f844bf0608415dded9e84af566c8e2041`, complete tree
`f12f6c377ea07f0cb4b498ca0fe5889ed4401a66`. Existing Phase IV navigation,
bookmarks, goals, enterprise exports and private ownership logic are preserved.
The [route inventory](FRONTEND-ROUTES.md) records 30 modules, 36 top-level route
declarations and four admin children with explicit coverage limits.

Two user-visible defects were reproduced with the actual React components in
jsdom before the source changes. This is DOM execution, not browser execution:

| Defect | Baseline observation | Implemented behavior |
|---|---|---|
| Date/time popover removes focused controls on internal completion | Hour Enter, minute Enter, Done and Clear closed the popover and left `document.activeElement` on BODY. Escape and outside-focus controls passed. | All four internal completion paths and Escape return focus to the opening field. Outside pointer/focus dismissal leaves the chosen outside target alone. No form/API contract changed. |
| Learning-goal refresh removes confirmed content while waiting | Visible `900 / 1,000문제` became absent during the delayed GET; writes remained disabled. | The same account's last confirmed goal stays visible while refreshing. A visible refresh label and status announcement indicate pending work, and all writes remain disabled. A new account/login still receives a freshly keyed panel with no prior resource. |

No CSS spacing or fixed-height guess was introduced. The goal fix addresses the
reproduced refresh collapse. It does **not** establish the cause of Phase IV's
initial CLS observations or remove all initial-loading shifts.

## Exact local execution

- `npm ci --no-audit --no-fund` for Front: successful; 214 packages. No dependency
  or lockfile change.
- `Front/scripts/phase5-ux-dom-probe.mjs`: baseline **5 failed / 2 passed**;
  candidate **7 passed / 0 failed**. Raw observations:
  [baseline](evidence/frontend/dom-baseline.json),
  [candidate](evidence/frontend/dom-candidate.json).
- `npm run check --prefix Front`: passed the production TypeScript/Vite build,
  answer-leakage check, seven telemetry privacy tests and E2E TypeScript.
- `git diff --check`: passed.

The DOM probe bundles the repository components with the same Front dependency
installation and uses separately installed `jsdom@31.0.1` in an owned temporary
directory. It records source HEAD and the exact candidate component diff. The
first baseline run wrote its complete observations before waiting on incidental
Node handles and was stopped; the finite harness now exits only after all seven
cases finish, every component unmounts and each window closes. No assertion was
removed. DOM focus/content results do not establish browser default keyboard
behavior, layout, paint, screenshots or assistive-technology support.

Local browser checks remain **NOT_EXECUTED** at assertion level. The pinned
Chromium download returned an invalid archive. Existing system Chromium
156.0.8078.79 was then tried with an isolated local Playwright config; all three
selected cases failed at process startup with `socket() failed: Operation not
permitted`. [Original startup log](evidence/frontend/local-browser-startup.log)
is retained. No browser or sandbox restriction was bypassed, and these failures
are not counted as reproduced application defects. The temporary config is not
part of the patch. Actual browser acceptance comes from the subsequent exact
source CI receipt.

## Browser regression and evidence protocol

`Front/tests/phase5-ux.spec.ts` adds **14 cases per selected browser project**:
five internal date-picker close paths, one outside-focus control, and eight
goal refresh combinations (320/375/768/1440 px × light/dark, reduced motion).
The test asserts the actual applied theme, retained confirmed content,
write-disabled state, page width and stable downstream toolbar/summary geometry
within one CSS pixel. API responses are synthetic fixtures with a controlled
pending read; these are UX correctness tests, not server benchmarks.

Each geometry case writes ready/refreshing PNGs and a JSON record under
`Front/reports/phase5-ux/`, with project/viewport/theme in its filename, checkout
SHA/tree, browser version, raw boxes and signed pixel deltas. Each case belongs
to one shard; filenames distinguish engines and cases. The coordinator must
include `phase5-ux.spec.ts` in explicit Firefox selection and upload this
directory even on success. It is included in the WebKit selection here.

Existing learning-goals account-switch/token-rotation/lost-response tests remain
required: preserving a confirmed read is never permission to replay a write or
reuse another account's data. Full browser tests also continue to exercise the
unchanged shared shell, dialogs and enterprise forms.

## Performance attribution, preserved adverse results and limitations

The existing live Compose learning probe now adds **schema 2** /
`phase5-layout-attribution-v1` metadata. It preserves the three warm navigations,
15 dependent period transitions, entry caps, bounded observation windows,
functional assertions and definitions of LCP candidate, observed CLS and
click-to-verified-frame latency. This is additive instrumentation, not an
unchanged probe binary.

For each layout shift it copies at most five browser-exposed source rectangles,
their element tag and a label selected from eight fixed source-owned regions.
It never stores DOM nodes, text, arbitrary classes/IDs, URLs, account fields or
input. Snapshots also include fixed-region numerical geometry, viewport/document
dimensions and font-loading status. A shifted node identifies affected content;
it does not alone prove which asynchronous/font/layout change initiated a shift.

The report path remains `Front/reports/phase3-browser-performance.json` to retain
the existing artifact contract. New schema/version identify the added fields.
Actual source and workflow bindings remain in each report. No latency pass
threshold, unsupported-metric substitution or observer-cap relaxation was added.

The previously accepted Phase IV observations remain adverse but inconclusive:
initial LCP candidate medians 364 → 384 ms, observed CLS medians
0.029427 → 0.048731, maximum final CLS 0.054325, and click-to-second-verified-frame
medians 46.6 → 45.9 ms. Those separate CI runs differ in content and are tiny
samples, so this patch does not describe them as a proven causal regression.
The new attribution supports a later source-bound interpretation of actual
Phase V CI; this document does not anticipate those numbers.

INP remains explicitly null with a reason. No field Web Vitals, population tail,
long-editor heap/leak improvement, full three-engine site audit, full mobile
hardware validation or WCAG certification is claimed. The finite local bundle
comparison uses one production build of each source, the same installed
dependencies/lockfile and default monitoring configuration. Each emitted JS file
was independently gzip-compressed at level 9 with mtime 0; this differs from
Vite's rounded gzip display and must not be mixed with earlier rounded reports.

| Byte count | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Initial module JS | 383,981 | 383,981 | 0 |
| Initial module JS gzip-9 | 123,080 | 123,079 | −1 |
| All emitted JS (54 files) | 1,493,955 | 1,494,009 | +54 |
| Sum of independently gzip-9 compressed JS | 489,252 | 489,331 | +79 |

[Raw bundle comparison](evidence/frontend/bundle-comparison.json) binds the
lockfile, candidate component bytes and built entry files by SHA256. Entry import
hashes changed; a one-byte gzip difference is not a meaningful performance gain.
The total payload cost is retained. Payload bytes are not browser latency.

## Bounded editor observation follow-up

`Front/tests/phase5-editor-observation.spec.ts` adds one **Chromium-only**
laboratory observation. Local TypeScript and list-only discovery are required
before handoff; actual execution remains **NOT_EXECUTED locally** and belongs
to the coordinator's immutable CI receipt. The normal Front configuration
selects it only in Chromium: Firefox explicitly ignores that filename, and
the other projects retain their existing positive filename lists. No skipped
test is introduced. Only this new spec declares the authorized 90-second
ceiling; existing test and action timeouts remain unchanged.

The actual Vibe editor uses deterministic browser-routed mock persistence and
the existing synthetic authentication helper. Two fixed 81-line TypeScript
fixtures (80 declarations and a comment) receive ten eight-character keyboard edits and ten alternating file
tab clicks. Each edit must retain focus and its exact value, autosave through
the normal one-second debounce, and agree with the mock's saved revision and
files. Each tab switch must preserve its file content, focus the selected tab,
and allow explicit return to the editor. Unexpected Vibe requests and page
errors fail the observation. No native executor, real backend or provider is
part of this measurement.

The schedule has a five-second initial idle, ten three-second slots and a
five-second final idle: approximately 40 seconds, with a **45-second bounded
action/autosave/sampling budget**. Observer disposal and report writing use
the remaining test deadline; protocol time, cleanup time and total observer
time are reported separately. It records thirteen heap snapshots when
`performance.memory` is available. Unsupported/invalid heap data is null with
a reason. These optional, potentially coarse/shared JS-heap estimates include
the page and instrumentation; they are not isolated editor allocations,
renderer RSS or whole-platform memory. All raw increases, decreases and equal
values remain in order; no GC is forced and no heap-size threshold is imposed.

An EventTiming observer retains at most 200 entries at the requested 16 ms
threshold, with fixed editor/file-tab region labels and numerical timing.
Unsupported EventTiming is null; a supported empty sample explicitly does not
mean zero latency. Truncation and discarded-entry counts remain visible. No
text, keys, source values, arbitrary target selectors, session data or tokens
enter the JSON. Tracing and screenshots are off for this observation. A
short-lived observer is disconnected before writing the final receipt.

The artifact is `Front/reports/phase5-editor-observation.json`. It binds PR
source/base, checkout/tree, workflow run/attempt, tracked-tree cleanliness,
browser/version, protocol, actual duration, raw heap/event/action samples and
limitations. Field INP is explicitly null. One finite trial cannot establish
a leak, absence of leaks, long-term capacity, speedup or population tail.
No historical comparison is fabricated.

```sh
npm run test:e2e:types --prefix Front
# From Front, discovery only (no browser execution):
node node_modules/@playwright/test/cli.js test phase5-editor-observation.spec.ts --list
# Actual replay, when the normal Playwright browser is available:
node node_modules/@playwright/test/cli.js test phase5-editor-observation.spec.ts --project=chromium
```

The coordinator must retain this artifact on success and failure from its
owning frontend shard. The successful shard must supply the one observation;
the other shard is not expected to produce a duplicate. Actual CI results,
including adverse heap deltas and slow/capped/empty interactions, must be
reported without recasting this short observation as a long-term test.

## Handoff status

Implementation and the stated local DOM/static checks are complete. Independent
patch review, required browser/Compose CI, artifact interpretation and integration
are coordinator gates. This implementation checkpoint does not pre-approve them.
The final PR/Issue receipt supplies the immutable final HEAD, source/tree match,
CI run, actual passes/failures and any remaining blockers.
