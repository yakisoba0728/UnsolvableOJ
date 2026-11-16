# Phase V Judge and Vibe qualification

Baseline: Phase IV `d0159b1f844bf0608415dded9e84af566c8e2041`, tree
`f12f6c377ea07f0cb4b498ca0fe5889ed4401a66`; accepted CI
[43852089830](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43852089830).
This increment preserves the production Judge, its verdict mapping, resource
limits, admission policy, worker recovery and Vibe transport. It adds targeted
execution evidence where Phase IV explicitly had missing coverage.

## Status at implementation checkpoint

| Item | State at this commit | Evidence / next gate |
|---|---|---|
| All-language memory cases and matrix recorder | IMPLEMENTED; TypeScript compiled | `Judge/src/runtime.test.ts`, `Judge/runtime/memory-sources.json` |
| Existing worker/algorithm regressions | TESTED: 137/137, zero skip/fail | Local `npm run check --prefix Judge` |
| Dedicated Vibe native pipeline | IMPLEMENTED; focused lint/typecheck passed | `Back/test/vibe-dedicated.pipeline-spec.ts` |
| Test gateway actual TLS forwarding | TESTED: four localhost requests | Correct/absent/wrong bearer and UTF-8 POST round trip; upstream fixture, **not native execution** |
| New native memory / persisted dedicated assessment | NOT_EXECUTED locally | Docker executable and socket unavailable. Required CI must execute them; source compilation is not a native pass. |
| Independent review and current-head full CI | PENDING | Coordinator's later immutable PR receipt is authoritative. |

Back dependencies were shared through an uncommitted `node_modules` symlink.
The ordinary local typecheck rejected existing inferred type references through
that external path (`TS2883` in unchanged authentication files); the same
typecheck with `--preserveSymlinks` passed. No source or compiler configuration
was changed to hide this local dependency-layout limitation. Focused type-aware
lint had zero warnings/errors after correcting the new test code.

## Finite language/verdict and memory matrix

The prior native suite already exercised all eight languages across normal
execution, WA, nonzero-exit RE, time, output, syntax and long UTF-8 inputs. Those
cases are preserved and now produce source-bound observations. The only added
native work is **16 sequential memory cases**, two for each language.

| Scenario per language | Required observation |
|---|---|
| AC | Two accepted arithmetic cases, exact public-only diagnostic output |
| WA | Wrong output, zero accepted cases |
| RE | Nonzero process exit, zero accepted cases |
| TLE | Existing bounded infinite loop, 1,000 ms limit |
| OLE | Existing output overflow, zero accepted cases |
| Syntax | CE for C/C++/Java/TypeScript/Go/Rust; RE for interpreted Python/JavaScript |
| UTF-8 | 262,144-character long echo with Korean, emoji and CRLF; two cases, public preview only |
| Memory under | Touch and sum one byte per 4 KiB page of an 8 MiB allocation under a 128 MiB execution limit; must be AC |
| Memory over | Attempt and touch 192 MiB under the same 128 MiB limit; engine MLE, with the narrow Java exception below |

Languages: **C, CPP, JAVA, PYTHON, JAVASCRIPT, TYPESCRIPT, GO, RUST**.
The JSON matrix contains exactly **72 observations (8 × 9)**. A missing,
duplicate-replacing, failed or incomplete cell cannot produce a PASS report.
At this checkpoint the 16 added native cells are **UNVERIFIED** until their
actual CI receipt is available. The expanded native suite is expected to report
**90 tests including its parent** (74 prior + 16 added); this is a planned count,
not an assertion that it has already run.

Java receives `-Xmx128m`, and Node receives
`--max-old-space-size=128` in memory probes, exactly as production Judge derives
its limits. A Java request for a single 192 MiB array can fail inside its VM
before the cgroup reaches its memory limit. Only Java `RUNTIME_ERROR` with the
explicit `java.lang.OutOfMemoryError: Java heap space` diagnostic is accepted
as that alternative. It remains **RE**, never relabeled MLE. Every other
over-limit fixture must be engine-classified MLE; an arbitrary signal, RE,
timeout, system error or accepted program fails the probe. Existing Python
SIGKILL and combined-child-memory checks remain separate native assertions.

Each case retains the configured cgroup limit, heap flag, time limit, source
SHA-256, actual normalized verdict, executor-reported peak KiB/runtime ms,
wall duration and per-case results. The report does not claim raw engine signal
or cgroup OOM-event telemetry. It includes Actions source/base/checkout/tree,
runner/kernel/Node identity and tracked-tree cleanliness. Source, inputs,
private fixture contents and bearer tokens are not copied into the matrix.

Protocol bounds: existing 600-second overall native suite deadline; sequential
execution; each new run at most 5 seconds and 128 MiB; compilation retains the
existing 30-second/1,024-MiB bounds. Cached executor files must equal the starting
set after the suite. The test writes `Judge/reports/phase5-verdict-matrix.json`
also when a subtest fails. CI must retain this file on native success or failure.

This is one finite trial per cell. It is not a memory-threshold search, an
all-runtime signal matrix, production capacity, a latency distribution or a
proof that a privileged host/kernel cannot be escaped.

## Actual dedicated transport to native assessment

The new pipeline uses the real API routes, PostgreSQL, immutable snapshot,
VibeRunner and go-judge compiler/executor. Between VibeRunner and go-judge it
starts an **owned real Node HTTPS forwarding gateway** with ephemeral CA,
server SAN and API client certificate. TLS verifies both peers. The gateway
forwards payloads and correct, absent or incorrect bearer headers unchanged;
it never manufactures a successful execution result or native authentication
denial. Two anonymous probes and a wrong-bearer probe must be rejected upstream.

The saved solution goes through public execution and final hidden assessment,
then is read back through the API. Assertions require 11/11 functional checks,
the original content version and saved file, an unavailable paid evaluation,
owner-only access and zero cached-artifact delta. Only the paid evaluator is
replaced with an explicit unavailable-provider double. Test configuration
routes the actual runner through the gateway without mutating process-wide
environment values or carrying deleted certificate paths into later tests.

The existing CI native sandbox is reused **sequentially**, without new
privileged containers or changed sandbox privileges. Within this test, its
bearer belongs to Vibe and the application's algorithm setting is an independent
synthetic secret. No production shared-secret configuration is proposed.

The gateway allows only required method/path pairs, accepts at most 128
requests, bounds both directions at 1 MiB, and forwards each request under a
15-second deadline. It binds only an owned loopback port and refuses any
non-loopback upstream origin. The test uses the existing 90-second pipeline
deadline. Client agents, in-flight forwarding, sockets, HTTPS server and
temporary private keys are closed or removed with awaited cleanup. Cleanup
failure is a test/report failure. Reports retain method/path classes, verified
mTLS, bearer classification, byte counts and actual upstream statuses, never
tokens, keys or cached file identifiers.

CI must retain `Back/reports/phase5-vibe-dedicated.json` on pipeline success or
failure. The report is not interchangeable with the existing TLS protocol-only
test or embedded Vibe native test: it adds their actual connected native path.
It still does **not** execute the production nginx configuration, a browser
through dedicated mode, a deployed remote gateway, certificate rotation or paid
provider quality. Those limits remain explicit.

## Load and recovery evidence reused

Phase IV's final 24-job, three-wave, two-worker observation remains the bounded
capacity baseline: 24 AC, active 1.03618 jobs/s versus wall 0.21400 jobs/s,
queue p50/p95/p99 333/1,111/1,131 ms. Its source and runner identity are tied to
the [Phase IV final receipt](https://github.com/yakisoba0728/UnsolvableOJ/pull/86).
The existing native pipeline again executes finite worker kill/natural lease,
Redis/API restart, callback/rejudge/duplicate and repeated-wave checks in CI.
This increment does not rerun a larger shared-host load to claim a capacity
improvement. Node-worker CPU/RSS must not be called compiler/executor or whole
platform memory. Small-sample p99 remains an order statistic.

## Remaining external gates

- **BLOCKED_EXTERNAL_ENVIRONMENT:** approved dedicated VM/host, kernel patch
  and isolation, private routing/firewall/egress, deployed gateway software and
  certificate issuance/revocation/rotation.
- **BLOCKED_EXTERNAL_ENVIRONMENT:** production-scale sustained multi-API and
  multi-worker performance and complete platform resource observation.
- **DEFERRED_NONBLOCKING:** browser-through-dedicated-gateway combination;
  actual browser/embedded-native flows and dedicated API-native flow are
  distinct evidence and do not prove that complete combined path.
- **UNVERIFIED outside the finite protocol:** all runtime signals, precise
  memory thresholds, long-term saturation, host power loss and provider quality.

No production service/data, admission limit, verdict heuristic, privileged
runtime policy, image scanner, review expiry or paid provider was changed.
