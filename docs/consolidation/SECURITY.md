# Security boundaries and disposition

## Scope and evidence

This consolidation combines source review, concrete negative regressions and the
repository's existing dependency/image/native gates. It does not certify a complete
penetration test or an operational host. The standalone security-workbench skill's
referenced resources/preflight were unavailable in this environment; the actual
work is an ordinary source-backed engineering audit with separate reviewers, not a
registered workbench scan.

| Boundary | Required behavior | Evidence surface |
|---|---|---|
| Account/session | Suspension, withdrawal, password/token-version change or session revocation winning before a guarded write must reject it | Shared actor fence, submission/community/Vibe regressions |
| Owner/examiner/admin | Principal and current role remain distinct from candidate/record owner | Enterprise/Vibe controller and delegation tests, real API ownership suites |
| Private assessment | Hidden fixtures, source, candidate workspaces, invitations and email never enter public summaries/CSV | Existing scalar allowlists, immutable snapshots and negative API tests |
| Native execution | Bounded compilation/run/output, existing verdicts, safe artifact IDs and cleanup | Worker/native matrix, malformed-response unit tests and pipeline |
| Transport | Verified server identity, required configured client certificate/bearer and exact proxy path | TLS negative tests and real Vibe gateway Compose flow |
| Supply chain | Locked install, six npm audit graphs, complete SBOMs and four actual image scans | Dependency/image CI jobs and retained raw reports |
| Recovery | Generated disposable resources, writer barrier, exact schema/data checks and safe rollback refusal | PostgreSQL migrations, restore and cleanup evidence |

Source review found post-authentication race windows that entry-point JWT checks
alone could not close. The actor helper checks current account state under a user
row lock and checks family validity in a separate statement after that lock. Routine
refresh successors in the same active family remain valid. Staff-triggered grading
must check the staff principal separately from the candidate whose work is graded.
For distinct staff and candidate identities, both user rows are locked in database
UUID order before admission. Candidate deletion is rechecked under that lock;
the candidate does not need a live session and is not impersonated. The existing
retained-work read-only contract after withdrawal is preserved.

The Vibe runner's cleanup inventory is collected before malformed response
rejection. Only validated file-map identifiers enter bounded cleanup; string
containers must not become one-character DELETE targets. Cleanup failure does not
turn a malformed execution response into a successful verdict.

## Runtime findings remain present

The inherited final Phase V scan reported **HIGH 177 / CRITICAL 5**, with 182
component applicability records and 990 matched package payload files. It did not
report zero vulnerabilities. Its other severity counts were UNKNOWN 1 / LOW 363 /
MEDIUM 560; earlier MEDIUM 561 belongs to a different historical scan.

The active [applicability policy](../../scripts/image-applicability-policy.json)
is bound to exact advisory, component, source, scanner and payload evidence. Its
expiry remains **2026-11-30T00:00:00Z**. This consolidation does not extend it,
reduce scanner severity, pin an older database, remove assertions, ignore a new
finding or waive a changed payload. Fresh image CI must fail on unsupported drift
or expiry. A matching reviewed header-package finding does not establish that a
host kernel is patched or an executor escape is impossible.

Back/Front/Judge images had zero findings at the historical checkpoint. The new
consolidation's four actual current scan reports are required independently; old
image results cannot substitute for them. Review decisions in this work are AI
engineering reviews, not human approval or an operator's production authorization.

## Secrets and retained data

Only synthetic/local test identities and the repository's disposable fixtures are
authorized. Do not publish production database dumps, personal browser profiles,
operational tokens, private certificates or paid-provider output. Preserve raw CI
evidence after checking it for credentials and personal data. Generated short-lived
test secrets are not a reason to capture an actual user's session.

Archived historical originals remain immutable. Active security-policy inputs and
their replay tests remain in the checkout and continue to validate exact digests.
See [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) for the independent preservation checks.

## External security gates

Dedicated host/kernel inventory, actual firewall/egress, private topology, credential
distribution, certificate issuance/rotation/revocation, monitoring ownership and
production backup access remain **BLOCKED_EXTERNAL_ENVIRONMENT**. No dangerous
sandbox escape or host-privilege experiment is performed on a shared CI runner.
See [REMAINING-RISKS.md](REMAINING-RISKS.md) for the release decision boundaries.
