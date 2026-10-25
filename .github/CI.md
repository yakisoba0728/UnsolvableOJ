# CI 운영

`main` 대상 PR과 `main` push는 빠른 기본 검사를 실행합니다. GitHub 제공 `ubuntu-24.04` 러너 한 개, Node 24와 npm 캐시를 사용하며 결과 이름은 `CI required`를 유지합니다. 같은 이벤트·브랜치의 이전 실행은 취소합니다. 수동 전체 검사는 PR 검사와 서로 취소하지 않습니다.

## 기본 검사

- 백엔드 lint·타입·단위 테스트·빌드, BOJ 변환·통합 실행기·기본 문제 정답 데이터 검사
- 프론트 프로덕션 빌드와 테스트 타입 검사
- 운영 Compose의 필수 환경 변수·포트·볼륨·네트워크·자원 상한·워커 연결 검사
- 브라우저 없는 unit 프로젝트는 한 번, 모든 UI 회귀 검사는 Chromium에서 실행
- 워커 빌드·모의 HTTP 계약 검사와 Python 실행기 healthcheck 검사
- 임시 PostgreSQL/Redis에서 DB 마이그레이션 왕복과 API 통합 검사

Chromium headless shell만 설치하며 Playwright 워커는 2개입니다. 기본 작업 제한은 15분이며 개별 테스트 제한이나 재시도 횟수를 늘리지 않습니다. 백엔드는 한 번 빌드한 결과를 DB 검사에서도 재사용합니다.

기존 main의 성공 실행은 총 약 29분 중 브라우저 777개 검사가 24.3분을 사용했습니다. 기본 검사는 같은 UI를 세 브라우저에서 직렬로 반복하던 부분을 줄였습니다. 실제 시간은 Actions 결과에서 확인합니다.

## 수동 전체 검사

Actions → CI → Run workflow에서 full을 켜거나 다음 명령을 실행합니다.

```sh
gh workflow run ci.yml --ref main -f full=true
```

기본 검사에 더해 아래를 실행하며 작업 제한은 40분입니다.

- Firefox·WebKit을 포함한 세 브라우저 전체 회귀(워커 2개)
- privileged Linux go-judge 이미지 빌드, 8개 언어·실패 판정·자원 제한·격리·캐시 회수 검사
- 실제 워커를 사용하는 채점 파이프라인 통합 검사
- 별도 Compose 프로젝트에서 회원가입 → 문제 게시 → 실제 채점 → XP → 로그아웃 및 커뮤니티 브라우저 흐름

실행 이미지·격리 설정·Dockerfile·배포 경로 변경이나 릴리스 전에는 전체 검사를 실행하세요. 기본 검사 성공이 세 브라우저와 실제 채점 환경의 전체 검증까지 의미하지는 않습니다. 수동 검사는 선택한 ref를 실행하므로 검사할 브랜치를 지정합니다.

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
npm run test:e2e -- --project=unit --project=chromium --workers=2
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
