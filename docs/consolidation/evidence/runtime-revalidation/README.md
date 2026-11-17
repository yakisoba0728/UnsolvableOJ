# Runtime advisory revalidation proposal

This is an **author proposal**, prepared by `/root/security_infra`. It does not authorize an exception or change the failed CI result. The policy remains `PROPOSED`, with no independent reviewer, coordinator, review timestamp or approval content hash. Its fixed expiry is **2026-11-30T00:00:00Z**.

## Observed failure and exact subject

[Actions run 43982539575](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43982539575), attempt 1, built PR head `9823070e8dfbf978b6e40394aaaa78ca09a909d5` through merge checkout `b3e3bc385aae450cf388826466bc4371ca8bbaf4`. Both identify source tree `1000f9a3b0b58ec342d19a4a5717aea8b3b0d81e`. Runtime job `133702382826` failed with `EXACT_CVE_COHORT_REVALIDATION_REQUIRED`.

The [original Runtime artifact](blocked-runtime.zip) is retained without modification: SHA256 `e9cfceecf94782787d3019442207728a1f797bd8383b09e8d4f919afcb98c045`, 1,062,577 bytes. It contains the original raw scan, manifest, logs, payload proof and failed evaluation. The raw report SHA256 is `b39c0ffd54187c8ecd5e6ec5a4c781e44a85f6636eb8a1103ce1dff2d6cf93e2`. The [inherited active policy](inherited-policy.json) is also an exact byte copy, SHA256 `81f0bf685f2ffc22cdb0933c2c55f6f5fff05f8f252765c0af8fe56189084603`. Replaying that policy against the original artifact reproduces the failed evaluation exactly at its recorded observation time.

The scan reports **UNKNOWN 1, LOW 363, MEDIUM 560, HIGH 177 and CRITICAL 5**, and scanner exit 2. The 990-file package payload proof is `MATCH`, with every path, hash and size equal to the existing official-package manifest. There are no missing, changed, nonregular or unexpected owned files. The reviewed exclusion count in the failed run is zero; all 182 HIGH/CRITICAL findings remain blocking.

The newly downloaded Trivy database has SHA256 `c4c65516369d80d1fe4a9ae8667f2721393630107d8d2277a9222def00efd19d` and update time `2026-11-16T18:50:18.311537747Z`. Trivy remains version 0.76.2. No scanner, database selection, fingerprint normalization, evaluator or assertion changes are proposed. [The machine-readable receipt](runtime-revalidation.json) binds the exact source, image digests, database, payload and original failure.

## Exact change requiring review

There are 1,106 finding records in both the previous baseline and the new scan. No finding key was added or removed. Using the existing normalized advisory fingerprint, 47 records changed: 13 in the exact reviewed cohort and 34 outside it. The full old/new field values are retained in [advisory-delta.json](advisory-delta.json); [advisory-delta-summary.json](advisory-delta-summary.json) identifies the reviewed subset and reference differences.

All 13 reviewed records changed `References`. Three also changed `VendorSeverity.rocky`. Their Ubuntu scanner severity, title, description, CVSS, installed package version and all other normalized fields are unchanged. Every member of the 182-record cohort is retained.

| CVE | Raw severity | New Rocky advisory | Additional changed field | Exact Linux CNA implementation area |
|---|---|---|---|---|
| CVE-2024-40954 | HIGH | RLSA-2024:7000 | None | `net/core/sock.c` |
| CVE-2025-39933 | HIGH | RLSA-2026:0759 | `VendorSeverity.rocky`: 2 → 3 | `fs/smb/client/smbdirect.c` |
| CVE-2025-40170 | HIGH | RLSA-2026:2264 | `VendorSeverity.rocky`: 3 → 2 | Internal `include/net/` headers and `net/core/sock.c` |
| CVE-2025-68745 | HIGH | RLSA-2026:66325 | None | `drivers/scsi/qla2xxx/` |
| CVE-2026-31692 | HIGH | RLSA-2026:49214 | None | `net/core/rtnetlink.c` |
| CVE-2026-46181 | HIGH | RLSA-2026:25121 | `VendorSeverity.rocky`: 3 → 4 | `drivers/net/ethernet/mellanox/mlx4/srq.c` |
| CVE-2026-52991 | HIGH | RLSA-2026:57253 | None | `kernel/cgroup/cgroup.c` |
| CVE-2026-63879 | HIGH | RLSA-2026:55764 | None | `drivers/gpu/drm/amd/amdgpu/amdgpu_hmm.c` |
| CVE-2026-68409 | HIGH | RLSA-2026:82807 | None | `net/mac80211/sta_info.c` |
| CVE-2026-68426 | CRITICAL | RLSA-2026:68531 | None | `net/xfrm/xfrm_device.c` |
| CVE-2026-72288 | HIGH | RLSA-2026:92209 | None | `arch/arm64/kvm/vgic/vgic.c` |
| CVE-2026-74752 | HIGH | RLSA-2026:85773 | None | Internal `include/net/sctp/auth.h`, `net/sctp/auth.c` and `net/sctp/sm_make_chunk.c` |
| CVE-2026-89631 | HIGH | RLSA-2026:85773 | None | `fs/smb/client/cifssmb.c` and `fs/smb/client/trace.h` |

The replacement reference sets include other CVEs from the same vendor batches and Bugzilla links. Those cross-links do not add new records to this policy. They remain preserved in the original scan and full delta; their unrelated CVEs have not been individually audited here.

## Primary evidence and component reasoning

All **182** Linux CNA records were freshly retrieved from immutable `CVEProject/cvelistV5` commit [`348e57515f801e770a266938ade34279efd0d827`](https://github.com/CVEProject/cvelistV5/commit/348e57515f801e770a266938ade34279efd0d827). Every raw record SHA256 and exact affected-source mapping equals the previous inventory. The deterministic raw archive is byte-identical to the [existing retained archive](../../../overhaul/measurements/phase3-runtime-advisory-revalidation/current-cna-records.zip), so it is hash-bound and reused. The [fresh retrieval receipt](current-cna-refetch-receipt.json) and [full 182-record comparison](cna-revalidation.json) preserve the request URLs, timing, byte hashes and path comparisons.

The unchanged historical collector hard-codes an `independent_recovery` identity. Its [original output](cna-collector-output.json) is retained for traceability. The canonical fresh retrieval receipt corrects author, source, role and limitation metadata to the actual proposal author. CNA bytes, response hashes, URLs, timing and retrieval results are unchanged. This collection is not independent policy approval.

The author also retrieved and reviewed all **12 distinct replacement Rocky publisher advisories**, covering all 13 changed CVEs. [Original publisher bytes](primary-vendor-records.zip), [retrieval details](vendor-retrieval.json) and the [per-advisory/per-CVE assessment](vendor-advisory-review.json) are retained. These records describe Rocky Linux 8 **kernel** package updates. The three relevant publisher summaries are Important for RLSA-2026:0759, Moderate for RLSA-2026:2264 and Critical for RLSA-2026:25121, consistent with the changed Rocky metadata. These are vendor batch-advisory severities; they do not reclassify the Ubuntu scan or establish an Ubuntu fix.

The unchanged CNA mappings still contain 181 records with no exported-header path match and one previously reviewed UAPI overlap. The 13 changed records all map to implementation files or internal kernel headers outside the installed userspace-header payload. For example, `include/net/ip.h` is an internal kernel header and is distinct from the exported `include/uapi/` tree. The prior five critical patch reviews and the special `CVE-2026-80668` kernel-only UAPI review are inherited verbatim as historical assessments. They are not represented as new patch reviews. The current payload binding separately verifies the actual 990 installed files against the same official package manifest.

These observations support proposing the same exact-component absence assessment against a newly enumerated advisory baseline. They do not establish host kernel safety, exploitability, patch installation or zero vulnerabilities. The [new inventory](kernel-header-applicability.json) and [manual review](kernel-header-review.json) explicitly preserve those boundaries.

## Proposed policy and review gate

[proposed-policy.json](proposed-policy.json) is identical to the proposed active policy file. Its authored content hash is `4cf9be9773cd0d5f95773edd0e75552608839b512854ab10a8faea4d09ccdb0c`. It changes the exact artifact, inventory and manual-review bindings, current CNA snapshot, derived image fingerprints and 13 normalized advisory hashes. The scope, all 182 CVE IDs, 990-file manifest, fingerprint schema, implementation hashes and expiry are unchanged. All existing Phase V evidence remains intact.

The unchanged evaluator produces [proposed-evaluation.json](proposed-evaluation.json): exit 2, `BLOCKED_REVIEW`, `INDEPENDENT_POLICY_REVIEW_REQUIRED`, 182 proposed decisions, zero reviewed decisions and 182 remaining blockers. No approval metadata exists in this proposal. Independent review and coordinator review must assess an immutable proposed commit before any activation. A later successful CI result, if obtained, must be recorded separately; this failed run remains a failed run.

The scope ends at exact installed image component applicability. The host kernel remains **UNVERIFIED**. The raw findings and the fixed expiry remain visible even if separate reviewers approve this finite proposal.
