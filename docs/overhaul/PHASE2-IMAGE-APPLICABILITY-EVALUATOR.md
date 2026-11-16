# Exact component applicability evaluator

## Status and decision boundary

The coordinator recorded the independent review of the exact policy content at
2026-11-16 04:25 UTC. Both Product's independent review and the coordinator's
review bind source `d5c3bd78a0fcb5f2fad02fec2679c6aa36345325`, the separately
reviewed test transition `6ca651bfbbc9dbe6de02980a1d9a58108c56fea1`, and canonical
content hash `ebc01bdbbd31f6adf2e0761bdb7c278b92c72ebeca1a175523e4f2a0b74083aa`.
Only the policy's review metadata changed; component, CVE records, source/file
bindings and the 2026-11-30 expiry were not widened or extended. This is a
repository review record, not a vendor attestation or host security claim.

Before approval, the actual unchanged run43802320491 artifacts returned
`BLOCKED_REVIEW`,182 proposed decisions, zero reviewed decisions and all182
raw blockers. That original result remains retained. The approved evaluator
records182 separate code-not-present decisions for the same exact artifact;
the raw scanner report and its177 HIGH/5 CRITICAL findings remain unchanged.
Independent records are in `evidence/image-applicability/`; proposed and reviewed
actual evaluations are retained in `measurements/phase2-image-applicability/`.

Workflow orchestration and the final rebuilt image still require separate
independent review and exact-source-head full CI. This content approval cannot
substitute for those gates or verify a later image. Permanent proposed-state,
new/changed/missing finding, metadata, expiry and malformed-evidence denial
tests are retained and do not inherit the committed approval.
The sole reviewed component is Ubuntu 24.04, Linux/amd64,
`linux-libc-dev` **6.8.0-149.149**, source `linux` at the same version, with the
exact reviewed PURL and 990 regular-file manifest. The conclusions concern the
absence of the identified vulnerable implementation from this exact header
package. They are not a patch, a claim of zero CVEs, an assertion about other
image contents, or evidence of host kernel safety. Host applicability remains
**UNKNOWN** and host readiness **UNVERIFIED** in every decision.

The original scanner still reports the same **177 HIGH and 5 CRITICAL** header
findings. The evaluator records a separate proposed or reviewed decision for
each exact CVE; it never rewrites those findings, their severities, descriptions,
identifiers or raw report bytes. Other package findings, EOSL and the scanner's
lower-severity policy retain their existing meaning.

## Evidence chain

| Binding | Required agreement |
|---|---|
| Static applicability review | All 182 individually enumerated Linux CNA records, immutable source snapshot, exact affected paths, five Critical patch reviews and the separately resolved CVE-2026-80668 UAPI overlap |
| Official package evidence | Exact package/control fields, archive digest and 990 regular-file paths, sizes and SHA256 values; manifest hash `010441a3487f836ca8d56b32d3264cd286c2d11b569f44b54d2ba3e949911172` |
| Original scanner evidence | Untouched retained ZIP and raw report digest; every policy advisory digest, original severity and scanner fingerprint must match that report |
| Scanner implementation | Reviewed `image_audit.py`, scanner pin file, Trivy 0.76.2 and exact executable SHA256 `6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3`, also bound to the original artifact |
| Current scan | Completed clean-source runtime scan, exact source hashes, image/build/index/config/layer identities, unchanged raw report SHA256, freshly recomputed original summary and runtime library coverage |
| Scanner databases | Original adapter rules: vulnerability DB metadata no older than 48 hours and a recorded database digest; observed Java DB metadata no older than seven days and a digest, or explicit absence with no Java archive result |
| Actual payload proof | Separately reviewed verifier source `50fad46384b439a49d54aa7ebe86767ebdf56797`, helper SHA256 `7e78255490cb16ad6369423d6efc75a7bb2faebd35500f0918035a329da119e0`, same raw scan and exact OCI identity |
| Final installed package | Exact dpkg status/source/version/architecture, status/list byte hashes, unique owned-file set, exact scanner inventory, all 990 final file bytes/sizes/kinds and final layer membership |

The applicability, manual-review, package-manifest, original-artifact and
scanner-algorithm evidence files are independently SHA256-bound in the policy.
Missing files, changed hashes, unknown schemas, unsupported source mappings,
unreviewed epochs, duplicate package records and incomplete proof records are
blocking evidence failures. The raw package's official repository metadata is
required even though the verifier's intentionally smaller package projection
does not repeat that field.

The payload proof must contain the entire current scan's original severity
counts, exact numeric success/failure counters, both dpkg control hashes and
every final file's layer digest. Its no-container/no-extraction flags and read
counts must agree with the reviewed helper's finite limits: 128 layers,
4 GiB compressed data, 8 GiB uncompressed data, 200,000 archive entries and
180 seconds. The actual helper independently enforces the bounds while reading
the OCI content; checking reported counters alone is not a substitute for that
execution. See [the payload verifier contract](PHASE2-IMAGE-PAYLOAD.md).

Current scan and payload observations must be within 24 hours of evaluation
and within one hour of one another. The current raw scan remains independently
bound to the same config digest, manifest and ordered layers as the payload
proof. The proof's regular-file digest is computed from sorted canonical paths
with compact UTF-8 JSON; directory counts are recorded, while directory
metadata, modes and xattrs remain outside the byte manifest's claim.

## Advisory changes and image-derived fingerprints

The full advisory canonical hash includes every raw finding field, including
future additional fields, except three pieces of separately checked artifact
identity: `Layer`, `Fingerprint`, and `PkgIdentifier.UID`. The current finding's
layer and complete package identifier must match the current selected package.

The raw Trivy `Fingerprint` is **recomputed and required**, not ignored. The
pinned Trivy source computes it as SHA256 of UTF-8
`ArtifactID:Target:PkgID:VulnerabilityID`, with the `sha256:` prefix. This limited
policy only accepts local OCI scans whose registry reference, RepoTags and
RepoDigests are absent, for which the reviewed scanner source uses ImageID as
ArtifactID. It requires that ID to equal the independently verified OCI config.
Tagged or otherwise referenced image inputs are outside this reviewed rule.

The original and first rebuilt runtime reports have different image IDs and
therefore different raw fingerprints. All **364** raw fingerprints were
recomputed against the pinned source; the **182** remaining complete advisory
hashes match between those reports. The immutable upstream URLs, four source
hashes, both image/report identities and each raw fingerprint/advisory digest
are retained in
[`phase2-trivy-fingerprint-binding.json`](evidence/phase2-trivy-fingerprint-binding.json).
Independent review reproduced this calculation; it does not establish actual
image bytes by itself.

All 182 reviewed IDs are revalidated **as one exact cohort before any decision
can be reused**. A removed ID, a downgrade to MEDIUM/LOW/UNKNOWN, a changed
advisory field or severity, an added target HIGH/CRITICAL ID, a duplicate,
incorrect derived fingerprint, changed component identity, or an unexpected
result context blocks the whole cohort. Removing all 182 from a report cannot
silently produce an applicability pass. Existing unreviewed lower-severity
records are not classified by this policy; they remain in the raw report under
the original scanner gate.

## Approval, expiry and execution

The reviewed policy expires at **2026-11-30 00:00:00 UTC**. The parser rejects a
review window longer than 14 days. Expiry cannot renew automatically. Changed
component, advisory, source evidence or policy content requires a new reviewed
evidence set and content hash; old approval metadata cannot authorize it.

A `REVIEWED` policy requires two distinct non-author identities, one
independent reviewer and one coordinator, each with an immutable reviewed
commit, plus a review timestamp and canonical hash of the exact policy content.
These are **repository review records, not cryptographic attestations or a
replacement for GitHub review and CI**. The coordinator must verify that the
recorded review actually happened against the composed source and actual image
evidence. The evaluator author did not approve their own policy; the coordinator populated the records only after both independent reviews and actual byte evidence.

```sh
python3 scripts/image_applicability.py \
  --scan-report /path/to/retained/trivy.json \
  --scan-manifest /path/to/retained/manifest.json \
  --payload-proof /path/to/retained/payload-verification.json \
  --output /path/to/new/applicability-evaluation.json
```

The output must be new. Existing files, symlink/hardlink aliases to inputs and
policy-bound evidence cannot be overwritten. Reads are bounded, duplicate JSON
keys are rejected, and malformed nested metadata produces a structured
`BLOCKED_EVIDENCE` result. The CLI has no option to approve a policy, alter its
clock or suppress a scanner finding.

| Result | Exit | Meaning |
|---|---:|---|
| `BLOCKED_EVIDENCE` | 1 | Missing, stale, malformed or mismatched provenance/payload; no decisions authorize an exemption |
| `BLOCKED_REVIEW` | 2 | Complete proposed evidence or expired review; raw blockers remain |
| `BLOCKED_FINDINGS` | 2 | Changed cohort, another blocking package finding, or EOSL |
| `PASS_WITH_REVIEWED_COMPONENT_FINDINGS` | 0 | Only possible after separately recorded review, complete current proof and no remaining blocker; raw HIGH/CRITICAL counts remain present |

This standalone evaluator is intentionally strict about the cohort. A later
wrapper may honor the unchanged scanner's ordinary raw PASS when it has no
HIGH/CRITICAL/EOSL blockers, without invoking or reusing an applicability
decision. That orchestration is a separate review scope; it is not enabled by
this change.

## Verification and limits

Local verification: **73 Python image tests passed** (31 evaluator tests,
27 payload-verifier tests and 15 existing scanner tests). The actual-run
proposed evaluation is retained in
[`actual-43802320491-proposed.json`](measurements/phase2-image-applicability/actual-43802320491-proposed.json).
It binds original scan SHA256
`0d1d1ea81522458479ac85bfd27e13d764562f421193b9421e6de0b64cf6751a`,
payload proof SHA256
`09939784959227cd539807cd5d88e74f32293ee5d12e87ed33bee63529b6cd59`,
the exact policy/evaluator/scan-manifest hashes and observed image identity.
Its unchanged raw counts are UNKNOWN 1, LOW 363, MEDIUM 561, HIGH 177 and
CRITICAL 5. No policy approval was recorded by that historical proposed-state execution.

The regression suite uses the retained original raw report and clearly marked
synthetic proof envelopes to test rejection of new/changed/missing/duplicate
CVEs, all advisory fields, altered image identity, scanner fingerprints,
package/source/epoch/PURL/repository changes, metadata and inventory mismatch,
file bytes/sizes/layers, unsupported schemas, malformed JSON, stale databases,
observation timing, approval changes, expiry and output aliasing.

One integration regression invokes the **actual pinned payload verifier** on a
generated OCI containing 990 explicitly synthetic files, then feeds its result
directly to the evaluator without translating the proof schema. A matching
payload reaches `BLOCKED_REVIEW` with all 182 proposed decisions and all raw
blockers intact. Changing one byte causes the helper to return `MISMATCH` and
the evaluator to return `BLOCKED_EVIDENCE`. Only the test observation clock is
fixed; byte comparison, OCI reading, ownership and metadata matching execute
normally. Temporary synthetic manifest/review bindings are confined to the
test fixture and never become a repository approval or an official-package
claim.

```sh
python3 -m unittest discover -s scripts -p '*image*test.py'
```

The actual runtime-image proof remains a required artifact for each evaluated
image; the observed run does not verify a later rebuild. Unit and synthetic
OCI tests cannot prove the application image's installed bytes. Original
scanner reports remain available regardless of eventual applicability decisions. The official `.deb`
was retrieved over Ubuntu HTTPS, with independent byte/control reproduction;
separate repository-signature verification was not performed. Neither this
policy nor its tests inspect the deployment host kernel or perform sandbox
escape testing.
