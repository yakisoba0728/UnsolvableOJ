# Independent archive checker review

**Approved for inclusion in the final candidate. Full PR acceptance remains blocked pending a fresh complete CI run.**

Reviewer: `/root/recovery_qa`. Fix author: `/root`. This is an independent agent review; I did not author or modify the product fix.

| Binding | Value |
|---|---|
| Reviewed immutable local commit | `062a031b948f1bb2a6a5ece535405dba9d4dfaef` |
| Tree | `48a49e1ccd9e381474f0e1efc937ffaf55279bf9` |
| Parent | `05e98f7fb25a8eba7ff233872007387fa6a272b0` |
| Changed files | `scripts/check_consolidation_evidence.py`, `scripts/check_consolidation_evidence_test.py` |

I independently reproduced the original checker failure on immutable proposal `2af7018855f4f374314f851afbf851644b23794c`. Git classified the deleted historical `runtime-independent-replay.json` and the new `proposed-evaluation.json` as an R059 rename. That hid a real historical path deletion from the checker's deletion inventory, although the original archive bytes and manifest were correct.

The fix adds `--no-renames` to historical deletion discovery and extracts its unchanged path filter into a helper. This makes accounting depend on removed paths rather than Git's similarity heuristic. Manifest completeness, original byte size, SHA256, Git blob, tree and Markdown target assertions remain intact. No archive entry, Runtime policy, scanner or application behavior changes.

I reviewed and independently executed the real temporary-Git regression: an identical new receipt is classified R100 by normal rename detection, while the fixed helper still returns both the archived path and a separate undeclared deletion. Both checker tests passed. The actual immutable repository check with `--verify-git` then passed for all **51 files, 13,205,154 original bytes and 442 local Markdown targets**. The prior failure and independent passing logs are retained.

The approval applies to this exact change and tree. Its published equivalent must retain the same source bytes, and the final integrated candidate still requires the full 12-job CI gate and exact-source final QA.

Machine-readable receipt: [ARCHIVE-CHECKER-FIX-REVIEW.json](ARCHIVE-CHECKER-FIX-REVIEW.json). Reproduction: [archive-checker-before-fix.json](archive-checker-before-fix.json) and [archive-checker-before-fix.log](archive-checker-before-fix.log). Independent verification: [archive-checker-independent-unit-after.log](archive-checker-independent-unit-after.log) and [archive-checker-independent-after.log](archive-checker-independent-after.log).

