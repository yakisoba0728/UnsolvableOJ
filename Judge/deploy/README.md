# 전용 실행 노드 배포 준비

이 디렉터리는 **설정 템플릿**입니다. 서버에 접속하거나 배포하지 않습니다. 실제 반영은 소유자의 배포 승인 후 진행하세요.

## 배치 조건

- API/PostgreSQL과 분리된 전용 Linux 호스트/VM, Docker Compose 2.24.4 이상을 권장합니다.
- 현재 실제 검증 기준은 Linux/cgroup v2입니다. cpu·memory·pids controller와 seccomp가 필요하며 fallback은 허용하지 않습니다. v1은 호스트 swap을 꺼야 하고 별도 실행 검증 전에는 운영에 사용하지 마세요.
- 이 Compose에는 워커와 go-judge만 있습니다. API·Redis는 사설망/VPN으로 접근하며 외부 공개 Redis를 사용하지 마세요. Redis 인증 정보는 API와 워커가 일치해야 합니다.
- go-judge는 privileged이지만 호스트 포트를 전혀 공개하지 않습니다. Docker socket·홈 디렉터리·운영 데이터는 mount하지 않습니다. Docker 관리자 권한과 로그 접근 권한을 제한하세요.
- 기본 sandbox 상한은 10 GiB(최대 4 GiB × 동시성 2 + 서비스/캐시 2 GiB), 워커는 512 MiB입니다. OS·빌드 여유를 별도로 확보한 최소 12 GiB급 전용 호스트를 출발점으로 사용하세요. 동시성 변경 시 `SANDBOX_MEMORY_LIMIT`도 `4 GiB × 동시성 + 2 GiB` 이상으로 늘려야 합니다. 캐시/런타임 오버헤드와 호스트 여유는 부하 검증·OOM 모니터링이 필요합니다.

## 배포 승인 후 준비할 설정

1. `.env.example`을 `.env`로 복사하고 `chmod 600 .env`로 보호합니다. 이 파일은 Git에서 제외됩니다.
2. `API_BASE_URL`은 HTTPS로 직접 응답하는 실제 API의 `/api/v1` 주소, `REDIS_HOST`는 사설 Redis의 TLS 주소입니다. Redis 사용자/비밀번호/DB를 API 설정과 일치시키세요. 전용 템플릿은 `JUDGE_DEPLOYMENT_MODE=dedicated`, `REDIS_TLS=true`를 고정합니다. 평문 API·Redis, 32자 미만 또는 서로 같은 API/실행기/Redis 비밀키는 시작 전에 거절합니다. 사설망/VPN과 호스트 방화벽은 계속 필요합니다.
3. `JUDGE_SERVICE_TOKEN`은 API의 동일 설정과 맞춥니다. `GO_JUDGE_TOKEN`은 실행 노드 전용으로 별도 생성합니다. 토큰은 각각 암호학적으로 무작위인 최소 32바이트를 사용하고 채팅·로그·커밋에 넣지 마세요. 예를 들어 로컬 비밀 관리 도구에서 `openssl rand -hex 32`로 생성할 수 있습니다.
4. 애플리케이션의 JWT 비밀키와 PostgreSQL/Redis 비밀번호도 로컬 기본값을 사용하지 마세요. 기존 DB 비밀번호 변경은 DB 계정과 클라이언트를 함께 갱신해야 하며 Compose 환경 변수만 바꿔서는 기존 DB 계정이 변경되지 않습니다.
5. 기존 워커를 중지하고 진행 중인 작업이 끝난 뒤 검증한 버전을 반영합니다. 이전 실행기로 채점된 제출은 메모리 측정 방식이 달라 일괄 재채점하지 마세요.

다음 명령은 **배포 승인 후 전용 실행 서버에서만** 실행합니다.

```sh
docker compose --env-file .env -p unsolvable-executor -f compose.yaml config --quiet
docker compose --env-file .env -p unsolvable-executor -f compose.yaml config --format json | node ../../scripts/check-executor-compose.mjs
docker compose --env-file .env -p unsolvable-executor -f compose.yaml up -d --build --wait
docker compose --env-file .env -p unsolvable-executor -f compose.yaml ps
```

미설정 필수 값은 Compose가 거절합니다. 상태 확인은 API `/admin/ops`의 워커·실패 작업과 실행 노드 healthcheck를 함께 보세요. API 토큰이 맞지 않으면 워커가 종료 코드 1로 끝나 재시작을 반복하므로 `ps`에 드러납니다. 실제 문제로 8개 언어·실패 판정·예제 출력 차단을 검증하고, 장애 시 새 워커를 중지한 뒤 이전 검증 버전으로 되돌립니다. DB 볼륨 삭제나 `down -v`를 운영 복구 절차로 사용하지 마세요.

## Phase II resource and network parity

The dedicated worker now uses the same default CPU ceiling (`JUDGE_CPUS=1.0`),
128-process ceiling, dropped capabilities and `no-new-privileges` as the main
production template. Only the worker joins the outbound `application` network;
the privileged execution service joins an internal-only `sandbox` network.
These controls reduce outer-service exposure but do not turn a privileged
container into a host/VM security boundary. Native enforcement and production
network reachability still require verification on the intended dedicated host.

## Verified TLS and private certificate files

The worker always verifies the Redis certificate and hostname, with TLS 1.2 or
newer. DNS endpoints default their SNI/identity to `REDIS_HOST`. Set
`REDIS_TLS_SERVERNAME` to the certificate DNS name when connecting to an IP or
another private routing alias. A missing/untrusted CA, wrong identity or failed
client authentication prevents readiness and queue consumption; there is no
plaintext fallback or option to disable verification.

For a Redis endpoint using the system trust store and password authentication,
the base Compose is sufficient. Redis normally requires mutual TLS unless its
administrator deliberately configures a different client-authentication policy;
see the [official Redis TLS documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/).
For a private CA and mutual TLS, use the supplied overlay:

```sh
# Set these paths in the local protected .env; never commit the identity files.
# EXECUTOR_REDIS_CA_PATH=/secure/redis-ca.pem
# EXECUTOR_REDIS_CERT_PATH=/secure/worker-client.pem
# EXECUTOR_REDIS_KEY_PATH=/secure/worker-client-key.pem
docker compose --env-file .env -p unsolvable-executor -f compose.yaml -f tls-files.compose.yaml config --format json | node ../../scripts/check-executor-compose.mjs
docker compose --env-file .env -p unsolvable-executor -f compose.yaml -f tls-files.compose.yaml up -d --build --wait
```

Compose mounts only the three named files as read-only secrets into the worker;
the privileged execution service receives none. Provision file permissions so
the image's UID/GID 1000:1000 can read them, while excluding other ordinary
host users (for example, key ownership 1000:1000 and mode 0400, with a protected
parent directory). Trusted host administrators can still read them. Standalone Compose secret files are local mounts, not
an encrypted secret-management service. The worker root filesystem is read-only;
its health file uses a 16 MiB non-executable `/tmp` mount. Certificate replacement
requires a controlled worker restart; this change does not claim live rotation.

`check-executor-compose.mjs` validates the rendered topology, TLS mode, token
separation, host namespace/port/data-mount exclusion, resource budgets and
approved certificate mounts without contacting a service or logging secret
values. It cannot verify the physical host, private DNS, firewall, Redis ACLs,
kernel patch level, certificate issuance, actual mounted-file readability or the operator's final routing.
An administrator controlling this privileged host can still read the worker's
credentials. Keep application/database hosts separately administered and allow
executor egress only to the required private API and Redis endpoints.

The template covers algorithm workers. Moving it does not move the API's Vibe
execution path or automatically remove the sandbox from the single-host
`deploy/compose.yaml`. Review those separate paths before claiming complete
execution-host separation. [Phase III security scope](../../docs/overhaul/PHASE3-SECURITY.md)
records the implemented and still unverified boundaries.
