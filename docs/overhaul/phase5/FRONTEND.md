# Phase V frontend implementation and evidence

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
