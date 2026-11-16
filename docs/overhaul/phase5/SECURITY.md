# Phase V security evidence and deployment limits

## Decision at this checkpoint

**The exact component policy is independently reviewed; fresh full CI is still required.** The
fresh foundation run [43884655462](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43884655462)
failed its Runtime image job because the current Trivy database changed reviewed
advisories. The failure is retained; it is not converted into a successful run.
The immutable author proposal is commit `5021547e8214cd6404bc2e7728c70634dbca0c63`,
tree `61650d4c296150f540468aa6fd5e049df13bce7b`. It was **PROPOSED**, with no
approval metadata, and remains archived in [proposed-policy.json](evidence/security/proposed-policy.json).
The independent reviewer and coordinator subsequently approved the exact content
SHA256 `d938665f24995ea53bf0984047459de0aa9ba366dc5ebbe37055f304c68903fb`.
Only review metadata changed in the active policy. Its expiry remains
**2026-11-30 00:00 UTC**. These are separate AI source reviews, not human GitHub approvals.

The [independent receipt](evidence/security/independent-policy-review.json),
[coordinator receipt](evidence/security/coordinator-review.json), and
[activation replay](evidence/security/activation-replay.json) preserve their limits.
The replay returns `PASS_WITH_REVIEWED_COMPONENT_FINDINGS` for the retained scan;
it does not substitute for a fresh image build, scan, payload verification and full CI.

Raw findings remain **HIGH 177 / CRITICAL 5**, with scanner exit **2**. The full
raw totals are UNKNOWN 1, LOW 363, MEDIUM 560, HIGH 177, CRITICAL 5. A separately
approved exact-component decision permits a retained-scan replay of
`PASS_WITH_REVIEWED_COMPONENT_FINDINGS`; that state does not mean patched,
zero vulnerabilities, a safe host kernel, or production deployment approval.

This review targets the changed Runtime evidence and Judge/Vibe test boundary.
It does not repeat the previous repository-wide audits. The immutable source and
artifact bindings are in [runtime-revalidation.json](evidence/security/runtime-revalidation.json).
Subsequent approvals and CI must identify their own exact policy content,
source/head/base, checkout and tree; they do not retrospectively change this
proposal or the failed artifact.

## What changed in the evidence

The foundation source is `ce26659b816c1dc1450cdc48f0c58d6e41ecea1e`;
Actions checked out `a5c85b0f4a32fb1451a51f6db95d7a6abbee3970`, whose tree is
`6fcefbd2a2714b1cad1e2c51fa090958c73b6048`. The baseline is Phase IV
`d0159b1f844bf0608415dded9e84af566c8e2041`. The retained
[failed artifact](evidence/security/blocked-runtime.zip) has SHA256
`d373738b4b069fb081ea29563f28bd495ee9b32bbaeb9dfc4fd067267e0778c2`.

The vulnerability database was updated at `2026-11-16T13:03:44.830426244Z` and
downloaded at `14:26:32.678698877Z`. Its exact report differs from the prior
review in 64 normalized advisory records. Fifteen are in the reviewed cohort:
two CRITICAL and thirteen HIGH. Every one changes `References`; two also change
`VendorSeverity.rocky`. No HIGH/CRITICAL ID was added or removed. One unrelated
MEDIUM finding, CVE-2026-80920, disappeared. The complete before/after fields are
preserved in [advisory-delta.json](evidence/security/advisory-delta.json).

| Changed reviewed records | Material change examined |
|---|---|
| CVE-2025-39933 | References; Rocky severity 3 to 2, matching the Moderate kernel advisory RLSA-2026:2282 |
| CVE-2025-40170 | References; Rocky severity 2 to 3, matching the Important kernel advisory RLSA-2026:1690 |
| CVE-2026-64523, CVE-2026-68426 | References; both retain CRITICAL raw severity and kernel implementation findings |
| CVE-2025-68745, CVE-2026-31692, CVE-2026-52991, CVE-2026-53281, CVE-2026-63879, CVE-2026-68245, CVE-2026-68257, CVE-2026-68409, CVE-2026-74752, CVE-2026-89631, CVE-2026-98364 | References; retained HIGH severity and unchanged Linux CNA source mappings |

All 182 Linux CNA records were fetched from immutable CVEProject commit
`5c76d3320764ef1abc9ed353a5c3ebc0ce4ac775`. Every raw byte hash and exact affected
source mapping matches the prior evidence: 181 mappings outside exported
headers, plus the previously reviewed kernel-only UAPI case CVE-2026-80668.
The fresh archive matches the existing archive SHA256
`54c6826a9e0b1453dbf8e99ddf68f644edd519af3829d8106fc719bc3aa7e89c`, so the
existing archive is reused. The [author comparison](evidence/security/cna-revalidation.json)
explains that the unchanged collector's historical `independent_recovery`
label is not a new independent approval: this retrieval was performed by the
Phase V proposal author.

Twelve original Rocky publisher-feed JSON records cover all fifteen changed
reviewed CVEs. Their hashes, affected Rocky Linux 10 kernel packages, severity
changes and source comparisons are recorded in
[vendor-advisory-review.json](evidence/security/vendor-advisory-review.json).
The raw JSON is retained in [primary-vendor-records.zip](evidence/security/primary-vendor-records.zip).
Direct vendor HTML returned either a JavaScript shell or a Site Unavailable
body despite HTTP 200; those responses are explicitly excluded as advisory
content. Primary Red Hat pages provided supplemental rendered corroboration.
Unrelated CVEs and bug-tracker cross-links bundled in those advisories were not
individually audited.

The current OCI payload proof matches **all 990 package-owned regular files**
against the exact official `linux-libc-dev 6.8.0-149.149 amd64` manifest. No
missing, changed, nonregular or unexpected owned files were reported. The
current image config is
`sha256:5183d74ef1e1299ffd899fd4a624d9ca37307f873d86f1c29d5fabb255fa7e06`.
All 225 normalized installed package/version identities match the prior raw
baseline. This is retained CI evidence; no local OCI execution is claimed.

The five previous CRITICAL patch reviews and the special UAPI proof are carried
forward verbatim, with their historical scope stated. The new evidence does not
pretend to contain 182 new individual patch reviews. The vulnerable implementation
is absent from this exact header payload; host code, enabled subsystems and
kernel configuration remain a separate unresolved boundary.

## Supported updates and remaining findings

The current [Trivy release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2)
is the already pinned v0.76.2. The fresh report contains APT/libapt
`2.8.4ubuntu0.1`, satisfying the fixed Noble version in
[Ubuntu CVE-2026-109518](https://ubuntu.com/security/CVE-2026-109518).
The build retains the documented `Acquire::Retries=0` mitigation while the
bootstrap APT installs that update. It also retains PCRE2 `10.42-4ubuntu2.2`,
Perl `5.38.2-3.2ubuntu0.7`, Go `v1.27.4` and x/net `v0.62.0` in the observed
image. The x/net version meets the fix boundary in
[GO-2026-6860](https://pkg.go.dev/vuln/GO-2026-6860).

The two changed CRITICAL Ubuntu records,
[CVE-2026-64523](https://ubuntu.com/security/CVE-2026-64523) and
[CVE-2026-68426](https://ubuntu.com/security/CVE-2026-68426), still describe the
Noble Linux fix as work in progress in `6.8.0-151.151`. Rocky or Red Hat RPM
updates cannot be called an installed Ubuntu fix. No supported package change
identified in this bounded check justifies claiming the residual exact cohort
patched or zero. No package, image tag, scanner implementation, severity, expiry
or runtime behavior is changed by this proposal. The raw UNKNOWN finding for
deprecated OpenPGP remains reported; the existing Go import-closure assertion
continues to exclude that package from the production binary. See
[GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932).

## Verification and independent Judge review

The existing focused suites passed **92/92** at the foundation source: image
audit 15, image gate 15, OCI payload verifier 27 and exact applicability 35.
After the new proposal was assembled, the applicability suite passed another
**35/35**. These are denial/evidence tests, including synthetic fixtures; they
are not new production kernel or OCI executions. The unchanged evaluator also
checked the real failed scan against the proposed bundle: exit 2,
`BLOCKED_REVIEW`, only `INDEPENDENT_POLICY_REVIEW_REQUIRED`, 182 proposed,
zero reviewed, 182 blocking, no unresolved cohort. The original raw failure
still records `EXACT_CVE_COHORT_REVALIDATION_REQUIRED`.

The independent source review of Judge commit
`4fbb5156e2d94a2148b49cdb42ae10ea54ffedf3` accepted its scoped implementation,
pending real native/pipeline CI. The reviewer separately ran Judge checks:
**137/137 passed, zero skipped**. The 72-cell native matrix, actual memory
boundaries, forwarding gateway and persisted assessment must still be verified
by their actual CI run. They are not inferred from unit-test success. Details,
limits and the nonblocking Java-OOM evidence observation are in
[judge-independent-review.json](evidence/security/judge-independent-review.json).

## Deployment boundaries

Production TLS/configuration/templates have not changed since the accepted
Phase IV baseline in this security patch. The targeted review retained the
following boundaries in [VIBE-TRANSPORT.md](../phase4/VIBE-TRANSPORT.md), the
dedicated Compose overlays, and the new forwarding test implementation:

| Boundary | Code or evidence retained | Remaining operator gate |
|---|---|---|
| API to dedicated Vibe gateway | Verified CA/SAN, TLS minimum, client certificate/key, separate bearer, bounded bodies/deadlines, no redirects | Approved gateway image/version, private DNS, issuance, revocation and restart-based certificate rotation |
| Gateway to executor | Bearer forwarded unchanged; missing/wrong bearer denial; restricted routes and bounded forwarding | Actual deployed nginx/configuration, ingress allowlist and egress enforcement |
| Privileged runtime | Dedicated template, no application DB/Redis/JWT identity, no published host port, internal network and resource bounds | Trusted separate host/VM, current kernel and isolation controls; no shared-runner escape experiment |
| API/data credentials | Existing ownership/authentication checks, separate secrets and network roles; no credential changes here | Real secret storage, file permissions, rotation, private networks and deployment-specific verification |
| Test evidence | Ephemeral localhost identities, no bearer/key/body output, awaited cleanup, no canned native success | Real native CI results and final integration source/checkout/tree binding |

The API overlay moves its Vibe connection; it does not relocate existing
algorithm Judge services automatically. All submitted-code execution requires
the separate algorithm deployment boundary as well. An internal Docker network
does not establish privileged-container isolation. Standalone Compose secrets
are file mounts, not an encrypted secret-management service.

**BLOCKED_EXTERNAL_ENVIRONMENT** remains the status for production host/kernel,
firewall/egress, operational certificate/secret rotation and production deployment
validation. No production resource, paid provider, privileged host experiment,
main branch or earlier final PR is changed by this work.
