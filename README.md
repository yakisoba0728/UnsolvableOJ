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

첫 작성자 계정은 회원가입 후 로컬 DB에서 `AUTHOR`로 승격하고 **다시 로그인**해야 합니다. 방법은 [백엔드 문서](./Back/README.md)를 참고하세요.
로컬 데모가 필요하면 `(cd Back && npm run db:seed:demo)`를 실행하세요. 예제 문제를 게시하고 무작위 작성자 비밀번호를 출력합니다.

## 현재 범위

문제 게시, 제출, 채점 결과 확인까지의 기본 흐름을 제공합니다. 채점기는 C, C++, Java, Python, JavaScript, TypeScript, Go, Rust를 실행합니다. XP/레벨은 데이터 필드만 있으며 보상 처리, 문제 수정·검수, 랭킹, 커뮤니티는 아직 없습니다.

```bash
(cd Back && npm run check)
(cd Judge && npm run check)
(cd Front && npm run check)
# PostgreSQL/Redis 실행 중에만
(cd Back && npm run test:e2e)
```

자세한 API와 채점 계약은 [Back/README.md](./Back/README.md), 채점기 동작은 [Judge/README.md](./Judge/README.md)에 있습니다.
