# CI 운영

`ci.yml`은 `main`, `codex/**` push, `main` 대상 PR, 수동 실행을 지원합니다.
동일 PR/브랜치의 이전 실행은 취소됩니다. 모든 단계의 성공 여부는 `CI required`에서 확인합니다.
외부 fork PR 코드는 이 영구 self-hosted 러너에서 실행하지 않습니다.

## 러너

- 이름: `hyperv-unsolvable-01`
- 라벨: `self-hosted`, `Linux`, `X64`, `unsolvable-oj`, `docker`
- 서비스 계정: `unsolvable-actions` (Docker 그룹, sudo 권한 없음)
- 설치 경로: `/opt/actions-runners/UnsolvableOJ`
- systemd: `actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service`
- 필요한 호스트 도구: Docker, Python 3, Git. Node는 `setup-node`로 설치합니다.
- systemd 자동 시작이 설정되어 있습니다. 다른 저장소의 러너와 계정·작업 디렉터리를 분리합니다.

상태와 서비스 로그:

```sh
systemctl status actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service
sudo journalctl -u actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service -n 100
```

Docker 권한으로 호스트를 제어할 수 있으므로 저장소 쓰기 권한이 있는 신뢰된 코드만 실행해야 합니다.
등록 토큰과 SSH 비밀번호는 저장소나 workflow에 저장하지 않습니다.

## 검사 범위

| 단계 | 검사 내용 |
| --- | --- |
| Node 24 / 26 | 세 패키지의 `npm ci`, 백엔드 타입 기반 lint·단위 테스트·빌드, 프론트 빌드·브라우저 테스트 타입 검사, 워커 빌드, Linux 런타임 회귀 테스트 |
| workflow | actionlint로 GitHub 표현식, 서비스·작업 구성, 셸 스크립트 검사 |
| 마이그레이션 | 별도 임시 DB에서 기존 스키마와 데이터 업그레이드, 테스트케이스 순서/스냅샷, 풀이·XP backfill, 만료 lease, 중복 실행, 전체 rollback, 신규 설치 |
| API | 실제 PostgreSQL·Redis로 인증·권한·토큰 무효화, 공개/비공개 문제, 버전 스냅샷, 판정 attempt fencing, lease, 재채점, XP, 관리자 API, 최초 관리자 CLI |
| Docker 런타임 | 운영 이미지 안의 프로세스·메모리·시간·출력·하위 프로세스 정리 회귀 검사; 8개 언어 정답과 RSS/cgroup OOM/SIGKILL 검사 |
| 전체 채점 경로 | 실제 HTTP API → Redis → Node 워커 → Docker → 결과 저장; 8개 언어 정답, WA/TLE/MLE/RE/OLE/CE, 재채점 generation, XP 중복 방지, 워커 heartbeat |
| 브라우저 | Chromium·Firefox·WebKit에서 로그인·회원가입·로그아웃·세션 만료·권한, AUTHOR 초안/ADMIN 게시, `new`/`mine` slug, 난이도와 페이지 변경, 코드 제출·결과 polling·오류 표시 |

브라우저 테스트는 API 응답을 모킹하여 화면 동작을 검사합니다. 실제 서비스 간 연결은 별도 전체 채점 경로 테스트가 검사합니다.
브라우저 재시도는 사용하지 않으며 실패 시 trace·스크린샷·HTML/JUnit 보고서를 보존합니다.
Playwright 패키지와 Docker 브라우저 이미지 버전은 자동으로 일치시킵니다.

## 격리와 정리

PostgreSQL·Redis는 작업마다 새 컨테이너를 만들고 localhost의 임의 포트로 연결합니다.
API 테스트는 Redis DB 1, 실제 워커 테스트는 DB 2를 사용하여 큐 소비가 섞이지 않게 합니다.
마이그레이션 검사에는 `CREATEDB` 권한이 필요하며 `unsolvable_migrations_<UUID>` DB만 생성·삭제합니다.

채점 이미지는 실행 ID별 태그를 사용합니다. `JUDGE_RUN_ID`를 설정하면 워커와 smoke 컨테이너에
`unsolvable.ci` 라벨이 붙습니다. 실패/취소 시에도 해당 실행의 컨테이너·이미지만 정리합니다.
서버 전체 `docker prune`은 사용하지 않습니다. 서비스 컨테이너는 Actions가 정리합니다.
공통 Docker 빌드 캐시와 브라우저 이미지는 다음 실행을 위해 유지됩니다.

JUnit 보고서와 워커 로그, 브라우저 보고서는 Actions artifacts에 7일간 보존됩니다.
실패한 단계가 있거나 건너뛰어진 경우 최종 `CI required` 검사는 실패합니다.

## 로컬 실행

```sh
npm ci --prefix Back
npm ci --prefix Front
npm ci --prefix Judge
npm run check --prefix Back
npm run check --prefix Front
npm run check --prefix Judge
```

통합 검사는 **개발/운영 워커가 연결되지 않은 테스트용 PostgreSQL·Redis**를 먼저 준비합니다.
`DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`를 해당 인스턴스로 지정한 뒤:

```sh
npm run test:migrations --prefix Back
npm run db:migration:run --prefix Back
npm run test:e2e --prefix Back
docker build -t unsolvable-judge-runtime:ci-local Judge/runtime
export JUDGE_RUNTIME_IMAGE=unsolvable-judge-runtime:ci-local
npm run test:runtime --prefix Judge
npm run build --prefix Judge
npm run test:pipeline --prefix Back
```

`PIPELINE_REDIS_DB`로 실제 워커 테스트의 Redis DB를 바꿀 수 있습니다(기본 2).
브라우저 테스트는 `Front`에서 `npx playwright install --with-deps` 후 `npm run test:e2e`로 실행합니다.
Linux 전용 메모리·프로세스 검사는 macOS에서 일부 건너뛰므로 최종 판정은 Linux CI를 확인합니다.
