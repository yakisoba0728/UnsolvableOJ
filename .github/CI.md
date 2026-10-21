# CI 운영

GitHub 제공 `ubuntu-24.04` 러너에서 **Node 24, 작업 1개**로 필요한 검사만 실행합니다.
`main` push, `main` 대상 PR, 수동 실행을 지원합니다. PR 브랜치 push를 별도로 실행하지 않아 중복 검사·취소 표시가 생기지 않습니다.

- 백엔드 lint·타입 검사·단위 테스트·빌드
- BOJ HTML 변환·통합 실행기 안전장치 회귀 테스트
- 프론트엔드 TypeScript 검사·프로덕션 빌드·브라우저 테스트 타입 검사
- Chromium·Firefox·WebKit에서 UI·페이지네이션·제출 당시 예제·본문 렌더링 회귀 테스트
- 별도 Compose 프로젝트에서 Chromium으로 회원가입→문제 게시→실제 제출/채점→XP→로그아웃 검증
- 채점 워커 빌드·go-judge HTTP 계약 회귀 테스트
- privileged Linux go-judge 이미지 빌드·8개 언어·실패 판정·자원 제한·격리·캐시 회수 시험
- 임시 PostgreSQL·Redis에서 마이그레이션 왕복·API 통합·실제 워커 채점 파이프라인 테스트. API 검사는 실행마다 별도 DB를 생성·마이그레이션·삭제하며 기존 DB를 마이그레이션하지 않습니다.

전체 결과는 `CI required`에서 확인합니다. 세 브라우저 전체 회귀와 네이티브 채점 검사를 포함한 작업 시간 제한은 40분이며, 개별 테스트의 시간 제한은 늘리지 않습니다.
Node 버전 매트릭스는 생략합니다. 모의 API 회귀 테스트는 세 브라우저에서, 실제 Compose 흐름은 Chromium에서 검사하며, 모의 API 회귀 테스트는 워커 하나로 실행해 메모리 경쟁을 줄입니다.
마이그레이션 왕복 검사(`test:migrations`)와 프론트 전체 브라우저 `test:e2e`는 로컬에서도 실행할 수 있습니다. 백엔드 통합 검사에는 `CREATEDB` 권한과 다른 워커가 사용하지 않는 테스트 Redis DB가 필요합니다.

## 러너

- GitHub-hosted Ubuntu 24.04 x64 가상 머신을 작업마다 새로 할당합니다.
- Docker와 Python 3는 러너 기본 환경을 사용하고 Node 24는 `setup-node`로 설치합니다.
- 일회용 러너에서만 `swapoff -a`를 실행합니다. 호스트 루트 cgroup에는 swap 제한을 쓸 수 없으므로 sandbox가 메모리 제한을 우회하지 못하도록 합니다. 개발/운영 서버의 swap을 자동으로 변경하지 않습니다.
- 별도 러너 설치·등록·상시 서비스 운영은 필요하지 않습니다.
- 실행 로그는 저장소의 Actions 탭에서 확인합니다.

DB와 Redis는 실행마다 새 컨테이너·임의 localhost 포트·메모리 파일시스템을 사용하고 Actions가 정리합니다.
개발 DB나 별도 서버의 러너를 사용하지 않습니다.
외부 fork PR도 같은 검사 대상이며, GitHub의 실행 승인 정책을 따릅니다. 저장소 시크릿 없이 테스트 전용 설정으로 실행합니다.

## 로컬 재현

```sh
npm ci --prefix Back
npm ci --prefix Front
npm ci --prefix Judge
npm run check --prefix Back
npm run build --prefix Front
npm run check --prefix Judge
docker compose up -d --build --wait go-judge
# Judge/.env의 GO_JUDGE_TOKEN을 실행 서비스와 동일하게 설정한 뒤
npm run test:runtime --prefix Judge
node scripts/check-compose.mjs
```

`check-compose.mjs`는 무작위 프로젝트명·localhost 임의 포트·메모리 파일시스템 DB/Redis와 일회용 인증키를 사용합니다. 기존 개발 서비스/볼륨을 재사용하지 않으며 성공·실패 모두 생성한 프로젝트만 정리합니다. Docker Compose 2.24.4 이상과 Playwright Chromium이 필요합니다.

브라우저 보안 설정을 끄거나 기존 개인 프로필을 재사용하지 않습니다. 실제 브라우저 결과물은 `Front/reports/live-browser*`에 저장해 모의 회귀 테스트 결과와 분리합니다.

테스트용 DB/Redis의 `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`를 지정한 뒤 실행합니다. 각 명령이 일회용 DB를 만들어 마이그레이션하므로 지정한 DB는 마이그레이션하지 않습니다:

```sh
npm run test:e2e --prefix Back
npm run test:pipeline --prefix Back
```
