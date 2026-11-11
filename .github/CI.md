# CI 운영

`main` 대상 PR과 `main` push는 빠른 기본 검사를 실행합니다. 검사는 여러 작업으로 나뉘어 GitHub 제공 `ubuntu-24.04` 러너에서 동시에 돌고(Node 24와 npm 캐시 사용), 마지막 `CI required` 작업이 결과를 모읍니다. 필요한 작업이 하나라도 실패·취소되면 `CI required`가 실패하고, 건너뛴 작업은 통과로 봅니다. 같은 PR·수동 실행의 이전 실행은 취소하지만, `main` push는 커밋마다 결과가 남도록 취소하지 않습니다. 수동·야간 전체 검사는 PR 검사와 서로 취소하지 않습니다.

모든 실행에는 별도 작업 `Dependency audit`도 함께 돌아갑니다. Back·Front·Judge 각각 `npm audit --omit=dev --audit-level=high`로 운영 의존성의 high/critical 취약점만 실패로 처리하고 low/moderate는 로그로만 남깁니다. lockfile만 읽으므로 의존성을 설치하지 않습니다. 새 권고가 공개되면 코드 변경 없이도 실패할 수 있으며 `CI required`와는 별개입니다. 보호 규칙에 넣을지는 별도로 결정하세요.

`Docker image (back|front|judge|runtime)` 작업은 운영 Dockerfile(`Back`, `Front`, `Judge`, `Judge/runtime`)을 빌드만 합니다. 이미지를 레지스트리에 올리거나 러너에 내보내지 않고 BuildKit 레이어를 GitHub Actions 캐시(`type=gha`, 이미지별 scope)에만 남깁니다. PR은 base와, `main` push는 직전 커밋과 비교해 해당 디렉터리나 `ci.yml`이 바뀐 항목만 빌드하고, 바뀌지 않은 항목은 빌드 단계를 건너뛴 채 성공으로 끝납니다. 비교할 커밋이 없는 새 브랜치·야간·수동 실행은 모두 빌드합니다. 이 작업은 `CI required`와 독립적이라 `CI required` 결과에 영향을 주지 않습니다. 보호 규칙에 넣으려면 4개 항목을 각각 required로 지정하세요(건너뛴 항목도 성공으로 보고됩니다). 실행 이미지 캐시는 수 GB가 될 수 있고 저장소 캐시 한도(기본 10 GB)를 넘으면 오래된 npm·이미지 캐시부터 밀려납니다.

## 의존성 업데이트

`.github/dependabot.yml`이 매주 월요일 09:00 KST에 npm(Back·Front·Judge), GitHub Actions, Dockerfile 기본 이미지의 버전 업데이트를 엽니다. npm은 디렉터리마다 minor/patch 묶음과 major 묶음, Actions와 Docker는 각각 한 묶음으로 PR 수를 줄입니다. Docker 기본 이미지의 major 변경과 `criyle/go-judge`(라이선스 ADD URL·checksum이 버전에 고정됨)는 제외하므로 직접 올립니다. 보안 업데이트는 이 일정과 별개로 열립니다. 실행 이미지(`Judge/runtime`) 변경 PR은 병합 전에 전체 검사를 실행하세요.

## 작업 구성

| 작업 | 내용 | 실행 조건(PR) |
|---|---|---|
| `Detect changes` | base와 비교해 바뀐 경로를 판단 | 항상 |
| `Backend and API` | 백엔드 lint·단위·빌드, 운영 Compose 정적 검사, DB 마이그레이션·API 통합 | `Back/`·`deploy/`·`scripts/`·`compose.yaml` 변경 |
| `Judge worker` | 워커 빌드·계약 검사, Python 실행기 검사 | `Judge/`·`compose.yaml` 변경 |
| `Browser tests (1/2, 2/2)` | Playwright 공식 이미지에서 브라우저 회귀를 둘로 나눠 동시에 실행. 1번은 프론트 빌드·타입 검사도 함 | `Front/` 변경 |
| `Sandbox, pipeline and Compose` | go-judge·실제 채점 파이프라인·운영 Compose 브라우저 흐름 | 야간·수동 전체 검사만 |

`.github/workflows/ci.yml`이 바뀐 PR과 `main` push·야간·수동 실행은 경로와 상관없이 모든 작업을 돌립니다. 프론트 테스트는 API를 모의 응답으로 대신하므로 Back만 바뀐 PR에서는 브라우저 테스트를 돌리지 않습니다. 브라우저 작업은 `mcr.microsoft.com/playwright:v<버전>-noble` 컨테이너에서 돌아 apt 설치나 브라우저 다운로드가 없습니다. **`Front/package.json`의 `@playwright/test` 버전을 바꾸면 `ci.yml`의 이미지 태그도 같은 버전으로 바꾸세요.**

## 기본 검사

- 백엔드 lint·타입·단위 테스트·빌드, BOJ 변환·통합 실행기·기본 문제 정답 데이터 검사
- 프론트 프로덕션 빌드와 테스트 타입 검사
- 운영 Compose의 필수 환경 변수·포트·볼륨·네트워크·자원 상한·워커 연결 검사
- 브라우저 없는 unit 프로젝트는 한 번, 모든 UI 회귀 검사는 Chromium에서 실행
- 워커 빌드·모의 HTTP 계약 검사와 Python 실행기 healthcheck 검사
- 임시 PostgreSQL/Redis에서 DB 마이그레이션 왕복과 API 통합 검사
- 운영 Compose 검사는 go-judge를 뺀 서비스의 `no-new-privileges`·`cap_drop: [ALL]`·pids/CPU 상한과 Redis 비밀번호가 명령 인자에 없는지도 확인

브라우저 작업마다 Playwright 워커는 4개입니다. 작업 제한은 백엔드 15분, 브라우저 20분이며 재시도 횟수를 늘리지 않습니다. 개별 테스트 제한은 CLI 프로세스를 여러 번 띄우는 `Back/test/boj-seed.e2e-spec.ts`만 60초로 둡니다. 백엔드는 한 번 빌드한 결과를 DB 검사에서도 재사용합니다.

기존 main의 성공 실행은 총 약 29분 중 브라우저 777개 검사가 24.3분을 사용했습니다. 기본 검사는 같은 UI를 세 브라우저에서 직렬로 반복하던 부분을 줄였습니다. 실제 시간은 Actions 결과에서 확인합니다.

## 전체 검사(야간·수동)

매일 03:00 KST(18:00 UTC)에 `main`에서 아래 전체 검사가 자동으로 실행됩니다. GitHub는 schedule을 기본 브랜치에서만 실행하고, 저장소에 60일간 활동이 없으면 일시 중지하며, 부하가 많을 때 시작이 늦어질 수 있습니다. 수동으로는 Actions → CI → Run workflow에서 full을 켜거나 다음 명령을 실행합니다.

```sh
gh workflow run ci.yml --ref main -f full=true
```

기본 검사에 더해 아래를 실행하며 `Sandbox, pipeline and Compose` 작업 제한은 30분입니다.

- Chromium 전체 회귀와 WebKit 핵심 회귀(인증·세션 갱신·레이아웃·편집기 포커스·복사, 워커 4개). Firefox는 CI에서 돌리지 않으며 필요하면 로컬에서 `npx playwright test --project=firefox`로 확인합니다. 브라우저 회귀와 서버·채점·Compose 검사는 서로 다른 작업이라, 한쪽이 실패해도 다른 쪽 결과는 남습니다.
- privileged Linux go-judge 이미지 빌드, 8개 언어·실패 판정·자원 제한·격리·캐시 회수 검사
- 실제 워커를 사용하는 채점 파이프라인 통합 검사
- 운영 `deploy/compose.yaml`을 사용하는 별도 Compose 프로젝트에서 회원가입 → 문제 게시 → 실제 채점 → XP → 로그아웃 및 커뮤니티 브라우저 흐름(`--production`). 개발 Compose 실실행은 로컬 명령으로 남기며, 기본 CI는 운영 정적검사를 유지합니다.

실행 이미지·격리 설정·Dockerfile·배포 경로 변경이나 릴리스 전에는 전체 검사를 실행하세요. 기본 검사 성공이 세 브라우저와 실제 채점 환경의 전체 검증까지 의미하지는 않습니다. 수동 검사는 선택한 ref를 실행하므로 검사할 브랜치를 지정합니다.

운영 Compose 테스트도 일회용 localhost ingress를 사용하므로 실제 Traefik·Cloudflare·DNS·HTTPS 경로 검증은 아닙니다. 기본 예산은 sandbox 10 GiB, 전체 13.375 GiB 상한이며 일반 CI 흐름은 최대 메모리 동시 부하를 검증하지 않습니다.

실패 시 `browser-failure-<shard>-<attempt>` artifact에 `Front/test-results/`, `Front/playwright-report/`를, `compose-failure-<attempt>` artifact에 live-browser trace/screenshots/HTML/JUnit을 7일 보관합니다. 빈 경로는 실패시키지 않습니다. 테스트용 일회용/fixture 계정만 사용하고 실제 계정·개인 브라우저 프로필·운영 credentials를 이 검사에 넣지 마세요. trace에는 요청/응답과 화면이 포함될 수 있습니다.

## 데이터와 실행 환경

DB와 Redis는 새 컨테이너·임의 localhost 포트·tmpfs를 사용하고 Actions가 정리합니다. 통합 검사는 매번 unsolvable_integration_* DB를 만들고 마이그레이션한 뒤 제거하며 지정한 기존 DB를 마이그레이션하지 않습니다. 외부 fork PR도 저장소 비밀키 없이 같은 기본 검사를 실행합니다.

전체 검사에서만 일회용 러너의 swap을 끕니다. 개발/운영 호스트의 swap을 변경하지 않습니다. 브라우저 보안 설정을 끄거나 개인 프로필을 재사용하지 않습니다.

## 로컬 재현

```sh
npm ci --prefix Back
npm ci --prefix Front
npm ci --prefix Judge
npm run check --prefix Back
npm run check --prefix Front
npm run check --prefix Judge
node scripts/check-production-compose.mjs
cd Front
npx playwright install --with-deps --only-shell chromium
# CI와 같은 범위(빠른 세트 + 느린 회귀 세트). 로컬의 npm run test:e2e는 빠른 세트(unit·chromium)만,
# npm run test:e2e:full은 Firefox 전체와 WebKit 핵심 회귀까지 실행합니다.
npx playwright test --project=unit --project=chromium --project=chromium-slow --workers=4
cd ..
```

추가 브라우저는 Playwright로 설치한 뒤 해당 project를 지정합니다. 실제 실행기 검사는 [Judge 문서](../Judge/README.md)를 참고하세요. 테스트용 PostgreSQL/Redis의 DATABASE_URL, REDIS_HOST, REDIS_PORT를 지정하면 아래 검사도 실행할 수 있습니다.

```sh
npm run test:migrations --prefix Back
npm run test:e2e --prefix Back
npm run test:pipeline --prefix Back
node scripts/check-compose.mjs
node scripts/check-compose.mjs --production
```

check-compose.mjs는 임의 프로젝트명, RAM 기반 DB/Redis, localhost 임의 포트와 일회용 토큰을 사용하고 생성한 프로젝트만 정리합니다. Docker Compose 2.24.4 이상이 필요합니다. Windows에서는 설치된 Edge, Linux/CI에서는 Playwright Chromium을 사용합니다. 실제 흐름 결과는 Front/reports/live-browser*에 저장합니다.
