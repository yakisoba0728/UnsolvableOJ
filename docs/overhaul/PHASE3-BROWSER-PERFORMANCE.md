# Phase III bounded browser performance protocol

## Scope and execution state

This probe extends the existing isolated Compose judge browser flow after its real
AC and WA submissions. It uses that flow's own account, one newly published public
problem and two ordinary submissions. It creates no additional account and does
not relax authentication, rate limits, browser assertions or the existing timeout.

At implementation time, the managed local environment cannot launch the browser
or Docker. The probe has **not** been executed there. Type checking and independent
source review are distinct from the later production Compose run in Actions.
This document defines the experiment; actual measurements must come from an
artifact whose checkout SHA/tree identifies the executed code.

Local checks completed: Front E2E TypeScript check, all 17 existing CI-policy tests,
and Playwright test discovery (the existing three live tests). Discovery does not
launch a browser. Independent review and real production Compose execution remain
pending at this checkpoint; no measured numbers are asserted here.

Run the existing command from the repository root:

```sh
node scripts/check-compose.mjs --production
```

The runner builds the production frontend, serves it through nginx and uses real
API, PostgreSQL, Redis and Judge services inside its disposable Compose project.
The probe runs inside `Front/tests-live/judge-flow.spec.ts` and is implemented in
`Front/tests-live/learning-performance.ts`; it never enters the shipped bundle.

## Fixed finite workload

- Reuse the authenticated context after its earlier learning visits: **warm cache**.
- Three full document navigations to `/learning?days=30`.
- After each navigation, verify the real API and all four displayed summary values,
  then observe for 500 ms before the first scripted input.
- Five sequential period changes per document: 7, 90, 30, 7, 90 days; **15 total**.
- Each change must return HTTP 200 with two submissions, one accepted submission,
  one solved/attempted problem, the requested activity length and no review entry
  for the already solved problem. Its selected period and UI must agree.
- Wait 100 ms after the five changes to collect delayed observer delivery.
- Allow at most 250 ms for post-assertion animation-frame collection. A missing
  frame sample becomes null with a reason, without relaxing API/UI assertions.
- Preserve at most 1,000 entries per performance entry type per document and mark
  truncation explicitly. There is no added latency pass threshold or retry policy.

## Metrics and interpretation

| Output | Meaning and limits |
| --- | --- |
| LCP candidate | Latest browser LCP candidate at the initial bounded snapshot, before scripted input. Later paints are outside this measurement. This is not a field or full-lifetime result. |
| Observed CLS | Largest session sum of shifts without recent input, using a gap under 1 second and a session under 5 seconds, within the observed top-level document. Initial and final snapshots preserve the raw entries; a truncated stream returns null rather than a complete score. |
| Navigation Timing / FCP | Browser-provided document timing and transfer fields relative to `timeOrigin`; absent entries are null with reasons. These are not API server processing times. Period changes do not restart document Navigation Timing. |
| Period latency | Browser click event timestamp to the second animation frame after the new-period DOM contains the expected fixture values. This includes API and render work, and provides a render opportunity; it is not an actual paint timestamp or INP. |
| Event Timing | Raw browser entries requested with a 16 ms duration threshold. Durations have 8 ms granularity; fast interactions may be absent. Missing entries do not mean zero latency. `inp` remains null with an explicit reason. |
| JS heap | Chromium CDP `Runtime.getHeapUsage` before and after five changes, without forced GC. The inspected isolate's allocated/used bytes are not process RSS, a leak diagnosis or long-duration memory stability. Optional CDP fields are retained only when exposed. |

There is no CPU/network throttling. Three page visits and 15 dependent changes on
one CI browser, one viewport and a tiny history cannot establish population
p95/p99, all-device/field performance, large-history performance, or a before/after
improvement. Observer and DOM-check overhead is included. Unsupported APIs retain
null values and reasons rather than invented values.

Metric definitions were checked against primary sources on 2026-11-16:

- [W3C Largest Contentful Paint draft](https://www.w3.org/TR/largest-contentful-paint/): candidates, input termination and document-load scope.
- [Google Web Vitals CLS definition](https://web.dev/articles/cls): largest session window, recent-input exclusion and page-lifetime distinction.
- [W3C Event Timing draft](https://w3c.github.io/event-timing/): threshold, duration granularity and `interactionId`.
- [Chrome DevTools Protocol Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage): isolate heap sampling.

## Evidence retention and privacy

The helper writes `Front/reports/phase3-browser-performance.json`, attaches it to
the Playwright report and prints a concise numeric console summary. The workflow
uploads it on successful or failed Compose execution with seven-day retention.
Successful Compose without its expected JSON fails artifact collection; setup
failure before probe entry only warns about a missing report and remains a failed
test. A probe interrupted after entry attempts to persist its partial samples with
`status: incomplete`. Existing failed-browser traces and screenshots are retained
by their unchanged artifact step.

The JSON contains SHA/tree/run identifiers, browser/protocol metadata, numeric
fixture summaries and selected timing fields. It omits tokens, cookies, headers,
source code, problem titles, DOM nodes and full API bodies. All inspected learning
records belong to the account created by the same disposable test. No production
or preexisting user history is queried.
