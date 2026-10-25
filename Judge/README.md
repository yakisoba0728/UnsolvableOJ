# Judge worker · go-judge

TypeScript/BullMQ 워커가 제출을 claim하고 **go-judge v1.13.3의 HTTP API**로 컴파일·실행합니다. 정답 비교·테스트 집계·공개 예제 출력은 워커가 처리하고, 격리·자원 제한·자식 프로세스 정리는 go-judge가 담당합니다. 워커에는 Docker CLI/socket이 필요하지 않습니다.

## 로컬 실행

Linux Docker가 필요합니다. macOS에서는 Docker Desktop의 Linux VM을 사용하며 native macOS go-judge는 사용하지 않습니다.

```bash
# 저장소 루트
docker compose up -d --build --wait go-judge
cp Judge/.env.example Judge/.env
# JUDGE_SERVICE_TOKEN을 Back/.env의 값과 일치시키세요.
cd Judge
npm install
npm run check
npm run test:runtime
npm run start:dev
```

- `GO_JUDGE_URL`: 기본 `http://127.0.0.1:5050`; Compose 워커는 `http://go-judge:5050`.
- `GO_JUDGE_TOKEN`: go-judge의 `ES_AUTH_TOKEN`과 같아야 합니다. 로컬 기본값은 `.env.example`과 Compose가 같습니다. 변경 시 루트 환경 변수와 `Judge/.env`를 모두 맞추세요. 운영에서는 무작위 비밀키를 사용하세요.
- `JUDGE_CONCURRENCY`: 워커 동시 제출 수, 기본 2. Compose의 go-judge 실행 동시성도 2입니다.

`npm run check`는 빌드와 모의 HTTP 서버 기반 회귀 테스트이며 외부 서비스가 필요하지 않습니다. `npm run test:runtime`은 실행 중인 go-judge에서 8개 언어, 실패 판정·메모리·PID·고아 프로세스·네트워크·파일 초기화·캐시 회수를 검사합니다. 다른 워커가 사용하지 않는 테스트용 go-judge에서 실행하세요.

## 채점 정책

- C17(`gnu17`, `-lm` 링크), C++20, Java 21(`Main`), Python 3, JavaScript, TypeScript(esbuild), Go, Rust(2021 edition)를 지원합니다. 도구는 `runtime/Dockerfile`에 설치합니다. Java는 모든 class 파일을 jar로 묶습니다.
- 컴파일은 CPU/wall 각각 30초·메모리 1GiB입니다. 실행은 문제의 CPU/wall 시간과 메모리 제한, task 64개, CPU 1개분을 사용합니다. JVM·Node heap 상한은 문제 메모리 값으로 설정하되 전체 프로세스 메모리는 cgroup이 제한합니다.
- 제출 전체 deadline은 테스트 수 × 테스트별 시간 제한 + 컴파일·통신 여유 60초입니다. API의 최대 100개 × 60초 제한에서는 6,060초입니다.
- REST에는 명령별 파일 크기 상한이 없어, 실행 명령에 표준 Linux `prlimit`을 붙여 stdout/stderr 및 생성 파일에 **정확히 1,000,000바이트 hard limit**을 적용합니다. 컴파일 산출물은 별도 상한 64MiB입니다.
- 테스트는 공개 예제부터 순차 실행하고 첫 실패에서 중단합니다. 각 테스트는 새로 초기화된 환경에서 실행되므로 이전 테스트 파일을 읽을 수 없습니다. `Accepted` 응답도 출력 비교를 통과해야 정답입니다.
- 출력은 바이트 기준으로 비교하며 끝의 ASCII 공백만 무시합니다. JSON의 UTF-8 치환이 판정을 바꾸지 않도록 캐시 출력을 원시 바이트로 다운로드합니다.
- 공개 예제 최대 5개의 stdout/stderr 앞 1,000바이트와 잘림 여부를 보존합니다. 번호는 원래 테스트 순서입니다. 비공개 출력·오류 원문은 응답에 넣지 않습니다.
- 실행 시간은 `runTime`(wall)을 ms로, 메모리는 bytes를 KiB로 바꾼 뒤 테스트별 최대값을 저장합니다. **이전 RSS 샘플러와 cgroup 메모리 측정은 동등하지 않습니다.** 검증 없이 기존 제출을 일괄 재채점하면 판정·XP가 바뀔 수 있습니다.
- 컴파일 산출물과 출력 `fileIds`는 성공·실패·취소 경로에서 삭제합니다. 응답 유실로 ID를 얻지 못한 파일은 서비스의 15분 idle TTL이 보조 회수합니다. compile/run/delete는 같은 인스턴스로 보내세요.

워커는 sandbox 검사와 인증된 API heartbeat를 모두 통과한 뒤에만 Redis 연결·큐 소비를 시작합니다. 기존 generation/attempt·문제 스냅샷을 유지하고 워커·제출 heartbeat를 10초마다 전송합니다. 결과 PATCH의 네트워크 오류·429·5xx는 같은 payload/attempt로 최대 3회(1초·2초 간격) 전송하며, 응답을 확인할 때까지 제출 heartbeat를 유지합니다. lease heartbeat의 409는 현재 실행을 취소하고 이전 시도의 결과 전송을 중단하지만, 일시적인 통신 오류는 실행을 취소하지 않습니다.

실행 중 API 401/403이 확인되면 해당 워커만 큐 소비를 pause하고 진행 중인 채점·결과 전송을 취소합니다. 자동 재개하지 않으므로 토큰을 수정한 뒤 워커를 재시작하세요. SIGINT/SIGTERM에서는 새 작업 소비를 중단하고 진행 중인 채점·결과 전송을 마친 뒤 Redis 연결을 닫습니다.

## 운영 격리

**Compose는 로컬 개발용입니다.** go-judge는 중첩 격리를 위해 `privileged`로 실행하므로 운영에서는 API/DB와 분리된 전용 Linux 호스트/VM에 배치하세요. 제출 프로세스 자체는 별도 namespace·seccomp·제한된 권한으로 실행됩니다.

- 서비스 API는 Bearer 인증을 사용하며 localhost 포트만 공개합니다. Compose에서는 워커만 애플리케이션·sandbox 두 네트워크에 연결합니다. 외부에 `/run`·`/file`을 공개하지 마세요.
- `-no-fallback`, seccomp, cpu/memory/pids controller와 `/w`를 healthcheck 및 워커 시작 시 검사합니다. 잘못된 인증/격리 설정에서는 채점을 시작하지 않습니다. `-no-seccomp`, `-net-share`를 켜지 마세요.
- 호스트 swap이 꺼져 있으면 cgroup 루트 제한을 쓰지 않습니다. swap이 켜진 v2에서는 서비스 상위 `memory.swap.max=0` 설정에 성공해야 시작하며, v1은 호스트 swap이 꺼져 있어야 합니다. 실제 호스트 루트 cgroup은 제한할 수 없으므로 그런 환경에서는 관리자가 swap을 끄거나 위임된 cgroup을 제공해야 합니다.
- 제출에는 해당 소스/산출물과 해당 테스트 입력만 전달합니다. 읽기 전용 도구·라이브러리와 임시 `/w`·`/tmp`만 mount하며, API/DB 비밀키·정답·호스트 디렉터리·Docker socket을 넣지 않습니다.
- upstream은 시작 로그에 설정/인증 토큰을 기록할 수 있으므로 실행 노드 로그도 접근을 제한하세요. 이미지/호스트 패치와 실제 자원 제한 검증은 별도로 필요합니다.

실행 이미지 변경 후 `docker compose up -d --build --wait go-judge`로 다시 빌드하세요. [공식 API](https://docs.goj.ac/api), [설계·제한](https://docs.goj.ac/design), [전환 조사](../docs/research/go-judge-migration.md)를 참고하세요.

별도 승인 후 사용할 [전용 실행 노드 템플릿](./deploy/README.md)은 필수 비밀키가 없으면 시작하지 않으며 host port를 공개하지 않습니다. 전체 앱의 실제 브라우저 검사는 저장소 루트에서 `node scripts/check-compose.mjs`로 실행합니다. 기존 개발 DB와 서비스는 재사용하지 않습니다.
