# Phase III findings and review corrections

The recovery baseline is `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`. This register
distinguishes baseline gaps, implementation-review findings and test/environment
failures. It is not an exhaustive new certification of every route or deployment.
Final implementation/CI/integration states belong to the feature PR receipts and
[PHASE3-VALIDATION.md](PHASE3-VALIDATION.md).

| ID | Category and actual impact | Correction / evidence |
| --- | --- | --- |
| P3-V01 | Baseline assessment-contract gap: Vibe selection and saved execution read the current mutable catalog; algorithm pinning did not cover it | Immutable archive and selected version/model, required workspace provenance, explicit refresh and migration guards; [#75](https://github.com/yakisoba0728/UnsolvableOJ/pull/75) |
| P3-V02 | Baseline privacy fragility: hidden diagnostics were suppressed by a display-name prefix | Use the server's public/hidden cohort; renamed hidden case has unit/native regressions |
| P3-V03 | Initial candidate P2 parity gap: model choice happened at workspace start | Independent two-candidate PG reproduction; preserve the selected model. Current environment allows one model, so the probe models future supported policy changes rather than a currently configurable arbitrary-model exploit |
| P3-V04 | Initial candidate P2 parity gap: readonly template source could be absent from compile input | Independent payload reproduction before/after; merge immutable initial files with saved editable files. Native cases verify actual execution separately |
| P3-S01 | Baseline P2 deployment-hardening gap: dedicated Redis transport depended on external VPN/TLS setup | Worker verified TLS/mTLS and fail-closed dedicated mode. No claim that an observed production connection was exposed; [#74](https://github.com/yakisoba0728/UnsolvableOJ/pull/74) |
| P3-S02 | Initial preflight policy gap: inherited object properties could masquerade as named secrets | Independent constructor/toString/__proto__ reproduction, then string plus own-property allowlist; same probe rejects all three after correction |
| P3-S03 | Initial preflight omitted explicit worker UID and strict sandbox credential placement | Separate source review required UID/GID1000:1000 and the one-key sandbox environment, with negative regressions |
| P3-D01 | Baseline write scalability: full-history recount under a hot problem's statistics lock | Statement deltas, accepted-pair multiplicities, exact count oracle and same-work crossover comparison; [#76](https://github.com/yakisoba0728/UnsolvableOJ/pull/76) |
| P3-D02 | Initial schema design could add reverse stats-to-user/problem lock edges | Avoid a user counter FK; target the already-locked stats row for the problem FK; test actual separately held user/problem rows and concurrent verdict completion |
| P3-F01 | Product gap: no bounded windowed study summary connecting types, difficulty and unfinished problems | New private learning API/page; [#73](https://github.com/yakisoba0728/UnsolvableOJ/pull/73) |
| P3-F02 | New UI development-mode inefficiency: StrictMode replay issued two GETs | Actual StrictMode reproduction, cleanup-before-network boundary, unchanged one-request assertion and three-engine CI |

No root review finding is recorded as a human GitHub approval. Independent means
an implementation author and reviewer were separate agents, with source hashes
and actual executed checks recorded. Source review is not a substitute for native,
browser, image or current-base CI execution.

## Failures that were not concealed as product fixes

- Real Chromium and WebKit CI caught the two learning request-count assertions
  and three focus checks per engine. The keyboard tests had clicked with a pointer
  before programmatic focus. They now use actual Tab/Shift+Tab navigation before
  checking the unchanged visible outline. Request-count assertions were not relaxed.
- Actual Docker Compose output exposed decimal byte strings and absolute default
  secret paths that the first checker fixture did not model. The checker accepts
  only canonical equivalents; invalid numeric/path/secret cases still fail.
- A concurrent Nest rebuild removed `dist` while seed CLI API tests ran in the
  same worktree. The execution order was fixed to build, then API, then migration.
  No assertion or timeout was changed to bypass those failures.
- One Vibe full API run timed out in five existing Missions cases. The same file
  passed24/24 and then the full suite passed222/222 without source/timeout changes.
  Environment load is plausible, but the underlying transient cause is not proven.
- The reviewer's first DB probe used an overlong synthetic username and failed
  existing varchar validation. Only that fixture was corrected; the failure log
  is preserved and is not counted as an application defect.
- A final SQL measurement attempt failed with ENOSPC before PostgreSQL or measured
  writes started. The unchanged retry completed after free space recovered. That
  startup failure contributes no timing samples; exploratory old-code runs do not
  substitute for the final corrected migration's evidence.

## Risks intentionally left visible

Runtime raw HIGH177/CRITICAL5 are separate from the exact component-applicability
gate and its unchanged **2026-11-30 00:00 UTC** expiry. Go/Ubuntu advisory sources
were rechecked and the retained Phase II fixes were not reverted. New image scans
remain mandatory; dependency audit success is not evidence of host-kernel safety.

Privileged host isolation, all-language/all-verdict memory semantics, prolonged
mixed load, full-site visual/accessibility review, large-source transition-table
spill and production migration behavior remain unverified or deferred as specified
in [PHASE3-ROADMAP.md](PHASE3-ROADMAP.md). These limitations are not hidden behind
the code-integration completion state.
