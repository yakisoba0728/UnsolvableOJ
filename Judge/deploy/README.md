# 전용 실행 노드 배포 준비

이 디렉터리는 **설정 템플릿**입니다. 서버에 접속하거나 배포하지 않습니다. 실제 반영은 소유자의 배포 승인 후 진행하세요.

## 배치 조건

- API/PostgreSQL과 분리된 전용 Linux 호스트/VM, Docker Compose 2.24.4 이상을 권장합니다.
- 현재 실제 검증 기준은 Linux/cgroup v2입니다. cpu·memory·pids controller와 seccomp가 필요하며 fallback은 허용하지 않습니다. v1은 호스트 swap을 꺼야 하고 별도 실행 검증 전에는 운영에 사용하지 마세요.
- 이 Compose에는 워커와 go-judge만 있습니다. API·Redis는 사설망/VPN으로 접근하며 외부 공개 Redis를 사용하지 마세요. Redis 인증 정보는 API와 워커가 일치해야 합니다.
- go-judge는 privileged이지만 호스트 포트를 전혀 공개하지 않습니다. Docker socket·홈 디렉터리·운영 데이터는 mount하지 않습니다. Docker 관리자 권한과 로그 접근 권한을 제한하세요.

## 배포 승인 후 준비할 설정

1. `.env.example`을 `.env`로 복사하고 `chmod 600 .env`로 보호합니다. 이 파일은 Git에서 제외됩니다.
2. `API_BASE_URL`은 실제 API의 `/api/v1` 주소, `REDIS_HOST`는 사설 Redis 주소입니다. Redis 사용자/비밀번호/DB를 API 설정과 일치시키세요. 현재 워커는 Redis TLS 설정을 제공하지 않으므로 암호화된 사설 연결/VPN을 사용하세요.
3. `JUDGE_SERVICE_TOKEN`은 API의 동일 설정과 맞춥니다. `GO_JUDGE_TOKEN`은 실행 노드 전용으로 별도 생성합니다. 토큰은 각각 암호학적으로 무작위인 최소 32바이트를 사용하고 채팅·로그·커밋에 넣지 마세요. 예를 들어 로컬 비밀 관리 도구에서 `openssl rand -hex 32`로 생성할 수 있습니다.
4. 애플리케이션의 JWT 비밀키와 PostgreSQL/Redis 비밀번호도 로컬 기본값을 사용하지 마세요. 기존 DB 비밀번호 변경은 DB 계정과 클라이언트를 함께 갱신해야 하며 Compose 환경 변수만 바꿔서는 기존 DB 계정이 변경되지 않습니다.

다음 명령은 **배포 승인 후 전용 실행 서버에서만** 실행합니다.

```sh
docker compose --env-file .env -p unsolvable-executor -f compose.yaml config --quiet
docker compose --env-file .env -p unsolvable-executor -f compose.yaml up -d --build --wait
docker compose --env-file .env -p unsolvable-executor -f compose.yaml ps
```

미설정 필수 값은 Compose가 거절합니다. 상태 확인은 API `/admin/ops`의 워커·실패 작업과 실행 노드 healthcheck를 함께 보세요. 실제 문제로 8개 언어·실패 판정·예제 출력 차단을 검증하고, 장애 시 새 워커를 중지한 뒤 이전 검증 버전으로 되돌립니다. DB 볼륨 삭제나 `down -v`를 운영 복구 절차로 사용하지 마세요.
