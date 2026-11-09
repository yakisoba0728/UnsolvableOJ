# Dokploy 운영 배포 · 동일 호스트

`deploy/compose.yaml`은 Front, Back, PostgreSQL(+백업), Redis, Judge, go-judge를 **같은 Docker 호스트**에 배포합니다. Dokploy에서는 **Docker Compose** 모드를 사용합니다. `build`를 지원하지 않는 Docker Stack 모드는 사용하지 않습니다.

```text
인터넷 → Dokploy Traefik / HTTPS → front:80 → back:3000
                                               ↕
                                        postgres / redis
                                               ↕
                                             judge → go-judge:5050
```

호스트에 공개하는 포트는 없습니다. Traefik만 `dokploy-network`로 front에 접근하며, 나머지는 프로젝트 전용 네트워크를 사용합니다. go-judge는 내부 sandbox 네트워크에만 연결되고 영속 데이터나 Docker socket을 mount하지 않습니다.

## 호스트 조건과 제한

- Linux Docker, Compose 2.24.4 이상, cgroup v2의 cpu/memory/pids controller와 seccomp가 필요합니다. Docker Desktop에서도 검증할 수 있지만 운영 대상은 Linux 서버입니다.
- go-judge는 중첩 sandbox를 위해 `privileged: true`가 필요합니다. 컨테이너 네트워크와 자원 제한은 별도 VM의 격리를 대신하지 않습니다. 실행기나 커널이 뚫리면 같은 호스트의 DB 및 기존 Dokploy 프로젝트도 영향을 받을 수 있습니다. 이 구성은 소유자가 선택한 동일 호스트 배치이며, 호스트 격리가 필요해지면 [별도 실행 노드 구성](../Judge/deploy/README.md)으로 이전하세요.
- 실행기는 private cgroup namespace를 사용하며 `memswap_limit`을 `mem_limit`과 같게 설정해 Docker가 시작 전에 swap을 금지합니다. swap이 켜진 cgroup v2에서는 실제 `memory.swap.max=0`도 healthcheck로 확인합니다. 이 제한을 적용할 수 없는 호스트에서는 기동을 중단합니다. 실패할 때 `-no-fallback`이나 seccomp를 해제하지 마세요.
- 기본 메모리 상한 합계는 약 **13.375 GiB**입니다(sandbox 10 GiB 포함). 최소 16 GiB급 호스트를 출발점으로 OS, Dokploy, 기존 프로젝트, Docker 빌드용 여유를 별도로 확보하세요. 배포 전 실제 여유 RAM·CPU·디스크를 확인하세요. 상한은 예약이나 호스트 용량 보장이 아닙니다.
- 동시 채점은 기본 2개, go-judge CPU 상한은 2 CPU입니다. 문제당 최대 4096 MiB(컴파일 1 GiB)를 지원하므로 sandbox는 **4 GiB × 동시성 + 2 GiB 서비스/캐시 여유** 이상으로 설정하세요. 예: 동시성 3이면 14 GiB. 캐시 증가·커널/런타임 오버헤드까지 엄밀히 보장하는 scheduler는 없으므로 최대 부하에서 OOM·캐시·재시작을 모니터링하고 여유를 늘리세요. Redis는 기본 256 MB에서 `noeviction`으로 새 쓰기를 거절합니다.

## Dokploy 설정

현재 배포 대상은 `https://judge.yaki.kr`, 배포 브랜치는 `main`입니다. 기존 서버의 Cloudflare HTTPS → Traefik HTTP 경로를 그대로 사용하므로 이 환경의 Dokploy domain은 **`https=false`, certificate `none`, service `front`, port `80`**으로 설정합니다. 브라우저 연결은 Cloudflare에서 HTTPS로 보호됩니다. 서버 원본까지의 연결 보호는 기존 Cloudflare 연결 방식에 따르므로 별도로 확인하세요. 아래의 Let's Encrypt 설정은 Cloudflare 터널/프록시를 거치지 않고 Traefik에서 직접 TLS를 종료할 때 사용합니다.

1. GitHub에 이 변경을 반영하고 Dokploy의 GitHub 연결이 `yakisoba0728/UnsolvableOJ` 저장소에 접근할 수 있도록 설정합니다.
2. 새 프로젝트 `UnsolvableOJ` → production 환경 → Docker Compose 서비스를 만듭니다. 기존 서비스는 재사용하지 않습니다.
3. Provider는 GitHub, 저장소는 위 저장소, 브랜치는 `main`, Compose Path는 `./deploy/compose.yaml`로 설정합니다. main의 CI가 통과한 것을 확인한 뒤 배포합니다. 빌드 context의 `../Back`, `../Front`, `../Judge`는 Compose 파일 위치 기준입니다. 루트 개발용 Compose와 합치지 마세요.
4. 이 파일은 외부 `dokploy-network`에 front만 직접 연결합니다. Dokploy의 **Isolated Deployments는 끄고**, 해당 네트워크가 있는지 확인합니다.
5. 호스트 터미널에서 다음 명령으로 Traefik 네트워크의 실제 IPv4 subnet을 확인합니다. CIDR을 추측하거나 `0.0.0.0/0`을 사용하지 마세요.

   ```sh
   docker network inspect dokploy-network --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
   ```

6. [`.env.example`](./.env.example)의 내용을 Dokploy **Environment**에 넣습니다. 필수 값은 비워 두면 Compose 단계에서 거절됩니다.
   - `PUBLIC_ORIGIN`: 실제 HTTPS origin, 예: `https://oj.example.com`. 경로나 마지막 `/`는 제외합니다.
   - `TRUSTED_PROXY_CIDR`: 위 명령에서 확인한 IPv4 subnet. nginx가 이 네트워크에서 온 전달 헤더만 사용해 클라이언트 IP를 복원합니다. 백엔드의 IP별 속도 제한도 이 IP를 사용합니다.
   - `TRUSTED_PROXY_HOP_CIDR`: 전달 헤더에 추가되는 신뢰 가능한 프록시 홉의 주소. 현재 `judge.yaki.kr` 경로는 `TRUSTED_PROXY_CIDR=10.0.1.0/24`와 `TRUSTED_PROXY_HOP_CIDR=172.18.0.1/32`를 함께 사용합니다. 추가 홉이 없으면 기본값 `127.0.0.1/32`를 유지합니다. 전체 사설망이나 `0.0.0.0/0` 대신 실제 확인한 프록시 주소만 지정하세요.
   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `JUDGE_SERVICE_TOKEN`, `GO_JUDGE_TOKEN`: 각각 독립적으로 생성한 무작위 값. `openssl rand -hex 32`를 **각각** 실행해 생성할 수 있습니다. PostgreSQL 비밀번호는 URL에 포함되므로 hex를 사용합니다. 실제 값을 Git·채팅·로그에 붙여 넣지 마세요.
   - `VITE_SENTRY_DSN`: 선택 사항인 공개 브라우저 설정이며 변경 시 재빌드가 필요합니다.
7. Domains에서 실제 도메인을 **service `front`, container port `80`**에 연결합니다. 현재 Cloudflare 경로는 위 설정을 사용합니다. Traefik 직접 접속 환경은 DNS A 레코드를 서버 공인 IP로 지정하고 HTTPS/Let's Encrypt를 설정합니다. 사용하지 않는 AAAA 레코드는 제거하거나 실제 IPv6 경로를 구성합니다. DB, Redis, back, go-judge에 도메인을 연결하지 않습니다.
8. 첫 배포는 수동으로 실행합니다. Compose 도메인 변경은 재배포 후 반영됩니다. 서비스의 자동 배포는 최초 검증이 끝날 때까지 끄세요.

`PUBLIC_ORIGIN`을 설정하는 것만으로 DNS나 HTTPS가 만들어지지는 않습니다. Compose Environment 값은 `${...}`로 참조한 값만 컨테이너에 들어갑니다. nginx → back 구간은 컨테이너 내부 HTTP입니다.

## 최초 배포 확인

1. 7개 서비스가 실행되는지 확인합니다. postgres, postgres-backup, redis, back, front, judge와 go-judge의 healthcheck가 통과해야 합니다. judge는 API heartbeat가 성공할 때마다 `/tmp/judge-heartbeat`를 갱신하며, 2분 넘게 갱신되지 않으면 healthcheck가 워커 프로세스를 종료해 restart 정책으로 다시 시작합니다(Compose는 unhealthy만으로 재시작하지 않습니다). back이 오래 내려가 있어도 같은 방식으로 재시작을 반복하다 back이 돌아오면 정상화됩니다. back은 시작할 때 미적용 TypeORM 마이그레이션을 실행하며 실패하면 정상 상태가 되지 않습니다.
2. `https://<도메인>/`과 `/api/v1/health`를 확인합니다. `/api/v1/internal/judge/heartbeat` 같은 내부 경로는 공개 nginx를 통해 접근하면 404여야 합니다. 워커는 `http://back:3000/api/v1`로 직접 통신합니다.
3. 웹에서 관리자용 계정을 회원가입한 뒤 Dokploy의 **back 컨테이너 터미널**에서 다음 명령을 실행하고 다시 로그인합니다. 운영 이미지에는 개발용 빌드 도구가 없으므로 `npm run db:bootstrap:admin` 대신 이미 빌드된 스크립트를 직접 실행합니다.

   ```sh
   node scripts/bootstrap-admin.mjs admin@example.com
   ```

4. 관리자 API `/api/v1/admin/ops`에서 워커 heartbeat와 큐 오류를 확인합니다. worker는 sandbox 검사와 인증된 heartbeat에 모두 성공한 뒤 큐를 소비합니다. `running` 상태만으로 정상 채점을 판단하지 않습니다.
5. 문제를 만들고 최소한 Python/C++ 제출의 정답·오답·시간 초과를 검증합니다. 실행 이미지 변경 시 별도 테스트 환경에서 8개 언어와 격리 회귀 검사를 실행합니다. 실제 운영 큐를 사용하는 실행기에 테스트를 섞지 마세요.
6. 서로 다른 두 클라이언트에서 접속해 back에 전달되는 IP와 속도 제한을 확인합니다. 프록시 주소 하나로 합쳐지면 `TRUSTED_PROXY_CIDR`과 Traefik의 전달 헤더 설정을 확인하세요.

## 백업·업데이트·복구

- PostgreSQL, PostgreSQL 백업, Redis는 프로젝트별 named volume을 사용합니다. Dokploy 서비스나 Compose 프로젝트 이름을 바꾸면 다른 볼륨이 선택될 수 있으므로 이름을 유지하세요. `docker compose down -v`와 볼륨 prune은 운영 복구에 사용하지 않습니다.
- `postgres-backup` 서비스가 기동할 때와 이후 24시간마다 `pg_dump -Fc`로 `postgres-backups` 볼륨에 `unsolvable-oj-<UTC 시각>.dump`(권한 600)를 만듭니다. 덤프가 성공했을 때만 `BACKUP_KEEP_DAYS`일(기본 7일)보다 오래된 파일을 지우므로 실패가 이어져도 기존 백업은 남습니다. 26시간 안에 성공한 덤프가 없으면 healthcheck가 unhealthy가 됩니다. 이 서비스는 `data` 네트워크에만 연결되고 포트를 공개하지 않습니다.
- 백업 볼륨은 **같은 호스트**에 있으므로 디스크·호스트 장애에는 대비하지 못합니다. 최초 공개 전과 이후 정기적으로 덤프를 서버 외부 저장소로 복사하세요(자동 원격 전송은 아직 없습니다). 아래 `<backup-container>`, `<postgres-container>`는 `docker ps`로 확인한 실제 컨테이너 이름입니다.

  ```sh
  # 백업 목록과 외부 복사. 권한을 제한한 호스트 디렉터리에서 실행합니다.
  docker exec <backup-container> ls -l /backups
  umask 077
  docker cp <backup-container>:/backups/unsolvable-oj-<시각>.dump .
  # 즉시 백업이 필요하면(예: 업데이트 직전) 서비스를 재시작합니다. 새 덤프가 만들어집니다.
  docker restart <backup-container>
  ```

- 복원 확인은 서비스 중인 DB 대신 임시 DB에서 합니다. 백업 컨테이너에 접속 정보(`PGHOST` 등)가 설정되어 있으므로 그대로 실행할 수 있습니다.

  ```sh
  docker exec <backup-container> createdb unsolvable_restore
  docker exec <backup-container> pg_restore --no-owner --exit-on-error -d unsolvable_restore /backups/unsolvable-oj-<시각>.dump
  docker exec <backup-container> psql -d unsolvable_restore -c 'SELECT count(*) FROM users'
  docker exec <backup-container> dropdb unsolvable_restore
  ```

- 실제 복원은 Dokploy에서 **front, back, judge를 중지**한 뒤 DB를 다시 만들고 덤프를 넣습니다. `pg_restore --clean`은 덤프에 없는 이후 테이블을 남기므로 DB 자체를 다시 만듭니다. 복원 후 back을 먼저 시작해 마이그레이션이 성공하는지 확인하고 judge, front를 시작합니다. 대기 중이던 Redis 큐 작업은 복원된 DB와 맞지 않을 수 있으므로 관리자 ops 화면에서 큐 상태를 확인하세요.

  ```sh
  docker exec <backup-container> dropdb --force unsolvable_oj
  docker exec <backup-container> createdb unsolvable_oj
  docker exec <backup-container> pg_restore --no-owner --exit-on-error -d unsolvable_oj /backups/unsolvable-oj-<시각>.dump
  ```

  외부에 보관한 덤프로 복원할 때는 `docker cp ./unsolvable-oj-<시각>.dump <backup-container>:/backups/`로 먼저 넣습니다.

- PostgreSQL이 초기화된 뒤 `POSTGRES_PASSWORD`만 바꾸면 DB 계정 비밀번호는 바뀌지 않습니다. 계정과 접속 설정을 함께 갱신하세요. JWT 비밀키 변경은 기존 로그인을 무효화합니다. Judge/Redis/실행기 토큰도 소비자와 함께 변경해야 합니다.
- 기존 CI는 검사만 수행합니다. 첫 운영 검증 후 배포 자동화를 연결할 때는 **CI 성공한 커밋만 배포**하도록 연결하세요. Dokploy의 push 자동 배포를 단순히 켜면 CI가 끝나기 전에 배포될 수 있습니다.
- 업데이트 전 DB 백업과 이전 정상 커밋을 기록합니다. 이미지 롤백은 마이그레이션을 자동으로 되돌리지 않습니다. 스키마 호환성을 확인하고 필요한 경우 검증한 복원 절차를 사용하세요.
- 워커는 종료 시 진행 중인 채점을 기다리지만 2분 이후 강제 종료될 수 있습니다. 긴 작업은 lease 만료 뒤 재처리될 수 있으므로 배포 중 큐와 워커 상태를 확인하세요. 로그는 컨테이너당 10 MB × 3개로 순환하며 실행기 로그 접근 권한을 제한합니다.

## 로컬 검증

실제 비밀키나 Docker daemon 없이 환경 변수 누락, 포트 공개, 볼륨, 네트워크, 자원 상한과 워커 연결을 검사합니다.

```sh
node scripts/check-production-compose.mjs
```

Docker와 Front 의존성이 있으면 운영용 Compose로 실제 회원가입·문제 게시·Python 정답/오답 채점·XP·커뮤니티 브라우저 검사를 실행할 수 있습니다. Windows에서는 설치된 Edge, Linux/CI에서는 Playwright Chromium을 사용합니다(`LIVE_BROWSER_CHANNEL`로 변경 가능). 임의 이름의 테스트 프로젝트와 RAM 기반 DB를 만들고 종료 시 제거하며 운영 볼륨이나 `dokploy-network`를 사용하지 않습니다. 테스트 ingress는 localhost의 임의 포트를 사용하므로 실제 Traefik/DNS/HTTPS 검사는 배포 후 별도로 진행합니다.

```sh
npm ci --prefix Front
# Linux/CI에서 Chromium 설치. Windows + Edge에서는 생략합니다.
cd Front && npx playwright install chromium && cd ..
node scripts/check-compose.mjs --production
```

직접 Compose로 구성을 확인할 때는 `deploy/.env`를 준비한 뒤 아래 명령을 사용합니다. 이 파일은 Git에서 제외됩니다. `config` 결과에는 실제 비밀키가 포함될 수 있으므로 공유하지 마세요.

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml config --format json | node scripts/check-sandbox-budget.mjs
```

두 번째 검사는 커스텀 동시성/메모리 예산을 서비스 기동 없이 확인하며 비밀키를 출력하지 않습니다. Dokploy 설정 변경 전에도 실제 Environment로 동일 검사를 실행하세요. Compose 자체가 예산 산식을 강제하지는 않습니다.
