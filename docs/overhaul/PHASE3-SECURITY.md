# Phase III executor transport and configuration boundary

Baseline: `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`. This document describes the
new code and observed local tests; exact-source CI, independent review and merge
receipts are maintained separately by the coordinator. No deployment or
production service was contacted.

## Confirmed gap and bounded implementation

The dedicated executor template previously provided authenticated but plaintext
Redis TCP. Its README correctly required an encrypted private/VPN transport;
the worker itself had no TLS configuration. This is a P2 deployment-hardening
gap, not evidence that a particular production connection was exposed.

The worker now supports verified Redis TLS and optional private CA/client
certificate/key files. It uses TLS 1.2 or newer, validates the peer identity and
chain, and provides no verification bypass or plaintext fallback. A dedicated
mode validates an HTTPS API URL, TLS Redis, distinct credentials of at least
32 non-whitespace characters, port/DB bounds and finite concurrency before
opening connections. Local/private same-host defaults remain available in
embedded mode. Credential length is a configuration guard, not an entropy
proof; operators must generate random secrets. No dependency or runtime
Dockerfile/package/source bytes were changed by this slice.

The dedicated template fixes that mode and has an optional three-file mTLS
overlay. Only the unprivileged worker receives its Redis identity. Both
dedicated and existing production workers use a read-only root filesystem and
a 16 MiB non-executable tmpfs for the heartbeat. The standalone preflight
validates rendered Compose networking, capability/namespace separation,
published-port and host-data exclusion, explicit worker UID/GID 1000:1000,
sandbox environment whitelist, resource budgets, TLS configuration
and approved secret mounts without displaying credentials. The existing
production configuration check calls it for the base and mTLS variants.

## Threat model and limits

| Threat / boundary | Implemented control | Remaining operational obligation |
|---|---|---|
| Network interception of queue credentials/work | Verified TLS/mTLS; wrong CA/name/client identity rejected | Provision trusted certificates, private routing, rotation and Redis ACLs |
| Accidental remote cleartext setup | Dedicated HTTPS/TLS requirement before Redis connection | The operator must actually select the dedicated template/mode |
| Accidental executor data/network exposure | Preflight rejects ports, host data/namespace mounts, application network on sandbox and extra worker capabilities | Host firewall/egress rules and actual interface reachability are unverified |
| Worker filesystem persistence | Read-only root and bounded noexec tmpfs | Actual image/native behavior must pass the new full CI |
| Host compromise via privileged go-judge/kernel | Dedicated host/VM design and limited credential placement | Privileged process can control its host; this change is not a VM escape defense or kernel attestation |
| Broader application separation | Existing API/DB are not included in the executor template | Single-host production Compose and API Vibe runtime are not migrated by this change |

The worker and sandbox share the dedicated host. Host compromise therefore
exposes the worker's API/Redis identities despite container network separation.
The executor should have no database credentials or application JWT secret;
its private egress should be limited to the approved API/Redis destinations.
Those firewall/ACL rules are a deployment requirement, not a rule installed by
this PR. No sandbox-escape experiment was attempted.

## Current advisory/source recheck, 2026-11-16

- [GO-2026-6860](https://pkg.go.dev/vuln/GO-2026-6860) still identifies the
  affected x/net/html versions as before v0.62.0. The existing runtime lock is
  v0.62.0; the Phase II patch is retained.
- [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) continues to warn against
  the deprecated OpenPGP package. The existing exact-build import-closure
  exclusion remains enforced; the raw UNKNOWN finding is not suppressed.
- [Ubuntu CVE-2026-109518](https://ubuntu.com/security/CVE-2026-109518) gives
  2.8.4ubuntu0.1 as the Noble APT fix. The retained Dockerfile asserts that
  minimum and uses the documented zero-retry bootstrap mitigation.
- Direct public GitHub advisory API lookups for `criyle/go-judge` and
  `redis/ioredis` returned empty lists. That describes published repository
  advisories only, not all dependencies or absence of vulnerabilities.

The fresh complete image scan remains a CI requirement. The previous runtime
raw result was HIGH177 / CRITICAL5; the182 exact component decisions remain
subject to unchanged evidence, package bytes, advisories and **2026-11-30
00:00 UTC** expiry. This PR does not extend that expiry, change the raw scanner,
certify future rebuilt image bytes or verify the running host kernel.

Implementation references: [ioredis TLS options](https://github.com/redis/ioredis#tls-options),
[Node TLS verification](https://nodejs.org/api/tls.html),
[Redis TLS and default client authentication](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/),
[Docker privileged-container boundary](https://docs.docker.com/reference/cli/docker/container/run/#privileged).

## Observed local validation

| Check | Result / exact scope |
|---|---|
| `npm run check --prefix Judge` | 137/137, including30 new config and actual loopback TLS endpoint cases; existing107 preserved |
| `node --test scripts/check-executor-compose.test.mjs` | 25/25, including unsafe topology mutations, root-user/secret-placement rejection and secret-safe CLI failure output |
| `python3 -m unittest discover -s Judge/runtime -p 'test_*.py'` | 5/5, unchanged runtime helper checks |
| `node Judge/scripts/check-redis-tls.mjs --redis-server /owned/path/redis-server` | Actual disposable Redis8.10.3 TLS/mTLS: AUTH/PING accepted; untrusted CA, wrong hostname, missing client certificate and wrong Redis password rejected; one BullMQ job completed through TLS |

The Redis harness starts a newly owned loopback daemon or a bounded disposable
Docker container (`--docker`), uses generated synthetic certificates and
credentials, and cleans its own resources. The one job proves the real
consumer/blocking/results transport works with TLS; it is not a throughput,
long-duration, failover or certificate-rotation benchmark. Certificate test
fixtures are created with OpenSSL and removed; no fixture key is committed.

Local Docker is unavailable, so rendered Compose/native readonly enforcement,
the Docker form of the Redis harness and actual four-image gates await full
CI. The coordinator must record the actual new HEAD results before integration.
