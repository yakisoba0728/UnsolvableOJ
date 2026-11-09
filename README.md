# 못풀준 · UnsolvableOJ

문제 풀이와 코드 채점을 위한 온라인 저지 MVP입니다.

| 디렉터리 | 역할 |
|---|---|
| `Front/` | React/Vite 웹 UI (문제, 로그인, 제출, 작성자 문제 등록) |
| `Back/` | NestJS API, PostgreSQL 데이터, Redis/BullMQ 채점 큐 |
| `Judge/` | BullMQ 워커와 go-judge 격리 실행 서비스 |

## 로컬 실행

Node.js 24 이상과 Linux Docker(macOS는 Docker Desktop)가 필요합니다. 아래 명령은 각각 별도 터미널에서 실행합니다.

```bash
# 1. PostgreSQL과 Redis
docker compose up -d postgres redis

# 2. API
cp Back/.env.example Back/.env
(cd Back && npm install && npm run db:migration:run && npm run start:dev)

# 3. go-judge 실행 서비스 (저장소 루트)
docker compose up -d --build --wait go-judge

# 4. 채점 워커
cp Judge/.env.example Judge/.env
# Judge/.env의 JUDGE_SERVICE_TOKEN을 Back/.env와 동일하게 설정
# GO_JUDGE_TOKEN도 실행 서비스와 동일하게 설정 (로컬 기본값은 일치)
(cd Judge && npm install && npm run start:dev)

# 5. 웹 UI
(cd Front && npm install && npm run dev)
```

- 웹 UI: `http://localhost:3001`
- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- 상태 확인: `http://localhost:3000/api/v1/health`

전체 서비스를 Docker로 실행하려면 저장소 루트에서 `docker compose up -d --build`를 실행하세요. 기존 PostgreSQL·Redis 볼륨은 유지되며, API는 시작할 때 미적용 마이그레이션을 실행합니다. `docker compose ps`로 상태를 확인하고 `docker compose stop`으로 데이터 삭제 없이 중지할 수 있습니다. 포트는 localhost에만 공개하며 기본 비밀키는 로컬 개발 전용입니다.

go-judge는 privileged Linux 서비스입니다. 운영에서는 API/DB와 분리된 실행 호스트를 권장합니다. 동일 Dokploy 서버에서 전체 서비스를 실행하는 운영용 Compose와 설정·검증·백업 절차는 [운영 배포 문서](./deploy/README.md)에 있습니다. Docker 컨테이너는 호스트 간 격리를 대신하지 않으며, 자세한 제한은 [Judge 문서](./Judge/README.md)에 있습니다.

운영 실행 노드용 필수 비밀키·사설 Redis 설정과 공개 포트 없는 Compose 템플릿은 [`Judge/deploy/`](./Judge/deploy/README.md)에 있습니다. 실제 서버 배포는 별도 승인 후 진행합니다.

첫 관리자는 회원가입 후 `(cd Back && npm run db:bootstrap:admin -- admin@example.com)`으로 지정하고 **다시 로그인**합니다. 이후 웹의 **관리**(`/admin`, 관리자에게만 보임) 화면이나 관리자 API로 역할 지정·계정 정지를 할 수 있습니다. 방법은 [백엔드 문서](./Back/README.md)를 참고하세요.
로컬 데모가 필요하면 `(cd Back && npm run db:seed:demo)`를 실행하세요. 예제 문제를 게시하고 무작위 작성자 비밀번호를 출력합니다.

## 현재 범위

문제 생성, 제출, 채점 결과 확인까지의 기본 흐름을 제공합니다. 로그인한 누구나 문제를 만들어 초안이나 기업 테스트 전용 문제로 저장하고, 관리자 검수를 거쳐 공개합니다. 채점기는 C, C++, Java, Python, JavaScript, TypeScript, Go, Rust를 실행합니다.

백엔드에는 문제 수정·검수·버전 보존, 재채점·큐 복구, 첫 정답 XP·레벨·랭킹, 관리자 사용자 검색·역할 변경·계정 정지·감사 로그 검색·운영 조회, 커뮤니티 글·답변·추천·팔로우가 구현되어 있습니다. 웹에는 문제 관리·수정·공개 전환, 홈 랭킹과 학습 기록, 커뮤니티 화면, 관리자 콘솔(`/admin`: 사용자·감사 로그·운영 상태)이 있으며, 코드 분석의 로그인 기록과 미션 진행·보상·배지는 서버에 저장됩니다. 기업 테스트는 서버에 저장되며, 응시 링크로 지원자가 응시하고 담당자가 응시자별 점수와 제출 코드를 봅니다. 미션 규칙과 배포 절차는 [서버 미션 문서](./docs/missions.md)를 참고하세요. 재채점 전용 화면은 아직 없습니다. API·권한·제한을 포함한 전체 목록은 [백엔드 기능 목록](./Back/FEATURES.md)을 참고하세요.

출제 화면의 자동 복구는 계정·문제·탭 세션별이며, 탭 종료 뒤의 영구 보관을 대신하지 않습니다. 소유자를 알 수 없는 기존 로컬 초안은 자동으로 불러오거나 삭제하지 않습니다.

풀이 소스·Tab 들여쓰기 초안은 계정(비로그인은 별도 guest)·문제·언어별로 이 브라우저에 저장합니다. 계정 전환 시 편집기 메모리도 분리합니다. 기존 ownerless v1 소스/들여쓰기 키는 자동 이관·삭제하지 않으므로 필요하면 실제 소유자가 따로 복구해야 합니다. 커뮤니티 저장 중에는 입력을 잠그고, 응답이 늦거나 다른 탭의 초안이 달라졌으면 그 초안을 지우지 않습니다. 기업 테스트 저장이 서버에서 거절되면 그 이유를 보여 주고 입력을 유지합니다. 응시 중 작성한 코드는 새로고침에 대비해 응시·문제·언어별로 이 브라우저에 둡니다. 브라우저 저장소는 서버 백업이나 브라우저를 공유하는 사람 사이의 보안 경계가 아닙니다.

```bash
(cd Back && npm run check)
(cd Judge && npm run check)
(cd Front && npm run check)
# 운영용 Compose 설정 검사 (Docker daemon 불필요)
node scripts/check-production-compose.mjs
# Playwright Chromium 설치 후; 기존 개발 DB를 사용하지 않는 실제 전체 Compose 검사
node scripts/check-compose.mjs
# PostgreSQL/Redis 실행 중에만; CREATEDB 권한·별도 테스트 Redis DB 필요
# 실행마다 일회용 PostgreSQL DB를 생성하고 종료 후 삭제
(cd Back && npm run test:e2e)
```

자세한 API와 채점 계약은 [Back/README.md](./Back/README.md), 채점기 동작은 [Judge/README.md](./Judge/README.md)에 있습니다.

## 지속적 통합

GitHub Actions의 GitHub 제공 `ubuntu-24.04` 러너에서 Node 24 기반 lint·타입 검사·빌드,
백엔드/채점기 단위 테스트와 DB/API 통합 테스트를 실행합니다.
검사 범위와 러너 운영·로컬 재현 방법은 [CI 운영 문서](.github/CI.md)를 참고하세요.
