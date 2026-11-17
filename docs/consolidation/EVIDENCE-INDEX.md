# Evidence index

## Reading order and authority

Start with [PROGRESS.md](PROGRESS.md), [PROVENANCE.md](PROVENANCE.md), and the final
PR's newest acceptance receipt. Historical phase reports describe their own
checkpoints; their old stacked merge order and completion wording are not current
consolidation instructions. A successful historical run does not qualify a new
source commit.

| Evidence | Durable source | Meaning |
|---|---|---|
| Phase I–V original complete source and reports | [e1bbab81](https://github.com/yakisoba0728/UnsolvableOJ/tree/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5) | Every original file, authoring commit and failure history remains reachable |
| Phase V final receipts and actual run43913852145 | [752fbdb6 archive](https://github.com/yakisoba0728/UnsolvableOJ/tree/752fbdb68f6216ccd85003c77e71d1429689c015/docs/overhaul/phase5) | Post-source logs, original ZIPs, checksums and independent historical acceptance |
| Historical final numerical addendum | [FINAL-RUN-PERFORMANCE.md](https://github.com/yakisoba0728/UnsolvableOJ/blob/752fbdb68f6216ccd85003c77e71d1429689c015/docs/overhaul/phase5/FINAL-RUN-PERFORMANCE.md) | Separate final-run metrics, including regressions; not a new benchmark |
| Relocated raw data | [archived-evidence.json](archived-evidence.json) | Per-file SHA256, byte length, Git blob, immutable source/tree and recorded execution provenance |
| Original phase acceptance ledger | [validation-ledger.json](../overhaul/phase5/evidence/validation-ledger.json) | Exact feature sources/runs and failed or superseded attempts |
| Active Runtime decision | [policy](../../scripts/image-applicability-policy.json) | Exact applicability, original raw findings and fixed expiry; does not certify a host kernel |
| Consolidation Runtime metadata drift | [finite revalidation and activation](evidence/runtime-revalidation/ACTIVATION.md) | Original failed run, exact previous policy,13 changed records, fresh182-CNA/12-publisher review and separate approvals; no scope/expiry/gate relaxation |
| Historical performance arithmetic | [offline verifier](../overhaul/phase5/evidence/performance/verify-performance.py) | Complete inputs remain local; verifies recorded arithmetic rather than rerunning services |

## Selective cleanup

The consolidation removes **51 duplicated historical raw files, 13,205,154 bytes
and 66,151 text lines** from the active review tree. Each removed file was compared
byte-for-byte with the unchanged immutable original before removal. Twenty-two
Markdown links were changed to exact-commit URLs. Historical JSON manifests remain
unchanged: resolve their paths in their original commit, not by silently replacing
their hashes with current data.

Current policy inputs, old security-policy replay inputs, before-image ZIP test
fixtures, reproduction scripts, all review receipts and the complete offline
performance verifier input set remain in the checkout. The historical final
archive was independently rechecked: 268 files / 27,411,431 bytes, all 12 job-log
byte streams / 1,595,099 bytes, and 15 original artifact ZIP digests matched.
These counts describe separate sets and must not be added as unique evidence.

No adverse timing, prior failure or unresolved external gate is erased by this
cleanup. GitHub Actions artifact expiry is not the retention mechanism: original
Git blobs and SHA256 digests remain available independently of those URLs.

## Reproduce the archive and link checks

```sh
git fetch --no-tags --depth=1 origin e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5
python3 -m unittest discover -s scripts -p 'check_consolidation_evidence_test.py'
python3 scripts/check_consolidation_evidence.py --verify-git
python3 docs/overhaul/phase5/evidence/performance/verify-performance.py
```

The first verifier authenticates all relocated bytes/Git blobs, checks the complete
historical-deletion set and validates local Markdown targets. It runs in the
existing Backend CI job. The performance verifier preserves its own source-binding
report and can correctly report that later source files no longer match a historical
measurement; that observation is not a failed historical hash or a current speedup.

To inspect an individual original without changing the checkout, use
`git show e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5:<path>` for a path in the manifest.
For a full historical reproduction, create an isolated worktree at that commit.
Do not restore archived data into current security-policy inputs or change the
current branch's source simply to reproduce an old benchmark.

The final consolidation run's own raw logs, artifacts, checksums, source binding,
independent reviews and adverse outcomes will be retained on a separate evidence
branch linked from the final PR receipt. That post-run archive must not move the
tested release source or create another review PR.

## Archive checker regression review

The [independent review and original before/after logs](audits/archive-checker/ARCHIVE-CHECKER-FIX-REVIEW.md) cover historical deletion accounting under Git rename detection. Published commit `251c7d0db091e147349ad39a93bba1dbb6d028b4` has the exact reviewed tree `48a49e1ccd9e381474f0e1efc937ffaf55279bf9`.
