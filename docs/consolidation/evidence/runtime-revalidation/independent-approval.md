# Independent Runtime policy revalidation review

**Decision: approved for scoped policy activation. PR readiness remains pending a new successful full CI run.**

Reviewer: `/root/recovery_qa`, separate from proposal author `/root/security_infra`. Reviewed at 2026-11-17 00:07:36 UTC. This receipt is an independent agent review, not a human GitHub approval. I authored no product or policy change and performed no GitHub mutation.

## Exact subject

| Binding | Value |
|---|---|
| Remote immutable proposed commit | `05e98f7fb25a8eba7ff233872007387fa6a272b0` |
| Equivalent local proposed commit | `2af7018855f4f374314f851afbf851644b23794c` |
| Tree | `78823c96529351b8100dfaa037175f555ed85542` |
| Parent | `9823070e8dfbf978b6e40394aaaa78ca09a909d5` |
| Authored policy content SHA256 | `4cf9be9773cd0d5f95773edd0e75552608839b512854ab10a8faea4d09ccdb0c` |
| Proposed policy file SHA256 | `8a69704ce8de75e0eb7cd068e21c0f00aeb8b36ec914a830e82383c0cce602ff` |
| Unchanged expiry | `2026-11-30T00:00:00Z` |

I fetched the remote Git object directly, checked its parent and tree, and confirmed an empty tree diff from the independently reviewed local proposal. The proposal changes only the active policy and adds 21 files under the consolidation revalidation evidence directory. All pre-existing application, workflow, scanner, evaluator, tests and historical evidence bytes remain unchanged.

## Evidence and reasoning

The first consolidation run, 43982539575, correctly failed on fresh advisory drift. Its exact original Runtime ZIP, raw scan and inherited active policy are preserved. Independent replay at the recorded observation time reproduced the complete failed evaluation exactly, including zero partial decisions and all 182 remaining blocking findings.

I recomputed the normalized comparison across all 1,106 finding records. No key was added or removed. Forty-seven advisory records changed; 13 belong to the reviewed cohort. All 13 changed References, and three also changed Rocky VendorSeverity. The 182 CVE IDs, their Ubuntu scanner severities and exact package version remain unchanged. Raw counts remain UNKNOWN 1, LOW 363, MEDIUM 560, HIGH 177 and CRITICAL 5.

I verified all 27 file/hash bindings. All 182 fresh CNA byte hashes and exact affected source mappings match the inherited primary evidence. I separately fetched two current CNA records from GitHub at immutable commit 348e57515f801e770a266938ade34279efd0d827 and verified both raw SHA256 and Git blob identity. Twelve original Rocky publisher records cover exactly the 13 changed reviewed CVEs and describe Rocky Linux 8 kernel package advisories; their vendor batch severities do not reclassify the Ubuntu scanner findings.

The 990-file payload proof matches every expected installed path, byte hash and size. The 181 mappings with no exported-header match and the one previously reviewed kernel-only UAPI overlap remain unchanged. The five critical patch reviews and one UAPI review are explicitly inherited historical assessments. No new patch review or host-kernel validation is implied.

I flagged a copied collector identity that attributed the new author collection to a historical independent role. The proposal corrects the canonical receipt to actual author /root/security_infra, retains the untouched collector output separately, and clearly states that collection is not independent approval.

Independent local execution passed all 65 image tests and 27 payload-verifier tests. The proposed policy reproduces its saved evaluation exactly: exit 2, BLOCKED_REVIEW, INDEPENDENT_POLICY_REVIEW_REQUIRED, 182 proposed decisions, zero reviewed decisions and 182 remaining blockers. The expiry, component scope, implementation hashes, fingerprint field coverage and assertions are unchanged.

## Approval boundary

I approve this immutable authored content for activation only after separate coordinator review of the same content. Activation may record the real two-party review; it must not change the approved authored content. The failed run remains a failed run. Final PR qualification requires a new full 12-job run on the actual activated HEAD, exact merge/base/tree verification, current artifacts and a final independent receipt.

This review is limited to applicability for the exact shipped linux-libc-dev 6.8.0-149.149 amd64 component and enumerated 182-CVE cohort. It does not remove raw findings, establish patched status, certify a host kernel, approve deployment, extend the expiry or cover future advisory/payload drift. Optional Docker build record publication remains held pending separate secret classification.

Machine-readable checks: [policy-proposal-review-checks.json](policy-proposal-review-checks.json), [primary-evidence-cohort-check.json](primary-evidence-cohort-check.json), [independent-primary-cna-fetch.json](independent-primary-cna-fetch.json), and [POLICY-REVALIDATION-APPROVAL.json](POLICY-REVALIDATION-APPROVAL.json). Independent test logs: [proposal-image-tests.log](proposal-image-tests.log) and [proposal-payload-tests.log](proposal-payload-tests.log).

