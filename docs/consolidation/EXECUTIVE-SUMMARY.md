# UnsolvableOJ final consolidation

## Decision authority

**Code acceptance requires the final PR's post-run receipt.** This source document
records implemented scope and reproducible gates; it does not anticipate its own
future CI. Operational deployment remains **BLOCKED_EXTERNAL_ENVIRONMENT**.
The final PR targets main directly and is intended for manual review and merge.

The exact Phase I–V source is preserved in one baseline commit with an identical
complete Git tree. Focused quality fixes follow as separate commits, preserving
the original116-commit history and PR63/86/92 discussions. Original PRs remain
open until the new source fully qualifies; they are then closed as superseded,
without merging or deleting their branches/history.

## Material changes

| Area | Corrected behavior | Why it matters |
|---|---|---|
| Submission admission | Recheck current account/token/session after the account lock, including administrators | A request authenticated before withdrawal/suspension/logout cannot write after revocation wins |
| Community saved/follow | Recheck the acting user after the existing post lock | Withdrawal cleanup cannot be undone by an old blocked request |
| Community forms | Own writes by login identity across routine token refresh | Preserve drafts, pending controls and successful completion without accepting a replacement login's callback |
| Settings | Own session-changing writes by login identity and serialize them; clear secrets on a new login | Avoid stuck successful updates and stale password fields/status crossing login boundaries |
| Vibe executor replies | Capture bounded safe artifact IDs before malformed-response rejection | Prevent leaked partial caches and unintended one-character cleanup requests |
| Vibe mutation admission | Carry the full actual principal through user/admission/parent/workspace locks | Close stale candidate-session writes while preserving separate staff and candidate identities |
| Staff Vibe grading | Lock staff and candidate rows in deterministic UUID order before admission; recheck candidate withdrawal | Retained work remains readable while a withdrawn candidate cannot receive a new evaluation |
| Vibe start screen | Bind completion to the initiating login and navigation; close its own stale blank popup | Prevent delayed old-login responses from navigating after logout, account replacement or leaving the page |
| CI | Force all suites and all four real image builds on the exact final branch/main pair | Later documentation-only commits still receive complete final validation |
| Evidence | Verify immutable originals and replace bulky duplicate review-tree data with a digest index | Reduce review noise while preserving adverse results, policy inputs and reproducibility |

Shared actor/request helpers remove demonstrated duplication. No migration,
framework rewrite, public API-body change, score/XP rewrite, native verdict change,
new runtime dependency or speculative product feature is required for these fixes.
Additional independently reproduced follow-up fixes and their exact review
subjects are tracked in [PROGRESS.md](PROGRESS.md) and the final acceptance receipt.

Six distinct agents performed the requested domain roles, with at most three
workers running concurrently. Their [audit records](audits/README.md) identify
authors, independent reviewers, immutable local patch subjects, actual executions
and scope limits. The coordinator independently reviewed and replayed the final
Vibe screen correction; its author did not approve that patch.

## Validation interpretation

Each patch has a failing original-source regression or explicit source evidence,
a focused fix and separate review. Local unit/DOM/build checks do not substitute
for actual PostgreSQL, native executor, Compose, image scanning or browser engines.
The current-source12-job run must execute those gates. Final counts, source/base,
merge checkout/parents/tree, retries/skips and reviewer findings belong to its
immutable receipt.

The Runtime image's inherited raw HIGH177/CRITICAL5 remain visible under an exact
component applicability decision expiring **2026-11-30T00:00:00Z**. A fresh mismatched
scan or expiry is blocking. No host-kernel safety or zero-vulnerability claim follows.
No new performance speedup is claimed; controlled bundle sizes and finite CI
observations retain mixed/adverse results and their measurement limits.

The first current-source run blocked changed vendor advisory metadata. A
[separately reviewed finite revalidation](evidence/runtime-revalidation/ACTIVATION.md)
preserves the failed scan and prior policy while retaining exactly the same182
CVE IDs,990-file payload manifest, expiry and enforcement. That update requires a
new full run; the post-run receipt determines final acceptance.

## Review guide

| Question | Canonical document |
|---|---|
| What runs and which boundaries matter? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Which existing features, pages and migrations remain? | [FEATURE-MATRIX.md](FEATURE-MATRIX.md) |
| What is actually established about security? | [SECURITY.md](SECURITY.md) |
| Which measurements exist and what do they mean? | [PERFORMANCE.md](PERFORMANCE.md) |
| How are exact-source tests and separate reviews enforced? | [QUALITY-AND-CI.md](QUALITY-AND-CI.md) |
| How should manual merge and operational release be considered? | [MIGRATION-AND-RELEASE.md](MIGRATION-AND-RELEASE.md) |
| Where are original commits/contributions and tree equivalence? | [PROVENANCE.md](PROVENANCE.md) |
| Which raw originals remain verifiable? | [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) |
| What is still blocked or deferred? | [REMAINING-RISKS.md](REMAINING-RISKS.md) |
| Where should an interrupted session resume? | [PROGRESS.md](PROGRESS.md) |

After final qualification, the user's next code decision is the one replacement
PR. Main merging, infrastructure operations and production deployment remain
separate decisions; this consolidation does not perform them automatically.
