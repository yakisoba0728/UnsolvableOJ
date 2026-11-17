# Finite Runtime policy activation

The coordinator and independent QA approved the immutable author proposal
[`05e98f7fb25a8eba7ff233872007387fa6a272b0`](https://github.com/yakisoba0728/UnsolvableOJ/commit/05e98f7fb25a8eba7ff233872007387fa6a272b0),
tree `78823c96529351b8100dfaa037175f555ed85542`, authored content SHA256
`4cf9be9773cd0d5f95773edd0e75552608839b512854ab10a8faea4d09ccdb0c`.
The active policy differs from the retained proposal only in its actual review
metadata. The author `/root/security_infra` did not approve its own proposal.

- [Independent approval](independent-approval.md) and [machine-readable checks](policy-proposal-review-checks.json) verify all27 evidence bindings, the unchanged182-member cohort, all fresh CNA hashes/source mappings,12 publisher records, unchanged990-file payload manifest and unchanged evaluator/scanner/normalization/assertions.
- [Coordinator approval](coordinator-policy-review.json) independently checks the immutable tree/content, scope/expiry, still-blocked proposed replay, four key CNA records and four official Rocky publisher API records. [Primary retrieval verification](coordinator-primary-verification.json) preserves exact URLs and response hashes. Full raw responses are retained in the final evidence-only archive.
- Both reviewers are AI engineering agents. These records are not human GitHub approval, production authorization, or overall PR acceptance.

The expiry remains **2026-11-30T00:00:00Z**. The new baseline keeps all raw findings,
including177 HIGH and5 CRITICAL. The13 changed records have reference updates;
three also change Rocky vendor severity metadata. All182 Linux CNA bytes and
affected-source maps are unchanged. Vendor batch advisories do not reclassify the
Ubuntu scan or demonstrate host kernel safety. Any subsequent field/CVE/payload
drift remains subject to the unchanged blocking gate.

The first qualification run43982539575 remains a failed run: ten jobs succeeded,
Runtime failed correctly, and CI required failed. Its native, pipeline, Compose,
database and browser successes do not turn that run into an accepted run. A new
full12-job execution on the final source, followed by independent exact-source QA,
is required. The final PR receipt records that later disposition without rewriting
the original failed evidence.

The [proposal README](README.md), [proposed policy](proposed-policy.json) and
[proposed blocked evaluation](proposed-evaluation.json) describe the earlier
unapproved checkpoint. They remain intact so approval cannot be inferred before
the separate review occurred.
