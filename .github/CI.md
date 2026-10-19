# CI 운영

GitHub 제공 `ubuntu-24.04` 러너에서 **Node 24, 작업 1개**로 필요한 검사만 실행합니다.
`main` push, `main` 대상 PR, 수동 실행을 지원합니다. PR 브랜치 push를 별도로 실행하지 않아 중복 검사·취소 표시가 생기지 않습니다.

- 백엔드 lint·타입 검사·단위 테스트·빌드
- BOJ HTML 변환 회귀 테스트
- 프론트엔드 TypeScript 검사·프로덕션 빌드·브라우저 테스트 타입 검사
- Chromium에서 UI·페이지네이션·제출 당시 예제·본문 렌더링 회귀 테스트
- 채점 워커 빌드·Python 런타임 단위 테스트
- 임시 PostgreSQL·Redis에서 마이그레이션 적용·API 통합 테스트

전체 결과는 `CI required`에서 확인합니다. 시간 제한은 10분입니다.
Node 버전 매트릭스, 채점 이미지 빌드, 전체 언어 smoke, Firefox·WebKit 브라우저 검사는 CI에서 실행하지 않습니다.
확장 검사 스크립트(`test:migrations`, `test:pipeline`, 프론트 `test:e2e`, 채점기 `test:runtime`)는 필요할 때 로컬에서 실행할 수 있습니다.

## 러너

- GitHub-hosted Ubuntu 24.04 x64 가상 머신을 작업마다 새로 할당합니다.
- Docker와 Python 3는 러너 기본 환경을 사용하고 Node 24는 `setup-node`로 설치합니다.
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
```

테스트용 DB/Redis의 `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`를 지정한 뒤:

```sh
npm run db:migration:run --prefix Back
npm run test:e2e --prefix Back
```
