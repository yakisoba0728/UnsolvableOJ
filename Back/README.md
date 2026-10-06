# UnsolvableOJ Backend

NestJS, PostgreSQL, Redis로 구성한 UnsolvableOJ 웹 백엔드입니다. PostgreSQL이 영속 상태의 기준이며 Redis/BullMQ는 채점 작업 전달에만 사용합니다.

모든 API, 권한, 처리 규칙, 입력 제한과 화면 연결 상태는 [백엔드 기능 목록](./FEATURES.md)에 정리되어 있습니다.

## 현재 구현 범위

- 회원가입 및 로그인(JWT access token)
- `USER`, `AUTHOR`, `ADMIN` 역할 기반 권한
- 문제와 공개/비공개 테스트케이스 저장
- 공개 문제 목록/상세 조회
- 코드 제출, 내 제출 목록/상세 조회
- Redis 기반 비동기 채점 큐
- 외부 채점 워커용 claim/result 내부 API
- 별도 `Judge/` 워커의 Docker 격리 실행 및 결과 기록
- 문제 수정 시 불변 버전 스냅샷 저장, 공개·보관 상태 관리
- 채점 세대·시도 ID·lease 기반 중복 처리 방지와 재채점
- 첫 정답 XP·레벨·랭킹, 재채점 결과에 따른 XP 정산
- 관리자 역할 변경, 감사 로그, 큐·워커 운영 조회
- PostgreSQL 마이그레이션
- 입력 검증, CORS, 보안 헤더, 요청 속도 제한
- Swagger와 PostgreSQL/Redis 상태 확인

## 구조

```text
src/
├── common/          # 공통 decorator, guard, queue 계약
├── config/          # 환경 변수 검증, Redis 설정
├── database/        # TypeORM data source와 migration
└── modules/
    ├── admin/
    ├── auth/
    ├── health/
    ├── problems/
    ├── submissions/
    └── users/
```

제출 흐름은 다음과 같습니다.

```text
Client -> POST submission -> PostgreSQL(QUEUED) -> BullMQ(submissionId)
                                                      |
                                                Judge worker
                                                      |
                      internal claim API <------------+
                      internal result API ------------> PostgreSQL(final verdict)
```

큐 메시지에 소스 코드나 비공개 테스트케이스를 넣지 않고 `submissionId`와 `generation`만 전달합니다.

## 로컬 실행

Node.js 24 이상과 Docker가 필요합니다.

```bash
# 저장소 루트
docker compose up -d
cp Back/.env.example Back/.env

cd Back
npm install
npm run db:migration:run
npm run start:dev
```

- API base URL: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`

첫 `ADMIN`은 회원가입한 계정을 CLI로 승격합니다. 승격 후 다시 로그인해야 합니다.

```bash
cd Back
npm run db:bootstrap:admin -- admin@example.com
```

로컬 데모용으로는 `npm run db:seed:demo`를 사용할 수 있습니다. `A + B` 문제와 작성자 계정을 만들고 무작위 비밀번호를 터미널에 출력합니다. 재실행하면 작성자 비밀번호가 회전합니다.
관리자는 `PATCH /api/v1/admin/users/:id/role`로 작성자와 관리자 역할을 지정할 수 있습니다. 역할 변경 시 기존 access token은 즉시 무효화됩니다.

## 주요 API

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | 없음 | 회원가입 |
| `POST` | `/api/v1/auth/login` | 없음 | 로그인 |
| `GET` | `/api/v1/problems` | 없음 | 공개 문제 목록 |
| `GET` | `/api/v1/problems/by-slug/:slug` | 없음 | 공개 문제와 예제 조회 |
| `POST` | `/api/v1/problems` | AUTHOR/ADMIN | 문제와 테스트케이스 생성(공개는 ADMIN만) |
| `GET` | `/api/v1/problems/mine` | AUTHOR/ADMIN | 내 문제 관리 목록(관리자는 전체) |
| `GET` | `/api/v1/problems/:id/manage` | 작성자/ADMIN | 비공개 테스트케이스 포함 상세 |
| `PATCH` | `/api/v1/problems/:id` | 작성자/ADMIN | 내용·테스트케이스 수정과 버전 증가 |
| `PATCH` | `/api/v1/problems/:id/status` | 작성자/ADMIN | 상태 전환(PUBLISHED 공개는 ADMIN 검수) |
| `POST` | `/api/v1/problems/:id/submissions` | USER | 제출 생성 및 채점 큐 등록 |
| `GET` | `/api/v1/submissions` | USER | 내 제출 목록 |
| `GET` | `/api/v1/submissions/:id` | USER | 내 제출 결과와 소스 조회 |
| `POST` | `/api/v1/submissions/:id/rejudge` | 작성자/ADMIN | 원래 문제 버전으로 재채점 |
| `GET` | `/api/v1/users/me` | USER | XP, 레벨, 해결 문제 수 |
| `GET` | `/api/v1/rankings` | 없음 | XP 상위 100명 |
| `GET` | `/api/v1/admin/users` | ADMIN | 최근 사용자 100명 |
| `PATCH` | `/api/v1/admin/users/:id/role` | ADMIN | 역할 변경 |
| `GET` | `/api/v1/admin/audit` | ADMIN | 최근 변경 이력 100건 |
| `GET` | `/api/v1/admin/ops` | ADMIN | 큐 상태·실패 작업·워커 상태 |

문제 수정은 `currentVersion`을 증가시키고 당시 제한과 테스트케이스를 `problem_versions`에 저장합니다. 작성자가 공개 문제를 수정하면 다시 초안이 되어 관리자 재검수가 필요합니다. 제출은 생성 당시 버전을 참조하므로 이후 수정·보관에도 원래 기준으로 채점합니다. 공개 조회에는 예제만 반환합니다.

첫 정답 XP는 BEGINNER 10, EASY 20, MEDIUM 40, HARD 80, EXPERT 160입니다. 레벨은 `1 + floor(XP / 100)`입니다. 같은 문제의 추가 정답에는 XP를 중복 지급하지 않습니다. 재채점으로 마지막 정답이 취소되면 지급 XP를 회수하고, 다른 정답 제출이 남아 있으면 유지합니다.

JSON 요청 전체 제한은 16MiB입니다. 각 필드의 길이 제한과 별도로 적용되므로 여러 대형 테스트케이스를 한 번에 보내는 경우 합계 크기도 확인하세요. 기존 `/problems/:slug` 상세 경로는 호환성을 위해 유지하지만, `mine` 등의 관리 경로와 충돌하지 않는 `/problems/by-slug/:slug`를 사용하세요.

## 채점기 연동 계약

채점 워커는 Redis의 `judge-submissions` 큐에서 `judge-submission` 작업을 소비합니다.

```json
{
  "submissionId": "uuid",
  "generation": 1
}
```

작업을 받은 워커는 UUID `attemptId`를 생성합니다. 요청마다 `X-Judge-Token`, `X-Judge-Generation`, `X-Judge-Attempt` 헤더를 넣습니다.

1. `GET /api/v1/internal/judge/submissions/:id`
   - 상태를 `JUDGING`으로 바꿉니다.
   - 언어, 소스 코드, 실행 제한, 모든 테스트케이스를 반환합니다.
   - 60초 lease를 획득하며 다른 워커의 활성 시도는 거절합니다.
2. `PATCH /api/v1/internal/judge/submissions/:id/heartbeat`
   - 실행 중 10초마다 lease를 연장합니다.
3. `PATCH /api/v1/internal/judge/submissions/:id/result`
   - 최종 판정과 실행 정보를 기록합니다.

워커는 별도 `POST /api/v1/internal/judge/heartbeat`를 10초마다 호출하며 `X-Judge-Worker`에 워커 UUID를 전송합니다. 관리자 운영 API는 최근 30초에 응답한 워커만 표시합니다. 복구 작업은 누락된 큐 작업을 재등록하고 만료된 채점 시도를 새 세대로 다시 큐에 넣습니다.

결과 예시는 다음과 같습니다.

```json
{
  "status": "ACCEPTED",
  "runtimeMs": 12,
  "memoryKb": 20480,
  "passedTestCases": 10,
  "totalTestCases": 10,
  "judgeMessage": "all test cases passed"
}
```

지원 판정값은 `ACCEPTED`, `WRONG_ANSWER`, `TIME_LIMIT_EXCEEDED`, `MEMORY_LIMIT_EXCEEDED`, `RUNTIME_ERROR`, `COMPILE_ERROR`, `OUTPUT_LIMIT_EXCEEDED`, `SYSTEM_ERROR`, `CANCELLED`입니다.

## 실행 출력 디버깅

`GET /api/v1/submissions/:id`는 제출자 본인에게 `debugOutputs`를 반환합니다.
Python `print`, C `printf`, Java `System.out`, JavaScript `console.log` 등
언어와 관계없이 표준 출력(`stdout`)과 표준 오류(`stderr`)를 수집합니다.
프론트에서는 각 문자열을 HTML로 해석하지 않고 일반 텍스트로 표시하세요.

```json
{
  "debugOutputs": [
    {
      "testCase": 1,
      "stdout": "3\n",
      "stderr": "debug message\n",
      "stdoutTruncated": false,
      "stderrTruncated": false
    }
  ]
}
```

- 공개 예제 중 실제 실행된 최대 5개만 저장합니다. `testCase`는 원래 테스트 순서의 1부터 시작하는 번호입니다.
- 각 스트림의 앞 1,000바이트를 UTF-8로 변환합니다. 잘린 출력은 `*Truncated`로 표시합니다.
- 출력 미리보기 제한은 정답 비교에 영향을 주지 않습니다. `stdout`에 추가한 디버깅 출력은 기존처럼 오답이 될 수 있으므로 진단용 메시지는 `stderr`를 사용하세요.
- 공개 예제를 비공개 테스트보다 먼저 실행해 이전 실행에서 파일에 남은 비공개 입력이 예제 출력으로 유출되지 않도록 합니다. `testCase`는 원래 테스트 순서의 번호를 유지합니다.
- 첫 실패에서 채점을 중단하므로 뒤쪽 예제는 실행되지 않을 수 있습니다. 빈 배열은 실행된 공개 예제가 없거나 이전 워커의 결과임을 뜻합니다.
- 비공개 테스트의 출력과 오류 내용은 노출하지 않습니다. 컴파일 오류는 기존 `compileOutput`을 확인합니다.
- 실행 오류·시간 초과·출력 초과에도 그때까지 수집된 공개 예제 출력을 반환합니다. 프로그램이 버퍼를 비우지 않은 출력은 남지 않을 수 있습니다.
- 목록 API에는 출력을 포함하지 않고, 재채점 시 이전 출력은 초기화합니다.
- 적용 전 `npm run db:migration:run`을 실행하고 채점 이미지를 다시 빌드하세요. 백엔드 마이그레이션 및 API를 먼저 반영한 뒤 새 워커/이미지를 적용합니다.

## 명령어

```bash
npm run start:dev             # 개발 서버
npm run db:migration:run      # migration 적용
npm run db:migration:revert   # 최근 migration 되돌리기
npm run check                 # lint + unit test + build
npm run test:e2e              # compose 인프라가 실행 중일 때 E2E
npm run test:judge-flow       # 실제 API → 큐 → Docker 채점 → DB 결과 검증
```

`test:judge-flow`는 Back과 Judge 빌드, DB 마이그레이션, 채점 이미지 빌드 후 실행합니다.
로컬 PostgreSQL/Redis가 필요하며 테스트용 API(기본 3100번 포트)와 워커를 자동으로 시작하고 종료합니다.
`REDIS_HOST`·`REDIS_PORT`로 테스트용 Redis를 지정할 수 있고, DB는 `PIPELINE_REDIS_DB`(기본 2)를 사용합니다. 해당 DB에 다른 워커를 연결하지 마세요. 생성한 테스트 계정·문제·제출은 종료 시 삭제합니다.
정답, 오답, 실행 오류, 시간 초과, 출력 초과, 컴파일 오류, 비공개 오류 차단을 실제 실행으로 검증합니다.

검증은 로컬에서 위 명령어와 `Judge/`의 `npm run check`, `npm run test:runtime`으로 실행합니다. 운영에서는 Docker 소켓 접근 권한을 가진 워커를 API 서버와 분리된 호스트에서 실행해야 합니다.

## 커뮤니티 (seongyun 프론트 연동)

`seongyun`의 `4517f08` 화면을 기준으로 연결했습니다. 기존 목록/상세/작성 레이아웃과 테마를 유지하며 코드 리뷰와 문제 연결, 작성자 수정·삭제를 추가합니다. 채점 API와 워커는 이 기능의 변경 대상이 아닙니다.

### 적용 순서

1. Back 환경의 PostgreSQL/Redis와 기존 인증 설정을 준비합니다.
2. `npm run db:migration:run`으로 `Community1791200000000`, `CommunityUi1791200001000`을 적용하고 API를 실행합니다.
3. Front를 **`VITE_DEMO_MODE=false`** 및 `VITE_API_BASE_URL=https://백엔드주소/api/v1`로 빌드합니다. Vite 환경 변수 변경 후에는 재빌드/재배포가 필요합니다. 백엔드 `CORS_ORIGIN`에도 실제 프론트 주소를 설정합니다.
4. `true` 모드는 기존 더미 데이터와 브라우저 저장소만 사용합니다. 데모 글·추천·답변은 실제 DB로 자동 이관하지 않습니다.

### 계약

기본 경로는 `/api/v1/community/posts`입니다. 목록·상세·답변·작성자 통계는 공개이며, 쓰기 및 내 상태 조회는 기존 `Authorization: Bearer <accessToken>`을 사용합니다. 사용자 ID/권한은 토큰으로 결정하며 본문에서 받지 않습니다.

| 메서드/상대 경로 | 동작 |
| --- | --- |
| GET `/` | `category`, `q`, `problemId`, `sort=latest/votes/answers`, `page`, `limit`으로 목록 조회 |
| POST `/`, PUT `/:id`, DELETE `/:id` | 글 작성, 작성자 수정, 작성자/관리자 삭제 |
| GET `/:id` | 본문·코드·태그·연결 문제·채택 답변 ID·추천/답변 수 |
| POST `/:id/view` | 방문 횟수 증가(순방문자 수 아님) |
| GET/POST `/:id/comments` | 페이지 단위 답변 조회/등록 |
| PUT/DELETE `/:id/comments/:commentId` | 작성자 수정, 작성자/관리자 삭제 |
| PUT `/:id/accepted-answer/:commentId`, DELETE `/:id/accepted-answer` | 질문 작성자만 채택/취소 |
| GET/PUT/DELETE `/:id/vote` | 내 글 추천 상태/추천/취소 |
| PUT/DELETE `/:id/comments/:commentId/vote` | 답변 추천/취소 |
| GET `/:id/interaction` | 로그인 사용자의 글 추천·저장·작성자 팔로우·답변 추천 상태 |
| PUT/DELETE `/:id/saved`, PUT/DELETE `/:id/follow` | 글 저장/취소, 작성자 팔로우/취소 |
| GET `/:id/author-stats` | 작성자의 글 수·채택 답변 수 |

카테고리는 `QUESTION`, `SOLUTION`, `REVIEW`, `FREE`, `NOTICE`입니다. 공지는 관리자만 작성하며 목록에서 우선 표시합니다. 풀이 공유는 공개 문제의 `problemId`가 필수이고, 코드 리뷰는 `code`, `language`가 필수입니다. 기존 글의 카테고리는 수정하지 않습니다.

```json
{
  "category": "REVIEW",
  "title": "반복문 최적화 질문",
  "body": "이 코드의 시간 복잡도를 개선하고 싶습니다.",
  "tags": ["파이썬", "최적화"],
  "code": "print(1)",
  "language": "Python",
  "problemId": null
}
```

제목 150자, 본문 20,000자, 코드 30,000자, 언어 40자, 태그 최대 5개/각 30자, 답변 10,000자 제한입니다. 프론트 제목은 기존 디자인의 100자 제한을 유지합니다. 목록은 본문·코드를 포함하지 않고 `{items,total,page,limit,totalPages}`를 반환합니다. 작성자 공개 정보는 ID·사용자명·레벨이며, 구현되지 않은 티어/명성을 임의로 만들지 않습니다. 비공개 문제의 상세 정보는 반환하지 않습니다.

추천·저장·팔로우 PUT/DELETE는 반복 호출해도 중복되지 않습니다. 답변 채택은 같은 질문의 답변만 가능하며, 삭제 시 채택 연결도 해제됩니다. 글과 답변의 초안은 **계정과 글별 로컬 브라우저 저장소**에 저장합니다. 풀이 본문은 스포일러 접기로 제공하며 HTML 실행은 허용하지 않습니다. 저장/팔로우는 상태를 영속화하며 별도의 내 저장글 목록·알림 기능은 포함하지 않습니다.

### 검증 명령

- Back: `npm run check`, `npm run test:e2e`, `npm run test:migrations` (격리 DB/Redis 권장).
- Front: `npm run check`, `npm run test:e2e -- --project=chromium --workers=1 tests/community.spec.ts tests/user-flows.spec.ts`.
- 실제 브라우저↔API 테스트: 격리 DB에 마이그레이션 후 API를 실행하고 Front 실행 환경에 `COMMUNITY_TEST_API`와 `VITE_API_BASE_URL`을 같은 API 주소로 지정합니다. `VITE_DEMO_MODE=false`로 `npm run test:e2e -- --project=chromium --workers=1 tests/community-live.spec.ts`를 실행합니다. 백엔드 CORS에 `http://127.0.0.1:4173`을 허용해야 합니다.
- 실제 테스트는 두 테스트 계정을 만들며, 생성 글은 종료 시 삭제합니다. 계정은 테스트 DB에 남으므로 운영 DB에서 실행하지 마세요. DB 검증의 대량 입력 테스트에서만 요청 속도 제한을 비활성화하며 실제 브라우저 테스트는 정상 제한을 적용합니다.
