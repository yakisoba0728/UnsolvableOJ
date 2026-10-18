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

## BOJ 한국어 문제 반입

적격성 감사 결과(`summary.json`, `eligible_problem_ids.json`)와 원본 데이터셋을 사용합니다. `Back/.env`의 DB에 연결하며, 기본 실행은 변환·검증만 하고 DB를 변경하지 않습니다.

```bash
npm run db:import:boj -- --dataset /path/to/boj_dataset --audit /path/to/boj_import_audit --output reports/boj-import --status PUBLISHED
# 모든 INSERT와 스냅샷을 검증한 다음 롤백
npm run db:import:boj -- --dataset /path/to/boj_dataset --audit /path/to/boj_import_audit --output reports/boj-import --status PUBLISHED --rollback-check
# 실제 반영
npm run db:import:boj -- --dataset /path/to/boj_dataset --audit /path/to/boj_import_audit --output reports/boj-import --status PUBLISHED --apply
```

`--status` 기본값은 `DRAFT`입니다. 샘플만 `is_sample=true`로 저장하고 줄바꿈을 LF로 통일합니다. HTML은 표·수식·첨자·이미지를 보존하는 Markdown으로 변환하며, 영상과 동적 시각 자료는 링크로 연결합니다. 원문 링크와 공개 예제 전용 안내를 본문에 표시합니다.

브론즈/실버/골드/플래티넘/다이아·루비를 입문/쉬움/보통/어려움/전문가에 대응시키며, 미평가는 임시 보통으로 분류하고 본문에 표시합니다. 원본 난이도, 태그, 원본 HTML 해시와 반입 해시는 `problem_versions.snapshot.importMetadata`에 보존합니다.

하나의 트랜잭션에서 전용 `boj_import` 작성자, 문제, 예제, 버전, 감사 로그를 저장합니다. 전용 작성자는 무작위 비밀번호를 해시로 저장하고 비밀번호를 출력하지 않습니다. 동일한 반입 해시의 기존 slug는 건너뛰고, 다른 내용의 충돌은 전체 반입을 중단합니다. 재실행으로 기존 문제를 덮어쓰지 않습니다. `--apply` 전 대상 DB를 백업하세요. 결과와 반입 ID는 `--output`의 `import-result.json`에 저장됩니다.

변환 회귀 검사는 `npm run test:boj-import`로 실행합니다.

## 주요 API

| Method  | Path                               | 인증         | 설명                                     |
| ------- | ---------------------------------- | ------------ | ---------------------------------------- |
| `POST`  | `/api/v1/auth/register`            | 없음         | 회원가입                                 |
| `POST`  | `/api/v1/auth/login`               | 없음         | 로그인                                   |
| `GET`   | `/api/v1/problems`                 | 없음         | 공개 문제 목록                           |
| `GET`   | `/api/v1/problems/by-slug/:slug`   | 없음         | 공개 문제와 예제 조회                    |
| `POST`  | `/api/v1/problems`                 | AUTHOR/ADMIN | 문제와 테스트케이스 생성(공개는 ADMIN만) |
| `GET`   | `/api/v1/problems/mine`            | AUTHOR/ADMIN | 내 문제 관리 목록(관리자는 전체)         |
| `GET`   | `/api/v1/problems/:id/manage`      | 작성자/ADMIN | 비공개 테스트케이스 포함 상세            |
| `PATCH` | `/api/v1/problems/:id`             | 작성자/ADMIN | 내용·테스트케이스 수정과 버전 증가       |
| `PATCH` | `/api/v1/problems/:id/status`      | 작성자/ADMIN | 상태 전환(PUBLISHED 공개는 ADMIN 검수)   |
| `POST`  | `/api/v1/problems/:id/submissions` | USER         | 제출 생성 및 채점 큐 등록                |
| `GET`   | `/api/v1/submissions`              | USER         | 내 제출 목록                             |
| `GET`   | `/api/v1/submissions/:id`          | USER         | 내 제출 결과와 소스 조회                 |
| `POST`  | `/api/v1/submissions/:id/rejudge`  | 작성자/ADMIN | 원래 문제 버전으로 재채점                |
| `GET`   | `/api/v1/users/me`                 | USER         | XP, 레벨, 해결 문제 수                   |
| `GET`   | `/api/v1/rankings`                 | 없음         | XP 상위 100명                            |
| `GET`   | `/api/v1/admin/users`              | ADMIN        | 최근 사용자 100명                        |
| `PATCH` | `/api/v1/admin/users/:id/role`     | ADMIN        | 역할 변경                                |
| `GET`   | `/api/v1/admin/audit`              | ADMIN        | 최근 변경 이력 100건                     |
| `GET`   | `/api/v1/admin/ops`                | ADMIN        | 큐 상태·실패 작업·워커 상태              |

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

## 명령어

```bash
npm run start:dev             # 개발 서버
npm run db:migration:run      # migration 적용
npm run db:migration:revert   # 최근 migration 되돌리기
npm run check                 # lint + unit test + build
npm run test:e2e              # compose 인프라가 실행 중일 때 E2E
```

검증은 로컬에서 위 명령어와 `Judge/`의 `npm run check`, `npm run test:runtime`으로 실행합니다. 운영에서는 Docker 소켓 접근 권한을 가진 워커를 API 서버와 분리된 호스트에서 실행해야 합니다.
