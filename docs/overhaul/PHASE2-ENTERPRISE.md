# Phase II assessment content and start consistency

Baseline: `c8ba9712d1a29ac633519511e50428ef647edf66`. This feature applies to algorithm problems. Vibe challenge/runtime version pinning is a separate remaining concern.

## Policy and user-visible behavior

An algorithm problem is frozen when it is selected into an assessment. Selection-time binding makes the creator's reviewed statement, samples, limits and Judge data stable before the first candidate starts. A first-candidate or per-submission freeze would allow candidates to receive different content, and would leave scheduled assessment review ambiguous.

- Creating an assessment binds each selected problem's current immutable version.
- An ordinary edit retains the versions of unchanged selections, including their new order. Newly selected problems bind their current version. Removing and later re-adding a problem is a new selection.
- A scheduled assessment exposes an explicit **latest version refresh** checkbox. It defaults to off. Saving with `refreshProblemVersions: true` reauthorizes and updates every selected algorithm problem before the assessment starts.
- A binding already authorized at selection remains valid if the source problem later becomes a private draft. This does not authorize selecting the draft's new version. An explicit refresh must pass current visibility/ownership checks.
- Started assessments cannot be edited or refreshed. Concurrent candidate starts take compatible shared locks; edits and deletion serialize against those starts.
- Candidate content, submission Judge inputs, and administrator rejudge all use the same bound version. Candidate responses select statement/sample/limit fields explicitly; hidden tests and editorial data are excluded.

The creator API returns `problemVersions: [{ problemId, version }]` and `problemVersionPolicy: "ON_SELECTION"`. The attempt problem response identifies its `problemVersion`. The update DTO adds the optional boolean above. The edit form explains retention versus refresh, and requires an intentional save.

## Database and migration

Migration `1795800000000` adds `enterprise_problem_versions` with assessment/problem primary key, unique assessment/position, position bounds, and a composite foreign key to the immutable problem version. Assessment deletion cascades its bindings. Referenced immutable versions cannot be deleted. The reverse index supports that reference lookup.

Existing assessments bind the current version **at migration time**, in their stored problem order. The migration cannot reconstruct a historical whole-assessment version that was never recorded. Historical submission versions remain untouched. Missing problem or immutable-version references abort the transaction; they are not silently dropped or replaced. Vibe-only assessments have no algorithm bindings. Rollback removes this new relation and returns to mutable assessment behavior; no production migration was run.

## Concurrency and authorization

Start first takes an active-user shared lock and verifies deletion, suspension, forced password change and token version. It then locks the selected assessment and re-reads invitation policy. This matches account-withdrawal lock order. The insertion uses one materialized `clock_timestamp()` value for eligibility, start and deadline calculation, after the locks have been acquired.

The edit path locks the assessment ID in one statement and reads the assessment/binding projection in a subsequent statement. A single `SELECT ... FOR UPDATE` can refresh the locked parent row after waiting while a correlated aggregate retains its older statement snapshot. Separating those statements prevents an ordinary save from reverting another editor's newly refreshed bindings.

## Independent review found real defects

The first candidate (`069fe62`) was not published as a verified change. An independent reviewer authored two PostgreSQL/API races and reproduced both failures:

1. A waiting ordinary save reverted a concurrent version refresh from v2 to v1.
2. Start versus withdrawal formed a user/test lock cycle and returned HTTP 500 after PostgreSQL deadlock detection.

Candidate `472d2ee` corrected both. The exact same independently authored races passed 2/2, and the author's version/concurrency/migration cases passed 12/12 in another disposable database. The reviewer also checked sample-only projection, current authorization for explicit refresh, retained-binding provenance, and migration FK/rollback behavior.

Independent frontend review subsequently reproduced a same-login token refresh unmounting the edit form and losing an unsaved draft. That correction and its exact verification are tracked with the frontend ownership changes; a successful backend review does not certify that frontend behavior.

## Actual verification checkpoint

Local environment: Linux x86-64, Node24.22.1/npm11.9.0, owned temporary PostgreSQL17.11 and Redis8.10.3 on random loopback ports. No existing database/Redis data or production resource was used.

| Evidence | Observed result |
|---|---|
| New feature regressions against original source | Three semantic cases failed: mutable candidate content and absent version/refresh metadata |
| Start eligibility races against original source | Two selected actual API cases on baselinec8 both returned201 after the held lock, instead of404 for revoked invitation and409 for expired deadline; corrected cases pass |
| Independent lock-order/snapshot races | First candidate 2/2 failed; corrected candidate 2/2 passed |
| Version/start/visibility/rejudge regressions | 9/9 passed |
| Permanent migration fixtures | 3/3 passed: ordered cutoff/history, missing problem refusal, missing version refusal |
| Independent migration experiment | Ordered binding, Vibe-only empty set, history preservation, FK RESTRICT/CASCADE and transactional refusal passed |
| Back lint/types/unit/build | 296 unit cases passed; assertions retained |
| Full API after security integration and fixture correction | 191/191 in 31 files, 85.64 s; TypeORM1.1.3 |
| Combined with bookmarks and enterprise frontend ownership | 199/199 API in32files,83.39s; Back299unit and Frontcheck passed; independent combined frontend build/policy/ReactDOM probes passed at9b2195f |
| Browser cases | Implemented/typechecked; actual current-head execution belongs to Actions |
| Integration and exact-head CI | Recorded after actual completion in PHASE2-PROGRESS / GitHub; not inferred from this local checkpoint |

The first full API run after adding migration/withdrawal fixtures exposed two test-isolation errors: the legacy ranking test counted deleted users, and the migration fixture included synthetic assessments from other files. The ranking case now creates an explicit high-XP deleted user and asserts exclusion while counting the public population. The migration case clears other assessment fixtures only inside a rollback-only transaction. No product assertion, timeout or gate was weakened. The corrected full run passed as recorded above.

Production-sized migration lock duration, old/new deployment overlap, Vibe assessment version parity, and dedicated-host operations remain unmeasured. Code integration readiness and deployment readiness are separate decisions.

## Submission-detail title boundary follow-up

Review of the real browser flow found a separate API projection error: the
assessment view and Judge used the bound version, but `GET /submissions/:id`
still derived the problem title from the mutable current problem relation.
An actual disposable API regression against `b8b8a6d` reproduced a queued
version-1 assessment submission returning a later private version's title.
This is a metadata disclosure/correctness defect, not evidence of hidden test
case or editorial disclosure.

Assessment detail now reads its submitted immutable snapshot even when the
Judge has not yet returned debug output, and uses the snapshot title in the
small existing problem projection. Sample reconstruction reuses that same
read. Missing/incomplete assessment snapshots fail closed with HTTP 503; the
current title is never a fallback. Normal submissions retain their existing
behavior. The canonical slug is not editable through the problem API and is
not a field in historical snapshots, so no fabricated versioned slug is used.
Authorization runs before the snapshot read, and no snapshot object is spread
into the response.

The new actual API case checks queued and judged states for candidate and
assessment owner, outsider 404, sample-only data, no later private title/body
or hidden/editorial data, and exclusion from the public learning list. Three
units check queued metadata and both missing and incomplete snapshot cases.
Back lint/types/build and 320 units pass; the focused real API run passes all
22 cases across four files, including prior version, submission-concurrency
and judging-core regressions. The first implementation check caught two
TypeScript errors in the test parameterization/response union; these were
corrected before any success claim or publication.

Reproduction and passing-run logs:
[before](evidence/enterprise-submission-metadata-before.log),
[after](evidence/enterprise-submission-metadata-after.log).
Independent source review and the full combined live browser/Judge CI remain
separate required gates.
