# 못풀준 · UnsolvableOJ

문제 풀이와 코드 채점을 위한 온라인 저지 MVP입니다.

| 디렉터리 | 역할 |
|---|---|
| `Front/` | React/Vite 웹 UI (문제, 로그인, 제출, 작성자 문제 등록) |
| `Back/` | NestJS API, PostgreSQL 데이터, Redis/BullMQ 채점 큐 |
| `Judge/` | BullMQ 워커와 Docker 격리 실행기 |

## 로컬 실행

Node.js 24 이상, Python 3, Docker가 필요합니다. 아래 명령은 각각 별도 터미널에서 실행합니다.

```bash
# 1. PostgreSQL과 Redis
docker compose up -d

# 2. API
cp Back/.env.example Back/.env
(cd Back && npm install && npm run db:migration:run && npm run start:dev)

# 3. 채점용 이미지 (저장소 루트)
docker build -t unsolvable-judge-runtime:local Judge/runtime

# 4. 채점 워커
cp Judge/.env.example Judge/.env
# Judge/.env의 JUDGE_SERVICE_TOKEN을 Back/.env와 동일하게 설정
(cd Judge && npm install && npm run start:dev)

# 5. 웹 UI
(cd Front && npm install && npm run dev)
```

- 웹 UI: `http://localhost:3001`
- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- 상태 확인: `http://localhost:3000/api/v1/health`

첫 관리자는 회원가입 후 `(cd Back && npm run db:bootstrap:admin -- admin@example.com)`으로 지정하고 **다시 로그인**합니다. 이후 관리자 API로 작성자 역할을 지정할 수 있습니다. 방법은 [백엔드 문서](./Back/README.md)를 참고하세요.
로컬 데모가 필요하면 `(cd Back && npm run db:seed:demo)`를 실행하세요. 예제 문제를 게시하고 무작위 작성자 비밀번호를 출력합니다.

## 현재 범위

문제 생성, 제출, 채점 결과 확인까지의 기본 흐름을 제공합니다. 작성자는 초안을 저장하고 관리자는 즉시 게시할 수 있습니다. 채점기는 C, C++, Java, Python, JavaScript, TypeScript, Go, Rust를 실행합니다.

백엔드에는 문제 수정·검수·버전 보존, 재채점·큐 복구, 첫 정답 XP·레벨·랭킹, 관리자 역할 변경·감사 로그·운영 조회가 구현되어 있습니다. 이 기능들의 전용 관리 화면과 커뮤니티는 아직 없습니다. API·권한·제한을 포함한 전체 목록은 [백엔드 기능 목록](./Back/FEATURES.md)을 참고하세요.

```bash
(cd Back && npm run check)
(cd Judge && npm run check)
(cd Front && npm run check)
# PostgreSQL/Redis 실행 중에만
(cd Back && npm run test:e2e)
```

자세한 API와 채점 계약은 [Back/README.md](./Back/README.md), 채점기 동작은 [Judge/README.md](./Judge/README.md)에 있습니다.

## 지속적 통합

GitHub Actions의 전용 self-hosted 러너에서 Node 24 기반 lint·타입 검사·빌드,
백엔드/채점기 단위 테스트와 DB/API 통합 테스트를 실행합니다.
검사 범위와 러너 운영·로컬 재현 방법은 [CI 운영 문서](.github/CI.md)를 참고하세요.
