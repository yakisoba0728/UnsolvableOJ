# Phase V browser through dedicated Vibe transport

## Actual accepted execution

The connected path completed in accepted PR90 full run [43893025800](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43893025800), source `1583ee1c5f30310b37c02d30d53fb9226f776f19`, checkout `af29ece67e20e06b0cce453434b482cc5215d4f6`, tree `8a5843db4feba7ba619159731f62d4d824369520`. All12 jobs succeeded; the actual Compose suite completed4/4 cases. PR89 subsequently re-executed the connected path successfully at source49a367/treec90c955 in run43901468081. The final whole-tree receipt separately binds the final integration run.

The actual browser performs signup, opens the Vibe editor in another tab, edits and autosaves the real file, switches files, executes public checks, submits the final native assessment, reloads persisted results and verifies readonly source and outsider404. There are **zero browser API route mocks and zero paid provider calls** in this flow. This is distinct from the mocked-backend editor-performance observation.

At the accepted PR90 observation, six public checks succeeded and the persisted final report recorded11/11 functional checks and40/40 functional points. Paid evaluation was unavailable as configured, owner/version/source equality survived reload, and page errors were zero. Public execution took405.35ms and final submit831.09ms in that single observation; those are not capacity or tail-latency estimates. The main browser body was4,606.638ms. A separate61,000.66ms pre-test idle interval retained the unchanged authentication admission limit across the four sequential Compose flows.

All seven actual gateway probes passed their expected result: version200, missing client certificate400, absent/wrong bearer401, wrong hostname`ERR_TLS_CERT_ALTNAME_INVALID`, unsupported route404 and query400. Correctly mounted one-day client/server/CA material was used; the CA private key was never mounted. The final [Compose receipt](evidence/judge-run-43893025800/phase5-vibe-compose.json) reports PASS and cleanuptrue. Its nested earlier preflight snapshot precedes final cleanup; that historical snapshot is not a cleanup failure.

Original [browser JSON](evidence/judge-run-43893025800/phase5-vibe-browser.json), [screenshot](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/phase5/evidence/judge-run-43893025800/phase5-vibe-browser.png) and [ZIP](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/phase5/evidence/judge-run-43893025800/browser.zip) are retained. ZIP SHA256: `fc661ef4110307d4f904c4cee2225aa930dc35fcd8397db73340db1933159748`; browser JSON SHA256: `5be590125d64c1ffac9a8a1f9e8801b3e0a6891344af033082da92ca4b104ef3`; Compose JSON SHA256: `ca4969e982354d710b558f65f4db97e96da33eaf26d69037c8bac541657be34c`. Independent review checked exact source, actual transport artifacts, persisted grade and final removal logs.

Operational host/network separation, actual certificate rotation and paid-provider quality remain separate gates. The fixture reuses the existing isolated CI native executor sequentially; it does not create a second privileged executor or establish an independent production fault domain.

## Original implementation checkpoint and scope


This increment connects the real browser flow to the dedicated Vibe transport,
the repository's nginx gateway configuration, the existing native executor and
PostgreSQL persistence in the disposable Compose test. It changes test fixtures
and evidence collection only. Its implementation base is Judge commit
`4fbb5156e2d94a2148b49cdb42ae10ea54ffedf3` (tree
`a7807edce7904c955fc6b4bb84aecda7793218ed`). The coordinator's subsequent
immutable CI receipt determines whether this connected path has passed.

| Qualification | Status at implementation checkpoint |
|---|---|
| Fixture guard, negative plan cases, actual ephemeral certificate generation and key/hostname checks | **PASS locally: 22 tests, zero failures/skips** |
| Front live-spec TypeScript compilation and script syntax | **PASS locally** |
| Rendered Docker Compose plan, nginx startup and actual certificate mount readability in the containers | **NOT_EXECUTED locally; required CI** |
| Seven real gateway preflight probes | **NOT_EXECUTED locally; required CI** |
| Browser edit → public native run → final native assessment → persisted reload → non-owner denial | **NOT_EXECUTED locally; required CI** |
| Production dedicated host, firewall, certificate operations and paid evaluator quality | **BLOCKED_EXTERNAL_ENVIRONMENT / UNVERIFIED** |

Docker execution and browser startup are unavailable in the local workspace.
The local safety tests exercise representative plan objects and actual OpenSSL
certificates; they are not a rendered-Compose, nginx, native or browser pass.
Existing Front dependencies were reused by an uncommitted `node_modules`
symlink. No browser download or dependency installation was added.
Playwright's list-only check discovers the original three flows followed by
the new Vibe flow: four tests in four files. Local checks used Node 24.22.1
and OpenSSL 3.5.7.

## Owned fixture and transport

`scripts/check-compose.mjs --production` retains the existing seven services
and adds one small, unprivileged nginx gateway. The gateway uses the **same
actual image ID as the built Front service**; the script checks that identity
after startup. It adds no image source or second privileged executor. Image
security qualification remains the existing mandatory CI image gate.

The API joins only `app` and `data`. The gateway joins `app` and the internal
`sandbox` network. The existing go-judge service remains on `sandbox`, with the
additional DNS alias `vibe-sandbox`. The algorithm worker's networks, native
runtime configuration, cgroup policy, memory, concurrency and verdict mapping
remain unchanged. The development variant uses its existing `default`
application network and also removes the API's sandbox attachment.

The gateway configuration is copied **byte for byte** from
`Judge/deploy/vibe/gateway.conf.example`. Access logs remain off. The gateway
has no host port, a read-only root filesystem, bounded writable tmpfs mounts,
128 MiB memory, 0.25 CPU, 32 PIDs, dropped capabilities with only nginx's
CHOWN/SETGID/SETUID requirements restored, and no-new-privileges. Existing
fixture service ports remain dynamic loopback bindings. The rendered plan is
checked before any services start.

An ephemeral CA signs separate one-day server and API client certificates.
The server SAN is exactly `vibe-executor.internal`. Back receives only the CA
certificate and its own client certificate/key; nginx receives only the CA
certificate and its own server certificate/key. The CA private key is never
mounted. Mounted files are read-only and mode 0444 so the API's non-root UID
can read them; their host directory is a new owned mode-0700 temporary
directory. Its generated private material is removed in awaited cleanup.

The API receives real `VIBE_EXECUTION_MODE=dedicated` settings and an HTTPS
origin. Existing startup validation, CA checks, hostname verification, client
certificate validation and bearer forwarding all remain active. The API has
no direct sandbox network attachment. `OPENAI_API_KEY` is explicitly empty;
email delivery is disabled in this owned fixture. No provider response is
mocked, and no paid provider is called. The actual unavailable-evaluator path
must preserve the functional score.

This test reuses the existing algorithm native sandbox **sequentially**. Its
synthetic sandbox bearer therefore also authorizes Vibe execution in this
fixture. Back receives a distinct unused algorithm secret, preserving the
application's dedicated-mode secret-isolation validation. This arrangement
does not prescribe shared production credentials or certify a dedicated host.

Only literal `unsolvable-e2e-` projects with twelve lowercase hex digits and
their matching temporary-directory prefix are accepted. The test owns all
generated secrets, RAM-backed database contents and Docker resources.
`finally` waits for `compose down --volumes`, then removes the owned temporary
directory. Cleanup failure fails the command and marks its receipt failed.

## Finite protocol and success conditions

Before browser execution, seven requests originate inside the actual Back
container with a **4,000 ms deadline each**. Their raw status/error code and
elapsed duration enter the sanitized Compose receipt.

| Request | Required observation |
|---|---|
| Correct client identity, hostname and bearer; `/version` | HTTP 200 |
| No client certificate; `/version` | nginx 400/495/496 or the explicit TLS missing/bad-certificate error |
| Wrong synthetic bearer; `/file` | HTTP 401 or 403 from the native upstream |
| No bearer; `/file` | HTTP 401 or 403 from the native upstream |
| Wrong expected server hostname | `ERR_TLS_CERT_ALTNAME_INVALID` |
| Unsupported operation path | HTTP 404 |
| Query string on `/version` | HTTP 400 |

The unchanged nginx configuration forwards authorization unchanged. It does
not insert a valid upstream token, bypass mutual TLS or manufacture native
successes. A successful preflight receipt and identical gateway/Front image
IDs are prerequisites for the browser test.

The existing three live flows remain intact. Their five registrations use the
real public five-per-minute admission budget. The new final live spec waits
**61 seconds in its `beforeAll` hook**, in asynchronous intervals no larger
than one second, before its two fresh registrations. This is admission idle
time, recorded separately from execution; no Redis state, caller identity or
rate limit is changed. The existing single-worker configuration, 90-second
hook/test timeout and 15-second action timeout remain unchanged. The main
Vibe test keeps its original 90-second deadline. No editor-duration experiment
is added to that deadline.

One real Chromium trial performs these steps:

1. Sign up through the real form, open the Vibe catalog and verify runner
   availability with AI unavailable.
2. Start `post-search-v1` through the real button and continue in its actual
   new browser tab.
3. Fill the TypeScript editor with a correct bounded solution. Observe its
   real one-second autosave PATCH and persisted source, switch to the tags
   file, and switch back without losing the edit.
4. Execute one public run. Require six passed checks, zero failed checks and
   the saved source revision.
5. Confirm one final submission. Require eleven of eleven functional checks,
   outcome 40/40, unchanged challenge version, a submission timestamp,
   unavailable process evaluation and null prompt/process grades.
6. Reload the browser. Require the stored 40/40 and 11/11 result plus the exact
   source in the read-only view with no editable code textbox. Read the
   attempt again through the real authenticated API and compare the stored
   report and challenge version.
7. Register a separate outsider and require HTTP 404 for the owner's attempt.
   Require no browser page errors. Close the owned workspace tab.

No browser route interception or API/database/executor doubles participate.
The positive report records the actual public and final counts, challenge
version, restored read-only source and non-owner denial. It rejects known
private snapshot/configuration fields in the submission response. Existing
native-pipeline cleanup evidence remains separate; this browser fixture does
not add a claim of per-run cached-file instrumentation.

## Evidence, replay and interpretation

| Artifact | Contents |
|---|---|
| `Front/reports/phase5-vibe-compose.json` | Checkout/tree, PR source/base, run/attempt, tracked-tree cleanliness; template hash, certificate fingerprints, actual image ID; seven raw probe observations; fixture startup and awaited teardown status |
| `Front/reports/phase5-vibe-browser.json` | Same source/run identity, browser/version, preflight receipt, separate admission wait, public/final/main durations, one-trial assessment and ownership assertions, page-error count and limitations |
| `Front/reports/phase5-vibe-browser.png` | Successful result region only |

The nested browser preflight receipt says `PREFLIGHT_PASS` and precedes Docker
teardown. Its `cleanup` value is therefore false at capture time. The separate
Compose receipt is the authoritative final teardown result. A browser PASS
alone does not assert successful global cleanup.

The new credential-bearing spec explicitly disables Playwright tracing so
real registration passwords, session responses and bearer headers are not
retained in network traces. Passwords are generated only inside the page:
the main form receives its value through the native input setter and input
event, and the outsider uses a real same-origin registration request. Neither
passwords nor bearer values are supplied as Playwright call arguments or
returned to its reporter. Authenticated persistence/ownership checks likewise
use real same-origin requests and return only the required status/report data.
Its JSON omits credentials, private keys, account
identifiers, file contents, response bodies and arbitrary error text. Its
positive screenshot contains only the result region. The existing failure
screenshot/report behavior remains available for UI diagnosis.

Local checks, from the repository root:

```sh
node --check scripts/check-compose.mjs
node --check scripts/compose-vibe-gateway.mjs
node --test scripts/compose-vibe-gateway.test.mjs
npm run test:e2e:types --prefix Front
git diff --check
```

The safety suite includes an accepted representative plan, ownership guards,
nineteen rejected topology/credential/mount mutations and actual certificate
generation with signature, key matching, hostname, lifetime and template-byte
checks. CI must run those checks and retain the three artifacts above on
success or failure. A setup failure may precede browser-artifact creation;
the command must fail instead of inferring a successful native/browser trial.

Actual replay requires the repository's normal Docker/native prerequisites,
OpenSSL and existing Playwright Chromium installation:

```sh
node scripts/check-compose.mjs --production
```

Durations are **single-trial laboratory observations**, not a latency
distribution, speedup, capacity claim or field INP. They must retain the
admission wait separately. There is no long-duration editor memory/leak
finding. Production network/firewall enforcement, independent dedicated
hosts, certificate rotation/revocation, sustained load and evaluator quality
remain external or unverified gates after this test passes.
