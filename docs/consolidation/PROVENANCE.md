# Source and contribution provenance

## Immutable integration baseline

| Role | Commit | Tree / relation |
|---|---|---|
| Live main at recovery | `6176015b63a1615cc2269172f246725ef08abab3` | Parent of the consolidation baseline |
| Phase I–III / [PR63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63) | `3bcba380f92bd2da8973e6c88c00cd14b03be08e` | Ancestor of Phase IV |
| Phase IV / [PR86](https://github.com/yakisoba0728/UnsolvableOJ/pull/86) | `d0159b1f844bf0608415dded9e84af566c8e2041` | Ancestor of Phase V |
| Phase V / [PR92](https://github.com/yakisoba0728/UnsolvableOJ/pull/92) | `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5` | `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` |
| [Consolidation baseline](https://github.com/yakisoba0728/UnsolvableOJ/commit/c3367954cf55584d3007ebe33c1c13aa9d6eed70) | `c3367954cf55584d3007ebe33c1c13aa9d6eed70` | Identical complete Phase V tree, direct main parent |
| Historical final receipts | `752fbdb68f6216ccd85003c77e71d1429689c015` | [Immutable archive](https://github.com/yakisoba0728/UnsolvableOJ/tree/752fbdb68f6216ccd85003c77e71d1429689c015/docs/overhaul/phase5) |

The local `git merge --squash` result and the published baseline have identical
trees. The connected GitHub commit API assigned the published commit's authoring
metadata; local temporary commit IDs are not published source acceptance IDs.
The original 116 commits and their authors, parent links, reviews, discussion and
contribution records remain reachable through the unchanged source branches and
[original history](https://github.com/yakisoba0728/UnsolvableOJ/commits/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/).
No original history was rewritten or deleted. No main rollback was needed.

Initial main-to-Phase-V diff: **711 files, 283,950 inserted lines, 1,496 deleted
lines**. GitHub compare confirms 116 ahead / 0 behind, but its 300-file response is
incomplete; local Git objects establish complete preservation.

## Reproduce preservation checks

```sh
git merge-base --is-ancestor 6176015b63a1615cc2269172f246725ef08abab3 3bcba380f92bd2da8973e6c88c00cd14b03be08e
git merge-base --is-ancestor 3bcba380f92bd2da8973e6c88c00cd14b03be08e d0159b1f844bf0608415dded9e84af566c8e2041
git merge-base --is-ancestor d0159b1f844bf0608415dded9e84af566c8e2041 e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5
git diff --exit-code e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5 c3367954cf55584d3007ebe33c1c13aa9d6eed70
git rev-list --left-right --count 6176015b63a1615cc2269172f246725ef08abab3...e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5
```

## Acceptance binding

The final source HEAD, current main base, Actions merge checkout, both checkout
parents, complete tree, run attempt, jobs and independent reviewers must be recorded
in a post-run PR receipt. This file cannot bind its own future commit. Later source
or base changes require new qualification. Historical AI review receipts are not
human GitHub approvals; recovery observed no formal submitted reviews on the three
original PRs.
