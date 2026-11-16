# Audit subjects and independent review

These are actual reports from six distinct role agents. At most three workers
ran concurrently. Reports preserve their own checkpoints and local commit IDs;
they are not final exact-source CI acceptance or human GitHub approvals.

| Actual role | Report | Contribution / independent boundary |
|---|---|---|
| Recovery/Independent QA | [RECOVERY-QA.md](RECOVERY-QA.md) | Live recovery and historical source, logs, artifact digests; separate final-source QA follows the new run |
| Frontend/UX | [FRONTEND.md](FRONTEND.md) | Route/module inventory and authored community/Settings corrections; independently reviewed by Performance |
| Backend/DB | [BACKEND.md](BACKEND.md) | Authored submission/community actor fences and real-DB fixtures; independently reviewed by Security |
| Judge/Vibe | [JUDGE-VIBE.md](JUDGE-VIBE.md) | Cleanup, actual-principal admission and staff-target withdrawal; independently reviewed by Security |
| Security/Infra | [SECURITY-INFRA.md](SECURITY-INFRA.md) | Source, infrastructure, six dependency audits, actor/cleanup review and evidence/policy preservation |
| Performance/Testing | [PERFORMANCE.md](PERFORMANCE.md) | Independent Front review, controlled measurements and authored Vibe screen fix; that new fix was separately reviewed by coordinator |

The coordinator read Vibe patch `5d5e94d123a8f9d8bc1da97ef1bc7eea0acbcd58`,
checked the shared login/mount/navigation guard and native regression assertions,
and independently ran all six actual-component DOM cases successfully. Normal and
same-login-refresh navigation were positive controls; account replacement,
same-user new login, logout and leaving the route closed only the old owned popup.
The first coordinator invocation failed on a wrong jsdom directory before any
assertion; its log and the corrected run are retained in the evidence archive.
This supports integration, while actual native browser execution remains a CI gate.

## Local patch identities and published equivalents

The connected GitHub commit API assigned different commit metadata. Each published
tree was checked against the exact expected local integration tree before moving
the branch with a non-forced expected-head lease. The following map identifies
reviewed patch subjects; it does not claim the isolated workers' entire repository
trees equal the final combined tree.

| Authored local patch | Published commit | Purpose |
|---|---|---|
| `1effe5e18b75a8032190bdb10a1663acd7c9cadd` | `c40e85e06c14ca748ffb956e60c5c51a2993d0a1` | Submission actor fence |
| `c4e17084ca1b33bb13e546ce69695733fb1fd490` | `02a290f860676c1d194dda5895f4e434c5fccb5c` | Shared helper / community fence |
| `368e5e1ec0871e82a857eb2ba9f64081771ad6c9` | `217dff2054e64b125807d666ccff4a601cef9cd7` | API fixture typing |
| `6d7919c183704f0af73f14762a3a2486c5820023` | `6bc4a2c2ec3a9b39e405e80b4b4c685ca5c18114` | Community request ownership |
| `7d15a11216f4170181d29f66eab9ddd30a348349` | `19c8a0dba6c2735f78b713af89f8c01dd8efd7e6` | Settings mutation ownership |
| `cd9e227efe32a740f2bbf07761efe55471c39728` | `7cb67bd20f057e91891512ec8b40671ef601250e` | Vibe cleanup |
| `8fc306548afd59ce404c00c3c5b12a6b9a67a1f1` | `c58342199c2b592c537ca3802e047b6d6760b87c` | Vibe actual actor |
| `5d5e94d123a8f9d8bc1da97ef1bc7eea0acbcd58` | `85aa294ff79176744dc67a6bbb47849133ffee4d` | Vibe screen completion |
| `e3190344c897d23938443fe052f790809e7b3776` | `f56df2cf898f994f2205ab336ef988ba8d1fdafc` | Staff-target withdrawal |

Raw report paths in worker reports are relative to their recorded scratch session.
They are retained after scanning on the final evidence-only Git branch linked by
the final PR receipt. Recovery observations predate this new branch; their earlier
absence of a consolidation PR and CI-selection finding are historical checkpoints,
not contradictions of the later implemented state.
