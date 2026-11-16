# Dedicated Vibe execution transport

Baseline: Phase III `3bcba380f92bd2da8973e6c88c00cd14b03be08e`.

## Implemented boundary

`VIBE_EXECUTION_MODE` defaults to `embedded`, preserving existing local/Compose
flows and native Vibe tests. Explicit `dedicated` mode connects the API's
`VibeRunner` to a separately configured HTTPS origin using a private Node HTTPS
Agent, TLS >=1.2, verified CA and hostname, and mandatory client certificate/key.
Origin credentials, query/fragment (including empty markers), non-root paths,
backslashes, whitespace, weak/example tokens and reused application/Redis/Judge
secrets are rejected. The optional `VIBE_SANDBOX_TLS_SERVERNAME` identifies the
certificate DNS name when the transport address is an IP/private routing alias;
it is still verified, not a verification bypass.

Dedicated settings are validated at provider construction before the application
serves requests. CA/certificate/key files must be readable regular files of
1..65,536 bytes; malformed PEM or mismatched client identity fails startup.
Certificate rotation requires an API restart. Errors identify settings without
echoing their values, file paths, endpoint addresses or remote response bodies.

Every request has a restricted method/path, fixed Authorization and no redirect
following. Request and response bodies are capped at 1 MiB; streamed response
bytes are counted independently of Content-Length. Unsupported compressed
dedicated responses are rejected. The existing 45-second run deadline covers
all execution requests. Up to 16 cached artifact identifiers are validated;
cleanup uses one independent five-second deadline and at most four concurrent
HTTPS sockets. Per-run agents are destroyed after cleanup. The anonymous bearer
probe retains mTLS but omits Authorization, proving that a client certificate
alone does not grant go-judge file access. The gateway must preserve that denial.

## Operator templates and topology

The templates do not provision hosts, deploy containers or introduce a new
unscanned gateway image. They reuse `Judge/runtime/Dockerfile` and require an
operator-owned, independently approved mTLS gateway.

- API host: `Back/deploy/vibe-dedicated.compose.yaml` overlays
  `deploy/compose.yaml`, replaces the API's Vibe endpoint, mounts three read-only
  TLS identities, and removes `back` from the local sandbox network with
  `!override [app, data]` (Compose >=2.24.4).
- Dedicated execution host: `Judge/deploy/vibe/compose.yaml` runs only the
  privileged runtime on an internal Docker network with no published host port
  and no application DB/Redis/JWT/client-certificate credentials. Its shared
  Vibe bearer token is distinct from the algorithm-worker token.
- The separate gateway joins that internal network and its controlled private
  inbound network. `gateway.conf.example` documents mandatory mTLS, restricted
  paths, body/time limits, no redirects and unchanged bearer forwarding. Its
  nginx syntax and live deployment are **UNVERIFIED** until the operator validates
  the configuration with the selected approved gateway/version.

The local algorithm `judge`/`go-judge` services in the original production Compose
are not removed by the API overlay. To separate **all** submitted-code execution
from the API/data host, operators must also move algorithm execution using its
separate reviewed template and remove the obsolete local services. Moving only
that algorithm template never moved Vibe; dedicated Vibe mode explicitly covers
the API's independent execution path.

Example **configuration validation only** after preparing private configuration:

```sh
docker compose --env-file /protected/application.env \
  -f deploy/compose.yaml -f Back/deploy/vibe-dedicated.compose.yaml config --quiet
docker compose --env-file /protected/vibe-executor.env \
  -f Judge/deploy/vibe/compose.yaml config --quiet
```

No deployment command is executed by this change. Generate the Vibe token with a
cryptographic secret generator (for example 32 random bytes encoded as hex).
Provision API client key permissions for the actual API UID and exclude other
ordinary host users. Standalone Compose secrets are local file mounts, not an
encrypted secret-management service. Never render expanded secret-bearing
Compose configuration into public logs.

The gateway certificate's SAN and configured origin/identity must agree. The
gateway must require the trusted API client CA, preserve go-judge's bearer
denial, allow only the API host inbound, and allow only necessary egress. The
sandbox's internal network is an outer-service reduction in exposure, not proof
that privileged containers or the host kernel resist escape.

## Executed verification

Local 2026-11-16 checks:

- TypeScript with `--preserveSymlinks`, focused lint, and production compile pass.
- All Backend unit tests: **356 passed** across 27 files, including the 51
  focused existing Vibe/environment and new transport/configuration cases.
- `node --test Back/scripts/check-vibe-tls.mjs`: **16 passed** (one parent and
  15 subtests), zero skipped, about 5.99 seconds. It generates ephemeral CA,
  server and client identities; listens only on newly owned localhost ports;
  and deletes all temporary keys and closes sockets/servers in `finally`.
- Actual TLS checks include trusted/mismatched CA, wrong hostname, absent and
  untrusted client certificate, missing/wrong bearer, cross-origin redirect
  refusal (zero requests at the target), oversized declared/streamed bodies,
  pre-transmission request limits, stalled response cancellation, real
  VibeRunner protocol and successful/failed-run artifact cleanup. A deliberately
  stalled cleanup returned after about 5.04 seconds with a generic error.
- Both Compose inputs parse with a safe YAML loader recognizing `!override`.
  Docker Compose and nginx binaries are unavailable locally; expanded Compose
  semantics and the gateway configuration remain separately unverified.

The TLS peer in this probe is a local protocol fixture, not nginx or native
go-judge. Existing native Vibe pipeline tests continue to verify real code
execution in embedded mode. Both results are required evidence and are not
interchangeable. CI must run the explicit TLS script after building Back; no
missing-certificate or socket error is silently skipped.

## Remaining readiness limits

Actual separate host/VM placement, kernel/privileged-container isolation,
gateway software/image security, private DNS, firewall/egress enforcement,
certificate issuance/revocation/rotation, operational token secrecy and native
Vibe execution through the deployed gateway remain **UNVERIFIED**. No paid AI
call, deployment, host-escape test, production DB operation, scanner weakening
or Runtime applicability-expiry change is included. This transport improvement
does not turn the retained raw Runtime HIGH/CRITICAL findings into zero findings.
