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

go-judge는 privileged Linux 서비스입니다. 운영에서는 API/DB와 분리된 실행 호스트에 배치하세요. 자세한 제한과 주의점은 [Judge 문서](./Judge/README.md)에 있습니다.

운영 실행 노드용 필수 비밀키·사설 Redis 설정과 공개 포트 없는 Compose 템플릿은 [`Judge/deploy/`](./Judge/deploy/README.md)에 있습니다. 실제 서버 배포는 별도 승인 후 진행합니다.

첫 관리자는 회원가입 후 `(cd Back && npm run db:bootstrap:admin -- admin@example.com)`으로 지정하고 **다시 로그인**합니다. 이후 관리자 API로 작성자 역할을 지정할 수 있습니다. 방법은 [백엔드 문서](./Back/README.md)를 참고하세요.
로컬 데모가 필요하면 `(cd Back && npm run db:seed:demo)`를 실행하세요. 예제 문제를 게시하고 무작위 작성자 비밀번호를 출력합니다.

## 현재 범위

문제 생성, 제출, 채점 결과 확인까지의 기본 흐름을 제공합니다. 작성자는 초안을 저장하고 관리자는 즉시 게시할 수 있습니다. 채점기는 C, C++, Java, Python, JavaScript, TypeScript, Go, Rust를 실행합니다.

백엔드에는 문제 수정·검수·버전 보존, 재채점·큐 복구, 첫 정답 XP·레벨·랭킹, 관리자 역할 변경·감사 로그·운영 조회, 커뮤니티 글·답변·추천·팔로우가 구현되어 있습니다. 웹에는 문제 관리·수정·공개 전환, 홈 랭킹과 학습 기록, 커뮤니티 화면이 있으며, 코드 분석·기업 테스트는 브라우저 localStorage에만 저장됩니다. 미션은 제출·코드 분석·커뮤니티 기록으로 진행률만 보여 주고 XP 보상은 지급하지 않습니다. 재채점과 관리자 운영의 전용 화면은 아직 없습니다. API·권한·제한을 포함한 전체 목록은 [백엔드 기능 목록](./Back/FEATURES.md)을 참고하세요.

출제 화면의 자동 복구는 계정·문제·탭 세션별이며, 탭 종료 뒤의 영구 보관을 대신하지 않습니다. 소유자를 알 수 없는 기존 로컬 초안은 자동으로 불러오거나 삭제하지 않습니다.

```bash
(cd Back && npm run check)
(cd Judge && npm run check)
(cd Front && npm run check)
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
