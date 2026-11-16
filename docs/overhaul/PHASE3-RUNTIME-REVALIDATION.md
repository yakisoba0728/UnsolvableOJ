# Phase III Runtime advisory revalidation

## Author proposal checkpoint — 2026-11-16

This checkpoint is an **unapproved, exact-component revalidation proposal** based
on integration commit `87cc1e724f3c5bba8ee4a1d3e138c16a18202f02`. The archived
proposal and the active policy at this checkpoint are `PROPOSED`; their approval
records are empty. Separate independent-reviewer and coordinator decisions must
name the immutable proposal commit and its exact policy content before the
active policy can become `REVIEWED`. The archived proposal remains unchanged.

The proposal content SHA256 is
`99ec18c22bc108759734494755fe4241a36c447949309881f15c01bec5d632db`.
The expiration remains **2026-11-30 00:00:00 UTC**. Neither a new baseline nor an
eventual approval extends that deadline.

No evaluator, scanner, payload verifier, image gate, runtime image, package,
dependency, workflow, or production configuration is changed by this proposal.
The implementation change is limited to preserving a historical negative test
fixture and adding evidence/replay regressions. The active policy receives new
explicit baseline/evidence bindings, with the original policy retained intact.

## Why the new run correctly failed

| Evidence | Previously accepted run | Newly blocked run |
| --- | --- | --- |
| Actions run | [43822819719](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43822819719) | [43823181757](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43823181757) |
| Artifact ID | `14205173095` | `14205174564` |
| Scan source commit | `257e795ca89f1c1a425ed54d8150db009c65a65b` | `9e4ce9df2aa4338a99a8deb7f32e161458a39a04` |
| Vulnerability DB updated | `2026-11-16T01:11:02.624123452Z` | `2026-11-16T07:10:39.763774809Z` |
| DB SHA256 | `dcbd479f6de2e82a0d1588afe354c12456dcacd4b8f6128e2046ae0623a67f87` | `7dd09bed2ea9b56f9f6dcf8176bfcaca32cb02319b401e0f453175c3664b4c30` |
| Gate | `PASS_WITH_REVIEWED_COMPONENT_FINDINGS` | `BLOCKED_FINDINGS` |

The two downloaded ZIPs match the SHA256 digests supplied by the coordinator
from GitHub Actions artifact metadata. They are preserved byte for byte in
`measurements/phase3-runtime-advisory-revalidation/`. Their original raw reports,
scan manifests, scanner/DB identities, payload proofs, and old-policy evaluation
results have not been rewritten.

Both scans contain the same 1,107 finding keys and the same 225 normalized
installed-package records. Raw counts are unchanged: **UNKNOWN 1, LOW 363,
MEDIUM 561, HIGH 177, CRITICAL 5**. The actual package payload proofs each match
all 990 expected package-owned regular files.

There are **55 changed finding records**: HIGH 14, CRITICAL 2, MEDIUM 30, LOW 9.
All 55 change `References`; five also change `VendorSeverity`. The full delta is
retained in `evidence/phase3-runtime-advisory-delta.json`.

Within the existing **182-CVE reviewed cohort**, 16 advisory hashes changed and
166 are identical. All 16 change AlmaLinux/Red Hat references; only three also
change `VendorSeverity.alma`: `CVE-2025-39933` changes 2 to 3,
`CVE-2025-40170` changes 3 to 2, and `CVE-2026-97493` changes 3 to 2. Within this
cohort, no other normalized advisory field changes. Ubuntu severity, scanner
severity, CVSS, descriptions, status, package versions, and source identity are
unchanged.

The unchanged evaluator hashes every advisory field except separately verified
image-derived identity fields. It correctly produced 16
`SCANNER_ADVISORY_CHANGED_REVIEW_REQUIRED` entries and
`EXACT_CVE_COHORT_REVALIDATION_REQUIRED`, withholding all 182 component decisions.
Unchanged counts or payload bytes cannot authorize advisory drift. No claim is
made about the upstream DB-generation cause beyond the observed data changes.

## Fresh primary-source assessment and inherited proofs

The author resolved and pinned the current CVEProject snapshot to
`c9b6728130cbd7112b213130bbb14c9fed46fe5e`. The unchanged bounded inventory collector
fetched all 182 Linux CNA records. Its first 180-second attempt completed 120
records; a recorded resume fetched the remaining 62 from the same immutable
snapshot and same input report. Final unknown count is zero.

Every current raw CNA SHA256 and source-path/UAPI mapping exactly matches the
original Phase II inventory: 181 ordinary source-path cases and the same one
special UAPI case, `CVE-2026-80668`. An independent collector separately fetched
and retained all 182 raw JSON bodies. The author checked every archived body
against the independently generated receipt and the author's fresh inventory.
The raw archive SHA256 is
`54c6826a9e0b1453dbf8e99ddf68f644edd519af3829d8106fc719bc3aa7e89c`.

The original 182 component assessments, five CRITICAL patch reviews, and special
UAPI patch review are preserved verbatim as JSON values in the new manual review.
These are **inherited reviews**, supported by fresh source-byte equality and the
retained current 990-file payload proof. This proposal does not claim 182 new
manual patch reviews or a locally repeated OCI payload extraction.

The author and independent reviewer each read the 14 newly selected AlmaLinux
advisories and the two changed CRITICAL Ubuntu advisories. The vendor pages
describe the same kernel implementation issues; their advisory-level severity
values explain the three Alma severity changes. This supports retaining the
narrow header-package code-absence assessment; it does not lower Ubuntu
severity or establish a fixed Ubuntu version. Exact URLs and per-CVE assessment
are recorded in both vendor-review evidence files. These files retain factual
review records, not raw HTML, and do not claim HTML content hashes.

Ubuntu's [CVE-2026-64523](https://ubuntu.com/security/CVE-2026-64523) and
[CVE-2026-68426](https://ubuntu.com/security/CVE-2026-68426) pages still describe
Noble `linux` as vulnerable, with work in progress for `6.8.0-151.151`.
**Host kernel readiness remains UNVERIFIED.** A privileged executor shares its
host kernel; verified network transport and a separate executor deployment
design do not establish that kernel's patch state or VM isolation.

## Exact binding mechanics

| Bound material | Purpose |
| --- | --- |
| `phase3-runtime-advisory-revalidation-original-policy.json` | Original policy bytes, including original approval history, preserved with SHA256 `77fcae5ce3d800b1b6289de7a7e84a2ee6364867ec13b321346520075ddd3b73`. |
| `phase3-kernel-header-applicability.json` | Fresh 182-record CNA inventory tied to the blocked raw scan, its image identity, and immutable CNA snapshot. |
| `phase3-kernel-header-review.json` | Inherited exact component proofs plus fresh source/vendor review and hashes of all additional provenance. |
| `blocked-runtime.zip` | Unmodified new baseline artifact, including all raw findings and its original failed evaluation. |
| Original 990-file manifest and scanner-identity evidence | Retained unchanged; no broader package or scanner scope. |
| `phase3-runtime-advisory-revalidation-proposed-policy.json` | Immutable authored proposal with empty approval records; exact copy of the active policy at this checkpoint. |

The new active policy still uses the same schema, fingerprint algorithm, five
top-level evidence bindings, implementation pins, 182 CVE IDs, package/version,
platform, file count, and expiration. Each of its 182 advisory hashes and raw
scanner fingerprints is tied to the untouched new baseline. Directly substituting
hashes while keeping the old baseline would fail the existing evaluator.

Additional source archives, before/after data, collector source, original policy,
and author/independent source receipts are hash-bound inside the bound manual
review. Dedicated regression checks verify this additional provenance. The
runtime evaluator continues consuming its existing five evidence files; its
behavior and required checks are unchanged.

The 39 changed LOW/MEDIUM records receive no new exception. New IDs, additional
advisory drift, any package/source/payload mismatch, malformed evidence, missing
independent approval, or expiration continue to block under the existing rules.

## Verification and approval boundary

The retained-artifact evaluation at `2026-11-16T07:48:07.724865+00:00` returned:

- Exit code 2, `BLOCKED_REVIEW`.
- `INDEPENDENT_POLICY_REVIEW_REQUIRED`.
- 182 proposed component decisions, zero reviewed decisions.
- All 182 HIGH/CRITICAL findings still blocking, with no unresolved source/cohort
  mismatch under the explicitly proposed new baseline.

This is a policy evaluation against already retained image evidence, not a new
Docker build or scan. The result is preserved as
`measurements/phase3-runtime-advisory-revalidation/proposed-evaluation.json`.

The regression suite preserves its existing advisory-field, tampering, expiry,
ownership, file-payload, and approval denials. Its original four-unrelated-HIGH
test now explicitly injects those same four retained Phase II findings into a
temporary synthetic current-image fixture; the same four package/count
assertions remain. New regressions replay the actual old-policy failure, prove
the fresh proposal cannot approve itself, verify the additional evidence chain,
and compare all 182 retained CNA bodies to both inventories and the receipt.

Run the complete repository script suite with:

```sh
python3 -m unittest discover -s scripts -p '*_test.py'
```

The authored proposal passed **92 script tests in 46.425 seconds**. The local
receipt records the tested policy and test-source hashes; the immutable proposal
commit is recorded in the author handoff. No approval metadata is fabricated by
those tests. After the two
separate review records are provided, the coordinator may update only the active
policy's review metadata to match the reviewed content, publish the feature PR,
and require fresh CI at its exact HEAD and subsequent integration HEAD. Prior
green runs do not replace that validation. The main-target PR remains unmerged.
