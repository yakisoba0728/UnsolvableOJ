# Phase III bounded browser performance protocol

## Scope and execution state

This probe extends the existing isolated Compose judge browser flow after its real
AC and WA submissions. It uses that flow's own account, one newly published public
problem and two ordinary submissions. It creates no additional account and does
not relax authentication, rate limits, browser assertions or the existing timeout.

The managed local environment cannot launch the browser or Docker. Local checks
covered Front E2E TypeScript, the existing CI-policy tests and Playwright discovery;
discovery does not launch a browser. Independent source review was followed by
actual execution in the disposable production-build Compose setup in Actions.

Run [43823181757](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43823181757)
completed its Sandbox/pipeline/Compose job133150846420 successfully, including all
three live browser flows in37.7s. **The workflow as a whole failed the separate
Runtime advisory gate.** This successful browser observation is not an accepted
whole-run CI receipt. Subsequent acceptance must use a fresh complete-head run.

The executed source was PR77 head`e23729640b0ce18b6bb5ab82c578dc1eb35c7392`, actual
checkout`9e4ce9df2aa4338a99a8deb7f32e161458a39a04`, tree
`0e90a39685e1246c8f9a3ab1637fc0c89b4d85e7`. The raw report carries those identifiers;
it is not relabelled with a later documentation or integration commit.

Run the existing command from the repository root:

```sh
node scripts/check-compose.mjs --production
```

The runner builds the production frontend, serves it through nginx and uses real
API, PostgreSQL, Redis and Judge services inside its disposable Compose project.
The probe runs inside `Front/tests-live/judge-flow.spec.ts` and is implemented in
`Front/tests-live/learning-performance.ts`; it never enters the shipped bundle.

## Observed finite sample

The report completed on2026-11-16 at07:35:15UTC with Chromium153.0.8010.12,
1280×720 viewport, Linux x64 and Node24.22.2. The configured desktop browser user
agent contains Windows; it does not change the recorded Linux runner platform.
All18 API observations (three initial plus15 period changes) returned200 with the
expected owned fixture values. There were no truncated performance streams or
missing frame samples.

| Observation | Visit1 | Visit2 | Visit3 |
| --- | ---: | ---: | ---: |
| Bounded initial LCP candidate | 384ms | 380ms | 388ms |
| First Contentful Paint | 96ms | 92ms | 88ms |
| Bounded observed CLS | 0.029427 | 0.029427 | 0.029427 |
| Document loadEventEnd | 23.1ms | 24.6ms | 22.6ms |
| Isolate used heap before five changes | 29,607,932B | 25,218,960B | 26,004,000B |
| Isolate used heap after five changes | 17,935,088B | 18,788,152B | 32,774,296B |

Across15 dependent period changes, click-to-verified-second-frame latency has
observed minimum42.7ms, median47.3ms and maximum52.6ms. These are sample summaries,
not population tails or INP. Final raw Event Timing counts are33/22/22; these
include multiple event types per interaction. INP remains explicitly null. Heap
falls on two visits and rises on one without forced GC; neither leak freedom nor
a memory regression follows from these short isolate samples. Document load end
precedes asynchronous application rendering and is not a whole-screen ready time.

The original artifact14206046513 ZIP has SHA256
`140148586cce0cd4ca2f129ff5e735bbd1b48559e457131ba5e68349a8f80bc7`, checked against
GitHub metadata. Its unmodified JSON SHA256 is
`94919ac0010e0339f349e679b61178ab91364f36e9ecc7c8537da5cf5bfbf681`.
Both are retained before the original seven-day expiry:
[raw JSON](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/measurements/phase3-browser-performance.json),
[original ZIP](measurements/phase3-browser-performance.zip),
[source/artifact provenance](measurements/phase3-browser-performance-provenance.json),
[selected Compose log lines](evidence/phase3-browser-compose-excerpt.log).
An author-separated [raw-result review](evidence/phase3-browser-performance-independent-review.json)
checked GitHub provenance, the immutable executed source, all18 responses,15
duration differences and six CLS snapshots. It found no blocking discrepancy in
this bounded evidence. Its192 source/data/arithmetic invariants are not additional
application test cases and do not make the failed whole workflow accepted.

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
