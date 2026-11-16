# Bounded enterprise result management

Baseline: `1011e35e1fbad2327794e5a615bba9bc3115ece0` (security dependency update
and reviewed enterprise version binding). This work changes result listing only;
the assessment selection/start policy and individual attempt/review endpoints
retain their contracts.

## User problem and API policy

The owner result endpoint previously returned every candidate, their submission
details and Vibe task results in one response. The page rendered every row and
repeated this request every 30 seconds during an active assessment. This was an
explicit Phase I backlog item and scales response allocation with candidate count.

`GET /enterprise/tests/:id/results` now accepts integer `page` (default 1,
range 1–1,000,000) and `limit` (default 50, range 1–100). Invalid/oversized values
return 400. Candidates keep ascending start-time order, with ascending attempt ID
as a deterministic tie-breaker. `pagination` returns `page`, `limit`, `total` and
`totalPages`; empty assessments have zero pages, and an explicitly requested
out-of-range page is empty without changing its requested page number.

The existing `summary` remains **whole-assessment** data. Missing Vibe work is
zero, started but unevaluated work is pending, and pending candidates are excluded
from the average. Scores are rounded per candidate before averaging, preserving
the prior regular/Vibe weighting. Owner/admin authorization and existing links
to candidate submissions or Vibe review pages are unchanged.

This is an intentional response-contract change: clients that previously treated
the unparameterized response as a complete export must walk the returned pages.
The integrated frontend and backend are updated together. This does not introduce
an unbounded export endpoint.

## Query and UI implementation

- One read-only REPEATABLE READ transaction supplies authorization, global
  summary, selected candidate details and Vibe scores from the same snapshot.
- SQL returns scalar global statistics; only the selected candidate page loads
  per-problem JSON and Vibe report details into Node. The page is limited before
  its lateral submission aggregation. Existing indexes are retained: no new
  unmeasured write/index cost is introduced.
- Offset pagination and the global summary still perform work proportional to
  candidate count. This is a bounded response/assembly improvement, not a claim
  of constant database cost or unlimited assessment size.
- The result screen announces page/total/range, keeps global summary labels,
  and offers previous/next navigation. Navigation moves focus to the result
  heading while loading. It does not show old rows under the next page label.
  Failed pages expose retry and first-page recovery; route/login identity changes
  reset pagination. Existing active-test polling refreshes the selected page.

## Local validation

- Backend lint/type/build and the existing 296 unit tests passed.
- Real PostgreSQL/Redis focused API run: **14/14** (five new result tests plus
  nine existing enterprise/Vibe tests). The new fixture has 123 candidates with
  tied timestamps, ordinary/Vibe complete/missing/pending scores, page traversal,
  default/max bounds, authorization, empty/out-of-range pages, and actual
  concurrent arrival between summary and detail reads.
- Complete API run after incorporating the coordinator's existing test-fixture
  corrections: **196/196 in 32 files**, 76.11 seconds. The first full run was
  194/196: an older account fixture counted withdrawn users and an older migration
  fixture included other suites' deliberately invalid references. The already
  reviewed `a52f8db` test-only change scopes the migration setup to a rollback
  transaction and adds a high-XP withdrawn-user exclusion assertion; it does not
  remove tests or change application behavior.
- Frontend build, answer-bundle/telemetry checks and all E2E types passed.
- `repro/enterprise-results-dom.mjs` executes the actual React component in
  jsdom: 50/50/3 rows, heading focus/busy state, no stale relabelled rows,
  error/retry recovery and route page reset passed. This is not native browser
  or layout evidence. Run it with a disposable directory containing jsdom:
  `node docs/overhaul/repro/enterprise-results-dom.mjs WORKTREE PROBE_DIRECTORY`.
- Three new browser scenarios (keyboard/loading, error/retry and mobile) are
  selected for Chromium, Firefox and WebKit. Local native browsers are blocked
  by this execution environment; the exact PR HEAD must pass remote browser CI.
- Independent review caught the new WebKit spec missing from the explicit
  Firefox workflow list. Both lists now match and CI policy **10/10** passes.
  Review also requested an explicit PostgreSQL URI protocol guard. Four new
  no-database tests reject foreign protocols and query overrides in both parent
  and API-child modes before connecting; these run in the Backend CI job.

## Reproducible HTTP measurements

`Back/scripts/benchmark-enterprise-results.mjs` creates/drops only a uniquely named
database on an explicitly opted-in loopback PostgreSQL service, requires fresh
empty loopback Redis, disables email/AI, and starts its own API child. It refuses
uncommitted application source. Copy the identical harness into the baseline
checkout and build both revisions before comparing.

Each execution uses either 1,000 or 5,000 deterministic synthetic candidates,
two ordinary problems, one Vibe challenge, two submissions per candidate, and
four Vibe records per five candidates. It executes five warmup GETs, three
20-request samples at concurrency four, then one query-capture GET: **66 result
requests**, within the real 100/minute endpoint budget. It never clears throttle
counters, rotates identities, or alters admission policy.

The synthetic Vibe states contain small score/status report objects. They do not
model production-sized workspace files, revision histories or long AI feedback.

The timer includes HTTP response body decoding and JSON parse. Responses' byte
sizes, individual latencies, statuses/errors, API child CPU ticks/current/peak
RSS and exact query plans are retained. Client, PostgreSQL and Redis CPU are not
reported as API CPU. The script reports actual commit/source-tree/harness hashes,
runtime/OS/CPU/PostgreSQL settings, global score summaries and a normalized first
50-row digest for semantic comparison. Twenty samples make p99 the sample
maximum; the shared-host result is not a steady-state tail or production capacity
estimate. First-page behavior is measured; deep-offset behavior remains separate.

## Observed before/after results

Measured application source: baseline `1011e35e1fbad2327794e5a615bba9bc3115ece0`,
candidate `1b2b1e73cad864c4b12021e42b9b05dbfd70ef1b`. Both used identical harness
`1740fcf336cf0a0e59ee908842d576545dd4cbe994f72fe792aeec83fed36eae`.
The subsequent protocol-guard and negative-test correction changes the harness
hash but not the positive workload. Raw measurements retain the exact executed
version; the measured application source tree remains unchanged.
Execution order was before/after at 1,000, then after/before at 5,000, each with
fresh owned services. Node 24.22.1, PostgreSQL 17.11, Redis 8.10.3, Linux 6.18.57,
AMD EPYC 9V74 host exposing 9 logical CPUs; PostgreSQL shared_buffers 64 MiB,
work_mem 4 MiB, max_connections 100. This was a shared environment without
dedicated CPU affinity or production networking.

HTTP table entries are **median [minimum–maximum] across three samples**. The
raw summary JSON additionally preserves the mean; no values combine different
candidate-count conditions. RPS measures short admitted bursts within the real
100/minute quota, not sustained ingress above that quota. p99 is the maximum
of each 20-request sample. Every measured request returned HTTP 200.

### 1,000 candidates

| Metric | Before | After | Median change |
|---|---:|---:|---:|
| HTTP p50 (ms) | 108.34 [86.70–110.78] | 23.86 [22.98–25.29] | -78.0% |
| HTTP p95 (ms) | 167.82 [135.69–184.83] | 33.80 [32.97–86.55] | -79.9% |
| HTTP p99 (ms) | 188.67 [140.27–216.61] | 39.85 [35.22–86.72] | -78.9% |
| Admitted-burst requests/s | 34.24 [30.34–40.69] | 157.71 [108.46–159.40] | +360.6% |
| API CPU ms / 20 requests | 590.00 [550.00–700.00] | 120.00 [120.00–190.00] | -79.7% |
| Response bytes | 746,019 | 38,065 | -94.9% |
| Maximum API process peak RSS (MiB) | 342.79 | 199.46 | -41.8% |
| Errors / measured requests | 0 / 60 | 0 / 60 | unchanged |

### 5,000 candidates

| Metric | Before | After | Median change |
|---|---:|---:|---:|
| HTTP p50 (ms) | 404.06 [394.88–406.55] | 40.12 [39.51–42.58] | -90.1% |
| HTTP p95 (ms) | 521.46 [477.76–671.19] | 60.77 [46.83–62.93] | -88.3% |
| HTTP p99 (ms) | 647.58 [583.59–798.47] | 65.54 [48.18–65.66] | -89.9% |
| Admitted-burst requests/s | 9.29 [8.44–9.40] | 86.11 [77.13–97.14] | +827.3% |
| API CPU ms / 20 requests | 2250.00 [2180.00–2580.00] | 160.00 [100.00–160.00] | -92.9% |
| Response bytes | 3,731,355 | 38,068 | -99.0% |
| Maximum API process peak RSS (MiB) | 462.00 | 176.82 | -61.7% |
| Errors / measured requests | 0 / 60 | 0 / 60 | unchanged |

The lower CPU figure is work for the same 20 completed responses, not a promise
of lower utilization at unlimited offered load. Peak RSS is the child process
lifetime high-water mark, including startup/registration/warmup; it is not an
incremental allocation or leak measurement. The 1,000-candidate after p95 sample
varied from 32.97 to 86.55 ms, so the median alone would hide meaningful variation.

Global summary objects and the normalized first 50 candidate-detail digests
were identical before/after in both conditions. The new API sends 50 rows,
while the old API sends 1,000/5,000; this is the intended pagination contract
change, and most gains concern bounded database detail assembly, Node allocation,
serialization, transfer and client JSON parsing. It does not claim that fetching
all 5,000 rows by walking 100 pages is faster.

### Actual query evidence

One captured authenticated request issued 5 statements before (2 auth + 3 result
reads) and 9 after (2 auth + 4 result reads + BEGIN/isolation/COMMIT). The extra
transaction statements preserve a common snapshot. This is a response/work
reduction, not a claim of fewer round trips.

| Single warmed EXPLAIN ANALYZE probe | 1,000 before | 1,000 after | 5,000 before | 5,000 after |
|---|---:|---:|---:|---:|
| Candidate detail query rows | 1,000 | 50 | 5,000 | 50 |
| Candidate detail execution (ms) | 12.082 | 0.944 | 56.080 | 3.113 |
| Vibe detail query rows | 800 | 40 | 4,000 | 40 |
| Global SQL summary execution (ms) | N/A (Node assembly) | 3.922 | N/A (Node assembly) | 34.683 |

These individual plans are not DB p95/p99 estimates. Raw plans retain loops,
shared buffers, costs and query parameters. Global aggregation and offset
selection still scale with assessment size; deep pages, mixed tenants, larger
Vibe workspaces, write contention and sustained traffic require separate tests.
No DB/Redis CPU, frontend LCP/INP/CLS, Judge capacity or DB lock-wait measurement
is inferred from this HTTP experiment.

Raw evidence:

- [1,000 before](measurements/phase2-results-before-1000.json)
- [1,000 after](measurements/phase2-results-after-1000.json)
- [5,000 before](measurements/phase2-results-before-5000.json)
- [5,000 after](measurements/phase2-results-after-5000.json)
- [Means, medians, ranges and equivalence checks](measurements/phase2-results-summary.json)

Example for an already provisioned owned loopback PostgreSQL/Redis pair:

```sh
OJ_DISPOSABLE_BENCHMARK=1 EMAIL_ENABLED=false EMAIL_WORKER_ENABLED=false OPENAI_API_KEY= \
  node scripts/benchmark-enterprise-results.mjs --candidates=5000 --rows=50
```

Run from Back after building the candidate. The matching baseline invocation
uses `--rows=5000` and the same harness copied from the measured candidate commit.
Both require the wrapper-supplied DATABASE_URL, REDIS_HOST/PORT/DB, NODE_ENV=test
and test authentication secrets. A fresh Redis instance is required per run.

## Integration composition and review followup

The results changes were replayed onto enterprise integration source
`6bb0a063d6b731da3bb0435bc3d1678195ffe6c9` in a separate worktree. The composition
retains the newer `getNavigationVersion` prop, identity-sensitive request owner,
synchronous deletion guard and late-continuation checks. The deletion function,
`useEnterpriseTest` retention option, route ownership in `App`, form and shared
request-owner helper remain byte-identical to that base. Only `useTestResults`
adds page selection. WebKit and Firefox keep refresh, ownership and bookmark
coverage and add the results scenarios; existing selectors are not replaced.

Independent integration review found a missing recovery path after candidates
disappear while an owner is on a later page. Against composed application source
`dca3bc2`, the extended actual React DOM probe reproduced an empty page labelled
`전체 1명 중 0–1명 · 2/1페이지` with no way back. A successful out-of-range response
now explains the changed list, reports its actual total and offers a keyboard
accessible first-page action. The action uses the existing login/id-owned page
state and restores heading focus. It does not start automatic retry loops.
The misleading range/table is absent, including when all candidates disappear.

Regression cases cover shrinking from page 2 to one candidate and to zero. All
original pagination, delayed loading, retry, focus and mobile assertions remain.
The DOM probe fails before this correction and passes after it; it also passes
the unchanged route-reset and original pagination checks. The separate full-App
probes still pass late deletion after navigation, late start after account change
and preservation of an unsaved form during ordinary token rotation.

Fresh combined local checks:

- Back `check`: lint, TypeScript, 299 unit tests in 23 files and build passed.
- Six enterprise API suites: 32/32 passed on owned PostgreSQL 17.11/Redis 8.10.3.
- Front `check`: build, private-answer check, seven telemetry cases and E2E types passed.
- CI policy and benchmark negative guards: 14/14 passed.
- Three-engine selection: 5 results scenarios and 16 existing ownership/refresh
  scenarios, 63 engine instances listed. Actual native browsers still require CI.
- Actual React DOM results, ownership and refresh probes passed. This is not a
  native browser, layout or Web Vitals measurement.

[Combined DOM evidence](measurements/phase2-results-integration-dom.json) records
the source blobs and actual probe outputs. The HTTP measurements above remain
tied to their original measured baseline/candidate and identical harness. This
integration check does not silently relabel them as measurements of a later head.


## Remaining gates

Independent review, exact-head CI including actual browser coverage and combined
integration CI remain required. This branch does not deploy or merge to `main`.
