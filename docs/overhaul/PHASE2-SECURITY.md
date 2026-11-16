# Phase II security and dependency verification

Baseline independently read: `c8ba9712d1a29ac633519511e50428ef647edf66`.
This pass distinguishes the source audit, newly executed local tests, and remote
CI. Historical Phase I CI is not counted as a new Phase II execution. No
production endpoint, database, Redis instance, secret or runtime host was used.

## Re-audit of the Phase I boundaries

| Existing item | Source independently checked | Newly executed evidence and limits |
|---|---|---|
| SEC-001, verified email invitations | `enterprise-access.ts` requires `email_verified_at` for email matches. Owner, username and public-test alternatives remain explicit. Submission and Vibe transactions reuse the predicate. | Backend unit checks rerun. The complete API rerun includes `security-boundaries.e2e-spec.ts`; final execution result is recorded below. No real email was sent. |
| SEC-002, private diagnostics | `JudgeService.recordJudgeResult` loads the submitted immutable version before accepting details, derives sample labels from its sorted cases, filters private/duplicate output, and rejects duplicate or out-of-version case results. | Existing `judge-boundaries.spec.ts` rerun as part of 296 unit tests. API integration covers later edits and stored/public responses. Worker authentication remains a separate trust boundary; this is not protection against a compromised privileged executor. |
| SEC-003, sandbox readiness | `VibeRunner` rejects redirects, requires authenticated file access and an anonymous 401/403, and checks Linux/cgroup/seccomp/workdir properties before compilation. | Existing mocked transport tests rerun. These do not prove kernel isolation. Native isolation remains a remote CI gate. |
| SEC-004, temporary-password visibility | `OptionalJwtAuthGuard` removes the identity for `mustChangePassword` accounts; strict routes retain their existing guard. JWT validation reloads account deletion/suspension/token version and live session family. | Existing guard units rerun. Complete API suite includes optional-auth public, author, administrator and strict-route cases. |
| BE-001/BE-002/BE-003, enterprise transaction boundaries | Submission quota uses a user `FOR NO KEY UPDATE` lock, then locks the attempt and checks current invitation/deadline using `clock_timestamp()` before insertion. Workspace creation likewise checks eligibility after the parent lock. | Source agrees with the reported fix. Existing real lock-race tests are included in the API rerun; the coordinator owns additional Phase II assessment-version changes. |
| CI supply-chain boundary | Actions are commit-pinned, workflow permissions are `contents: read`, checkout does not persist credentials, and the aggregate gate depends on audit/images/component/native jobs. No `pull_request_target` workflow was found. | Ten existing CI policy tests were rerun successfully. This does not attest the remote Actions service or every upstream action implementation. |

No new P0/P1 exploit was established by this bounded security pass. That is not
an exhaustive-security claim. The internal callback accepts some legacy
no-detail shapes, and lease timestamps still depend partly on API process
clocks; those were reported to the Judge reviewer as contract/scaling
observations, without inventing an externally reachable exploit.

## P2-SEC-001 — remove the vulnerable legacy ORM dependency chain

The baseline lock and a fresh registry audit reproduced **three moderate package
nodes caused by two advisories**: `typeorm@0.3.31 → glob@10.5.0 → minimatch@9.0.9`.
The advisories are [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
The reviewed application configuration supplies entity classes and migration
classes rather than user-controlled discovery patterns. No external-request
path to the vulnerable configuration was established. This limited
reachability finding does not make the vulnerable packages patched.

Registry metadata still identifies 0.3.31 as the legacy release and 1.1.3 as the
stable release. The existing `@nestjs/typeorm@12.0.3` declares
`typeorm: ^0.3.0 || ^1.0.0-dev`, accepting the selected stable version. The
official [1.0 release notes](https://typeorm.io/docs/releases/1.0/release-notes/)
and [upgrade guide](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/)
describe the replacement of glob with tinyglobby and major-version changes.

### Implemented change

- Pin the direct dependency to **TypeORM 1.1.3**, with the npm-generated lockfile.
  No dependency override, peer-dependency bypass or `audit fix --force` is used.
- Remove the legacy glob/minimatch production chain. Other locked direct
  dependencies retain their versions. The transitive changes come from the ORM
  dependency graph and npm's deduplication.
- Retain the stricter ORM default that rejects null/undefined high-level query
  selectors. Do not restore the old silently ignored-filter behavior.
- Adapt three existing test helpers to TypeORM's positional-or-named raw-query
  parameter type, preserving all assertions, clock substitution and race gates.
- Add `orm-compatibility.e2e-spec.ts` for fail-closed account selectors, raw
  UPDATE tuple shape, actual rollback and structured QueryRunner results.

### Compatibility review

The application uses PostgreSQL, Node 24, `DataSource`, repositories and
parameterized SQL. It does not use removed Connection/global repository APIs,
string-array find options, deprecated lock modes, ORM automatic schema
synchronization, entity discovery globs or the query-result cache. Explicit
table/column names use ordinary ASCII identifiers. Existing migrations remain
authoritative and `synchronize: false` is retained. The default null/undefined
selector change is intentional and directly tested. PostgreSQL transaction,
query shape, metadata, migrations and Nest bootstrap still require the actual
API/migration test gate, not just successful TypeScript compilation.

Fresh npm production audits after this change reported **0 findings** separately
for Back, Front and Judge. This is a dated npm-advisory result, not an assertion
about operating-system images or all future advisories. The CI audit gate is
strengthened from `high` to `moderate`; low findings remain reported.

## P2-SEC-002 — generate inventories with explicit coverage checks

During implementation, `npm@11.9.0 sbom --package-lock-only --omit=dev` exited
successfully but omitted seven direct runtime dependencies shared with build
tools, including Nest common/core/platform-express, class-transformer,
class-validator, reflect-metadata and rxjs. The output had 111 components while
the complete updated Back graph had 450. A separate production-only install
then caused npm SBOM to report missing development declarations. Neither output
was published as a complete production inventory.

`scripts/collect-sboms.mjs` now generates **complete pre-build lockfile graphs**
with npm's CycloneDX support, explicitly includes runtime/build/optional peers,
and checks every lock record's package name and exact version plus all
dependency references before writing an artifact. Shared scoped packages and
duplicate versions are handled. Four tests cover a valid deduplicated graph,
the observed omission class, a version mismatch and a dangling graph edge.

The existing audit job generates Back/Front/Judge inventories and uploads them
as `npm-sbom-<commit>-<attempt>` for 30 days. A manifest records the actual Git
checkout commit, dirty-worktree status, each lockfile SHA-256, inventory count and scope. Local
generation produced 450/263/29 distinct components for Back/Front/Judge,
corresponding to 465/263/29 lock records. Both build and runtime metadata are
included; these counts are not counts of shipped binaries or vulnerabilities.
The generator and its coverage validation fail the job on an incomplete graph.

## Shipping images and remaining license scope

The initial ORM handoff had no installed-image scan: local Docker was unavailable,
and a successful CI image build was not treated as vulnerability evidence.
Subsequent image work supplied real OCI scans. At source
`0e70a2fe6d725362bcb248836c3697d310e16742`, run43805214804, all four actual image
jobs and their explicit evidence gates passed. This image-job result is distinct
from the separately required completed full CI and final integration gate.

| Original package-finding counts | Before HIGH / CRITICAL | Current HIGH / CRITICAL | Decision |
|---|---:|---:|---|
| Back | 6 / 0 | 0 / 0 | Current unmodified raw scan PASS; zero findings at all reported severities |
| Front | 3 / 0 | 0 / 0 | Current unmodified raw scan PASS; zero findings at all reported severities |
| Judge worker | 6 / 0 | 0 / 0 | Current unmodified raw scan PASS; zero findings at all reported severities |
| Runtime | 181 / 5 | 177 / 5 | Original raw exit2 and BLOCKED_FINDINGS retained; exact182 header-component decisions independently reviewed |

These are scanner package records, not counts of distinct independently
exploitable vulnerabilities. Node/nginx application base images and the
Ubuntu/Node/Go runtime stages now use actual reviewed image digests. Targeted
supported library updates, removal of unused global npm tooling from final
application images, a pinned-source go-judge security rebuild and authentication
log redaction address the patchable observations. PostgreSQL, Redis and the
Playwright CI image remain version-tagged; full deployment-image immutability
is still a follow-up. No tag was represented as an immutable digest.

The remaining runtime raw counts are UNKNOWN1, LOW363, MEDIUM561, HIGH177 and
CRITICAL5. The182 HIGH/CRITICAL records refer to an exact Ubuntu UAPI header
package. Linux CNA source evidence, the official package and actual OCI proof
of all990 files establish the reviewed component's absent vulnerable code;
they do not patch the running host kernel. Full raw reports and the separate
per-record decisions remain available. Changed/new/missing/downgraded records,
changed files/package/source, stale evidence, missing coverage, EOSL and expired
review block reuse. Approval expires **2026-11-30 00:00 UTC**, without automatic
renewal. Host readiness remains UNVERIFIED.

The actual final build lists505 production Go packages with no OpenPGP import
or descendant and retains generated source/binary provenance. The raw UNKNOWN
OpenPGP module finding remains visible; absence from that exact import closure
is not a general module-safety assertion. The source-built main Go module's
`(devel)` inventory version also remains an explicit analyzer limitation.
Supported OS/library inventory does not guarantee complete bundled-JavaScript
or arbitrary-binary coverage; complete npm SBOM/audit and image analysis are
complementary scopes.

Original final-image ZIPs, exact source/checkout/image/database identities,
raw counts, byte-proof hashes and independent review are retained in
[evidence/images-run-43805214804](evidence/images-run-43805214804/provenance.json).
The image-specific design documents describe the unmodified scanner,
read-only payload verifier, explicit applicability evaluator and strict wrapper.
No local Docker execution, production host assessment or sandbox escape test
is claimed.

The repository still has no top-level license grant. Back's `UNLICENSED`
metadata and third-party package/asset notices are separate matters. This work
adds no application license and makes no legal-compliance claim. SBOM/image
license fields preserve package metadata; they do not adjudicate every notice.

## Execution record

Environment: Node 24.22.1, npm 11.9.0, user-owned disposable PostgreSQL 17.11 and
Redis 8.10.3 on loopback. The wrapper starts/stops its own services with random
ports and temporary directories. No existing database/Redis instance is reused.

| Command / check | Observed result |
|---|---|
| Baseline `npm run check --prefix Back` | Lint/type/build and 296 units in 22 files passed |
| Upgraded `npm run check --prefix Back` | Lint/type/build and the same 296 units in 22 files passed |
| Fresh production audit, baseline Back | 3 moderate package nodes / 2 advisories |
| Fresh production audit, upgraded Back; Front; Judge | 0 findings for each |
| `node --test scripts/ci-policy.test.mjs scripts/collect-sboms.test.mjs` | 14/14 passed |
| Actual `node scripts/collect-sboms.mjs` | All three complete graphs passed lock/edge coverage checks |
| Actual `node scripts/check-migrations.mjs` under owned services | All legacy/rollback/refusal/fresh-reapply checks passed; expected case-collision refusal was asserted |
| Complete API integration including new ORM contracts | 179/179 tests in 29 files passed, 92.32s; includes four new ORM contracts and the Phase I security/transaction regressions |

The first upgraded type check correctly failed on three existing test-helper
signatures. The narrow type adaptations above fixed them; no test was removed
or relaxed. Remote independent review, the exact branch HEAD CI, native
runtime/pipeline and final integration CI remain separate required gates.

## Complete development graph follow-up

A subsequent complete audit, rather than `--omit=dev`, found four moderate Back
package nodes. They were Vitest/coverage/mocker 4.1.11 and fast-uri 3.1.8 in
build/test dependencies. The production-only zero result above remains true;
it did not establish a clean development environment.

The maintainers identify 4.1.12 as the backport for
[manual mock registration](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
and [Windows redirect normalization](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp).
The fast-uri maintainers identify 3.1.9 for the affected 3.x line in their
[URI normalization advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg).
No public application route to these development-only packages was established.
That does not justify leaving known development-tool vulnerabilities installed.

Vitest and matching coverage are now exactly 4.1.12; normal npm resolution
updates fast-uri to 3.1.9 and compatible development peers. The generated lock
also updates development Vite/rolldown and their optional platform bindings;
every pre-existing production package version remains unchanged. No override,
forced peer installation or major test-framework migration is used.

Fresh complete audits report zero findings for Back, Front and Judge.
[Raw before/after audit data and exact lock hashes](evidence/phase2-complete-npm-audit-2026-11-16.json)
retain the dirty pre-commit execution state. The new engine passes Back lint,
type check, build and 317 unit cases, plus 199 actual PostgreSQL API cases in
32 files (78.20 seconds). Fifteen CI/SBOM policy cases pass. The workflow keeps
the separate production audit and adds the complete graph audit at the same
moderate threshold. A behavioral regression runs the actual shell block with
each of six component/scope failures and proves every failure survives all
later successful audits. Exact-head CI and independent review remain required.

This npm result is distinct from installed-image scanning: global npm tooling,
OS libraries, copied language runtimes and compiler packages may still have
findings even when the application lockfiles are clean. Image findings are
tracked in the image-audit PR and must not be hidden by this statement.
