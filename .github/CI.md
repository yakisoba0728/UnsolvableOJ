# CI 운영

전용 self-hosted 러너에서 **Node 24, 작업 1개**로 필요한 검사만 실행합니다.
`main`·`codex/**` push, `main` 대상 PR, 수동 실행을 지원하며 중복 실행은 취소합니다.

- 백엔드 lint·타입 검사·단위 테스트·빌드
- 프론트엔드 TypeScript 검사·프로덕션 빌드
- 채점 워커 빌드·Python 런타임 단위 테스트
- 임시 PostgreSQL·Redis에서 마이그레이션 적용·API 통합 테스트

전체 결과는 `CI required`에서 확인합니다. 시간 제한은 10분입니다.
Node 버전 매트릭스, 채점 이미지 빌드, 전체 언어 smoke, 브라우저 검사는 CI에서 실행하지 않습니다.
확장 검사 스크립트(`test:migrations`, `test:pipeline`, 프론트 `test:e2e`, 채점기 `test:runtime`)는 필요할 때 로컬에서 실행할 수 있습니다.

## 러너

- 이름: `hyperv-unsolvable-01`
- 라벨: `self-hosted`, `Linux`, `X64`, `unsolvable-oj`, `docker`
- 서비스 계정: `unsolvable-actions` (Docker 그룹, sudo 권한 없음)
- 설치 경로: `/opt/actions-runners/UnsolvableOJ`
- systemd 서비스: `actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service`
- 재부팅 시 자동 시작. Node는 `setup-node`로 설치합니다.

```sh
systemctl status actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service
sudo journalctl -u actions.runner.yakisoba0728-UnsolvableOJ.hyperv-unsolvable-01.service -n 100
```

DB와 Redis는 실행마다 새 컨테이너·임의 localhost 포트·메모리 파일시스템을 사용하고 Actions가 정리합니다.
다른 저장소의 러너나 개발 DB를 사용하지 않습니다. SSH 비밀번호와 등록 토큰은 저장소에 저장하지 않습니다.
외부 fork PR 코드는 이 러너에서 실행하지 않습니다.

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
