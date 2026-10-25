# UnsolvableOJ Backend

NestJS, PostgreSQL, Redis로 구성한 UnsolvableOJ 웹 백엔드입니다. PostgreSQL이 영속 상태의 기준이며 Redis/BullMQ는 채점 작업 전달에만 사용합니다.

모든 API, 권한, 처리 규칙, 입력 제한과 화면 연결 상태는 [백엔드 기능 목록](./FEATURES.md)에 정리되어 있습니다.

## 현재 구현 범위

- 회원가입 및 로그인(JWT access token)
- `USER`, `AUTHOR`, `ADMIN` 역할 기반 권한
- 문제와 공개/비공개 테스트케이스 저장
- 공개 문제 목록/상세 조회. 목록의 `solverCount`는 정답 사용자 중복 제거 수이며 `acceptanceRate`는 실제 채점 완료 제출의 정답 비율(소수 첫째 자리, 대상 없으면 `null`)입니다. 대기·채점 중·시스템 오류·취소는 비율에서 제외하며 페이지당 한 번에 집계합니다.
- 코드 제출, 내 제출 목록/상세 조회
- Redis 기반 비동기 채점 큐
- 외부 채점 워커용 claim/result 내부 API
- 별도 `Judge/` 워커의 go-judge 격리 실행 및 결과 기록
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
docker compose up -d postgres redis
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
작성자·문제·테스트케이스·v1 스냅샷은 하나의 트랜잭션으로 저장합니다. 과거 실행 중단으로 v1이 없는 경우 현재 버전이 1이고 저장된 테스트케이스가 있을 때만 순서대로 읽어 복구합니다. 이미 수정된 v2 이상의 내용으로 과거 v1을 만들지 않으며, 비어 있거나 누락된 기존 버전 이력은 오류로 중단하므로 운영자가 검증된 백업에서 복구해야 합니다. 정상적인 기존 불변 스냅샷은 재실행으로 변경하지 않습니다. 실패한 실행은 데모 계정 비밀번호도 변경하지 않습니다.
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

전용 계정은 CLI 신규 생성과 같은 트랜잭션에서 저장한 `audit_events`의 `service_account.provision.boj` 표식(계정 ID와 비밀번호 해시의 SHA-256 지문)을 확인한 경우만 재사용합니다. 이름·이메일·`AUTHOR` 역할 또는 과거 문제 반입 로그만으로는 신뢰하지 않습니다. 표식 없는 구버전 계정, 일반 계정과의 충돌, 이후 자격 증명이 바뀐 계정은 신규 문제 반입을 중단하며 비밀번호·역할·문제 소유권을 자동으로 변경하거나 데이터를 초기화하지 않습니다. 운영자는 해당 계정의 생성 경위와 자격 증명 노출 여부를 확인하고, 백업 후 별도의 검토된 절차로 충돌 계정/기존 문제 소유권을 처리한 뒤 전용 계정을 신규 생성해야 합니다. 기존 계정에 표식만 추가해 신뢰를 우회하지 마세요. 모든 문제가 동일 해시라서 건너뛰는 재실행에는 계정 채택이 필요 없으므로 구버전 계정도 변경 없이 호환됩니다. 표 내부 `<pre>` 개행 보존 등 변환 결과가 달라져 해시가 충돌하면 기존 문제를 덮어쓰지 않고 중단합니다.

`DATABASE_SSL=true`이면 TLS 인증서를 검증합니다. 신뢰할 수 없는 인증서를 우회하지 말고 서버 인증서와 신뢰 체인을 올바르게 구성하세요.

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
| `GET`   | `/api/v1/community/posts`          | 없음         | 커뮤니티 글 목록과 분류·상태별 개수      |
| `POST`  | `/api/v1/community/posts`          | USER         | 커뮤니티 글 작성(공지는 ADMIN만)         |
| `GET`   | `/api/v1/admin/users`              | ADMIN        | 최근 사용자 100명                        |
| `PATCH` | `/api/v1/admin/users/:id/role`     | ADMIN        | 역할 변경                                |
| `GET`   | `/api/v1/admin/audit`              | ADMIN        | 최근 변경 이력 100건                     |
| `GET`   | `/api/v1/admin/ops`                | ADMIN        | 큐 상태·실패 작업·워커 상태              |

문제 수정은 `currentVersion`을 증가시키고 당시 제한과 테스트케이스를 `problem_versions`에 저장합니다. 작성자가 공개 문제를 수정하면 다시 초안이 되어 관리자 재검수가 필요합니다. 제출은 생성 당시 버전을 참조하므로 이후 수정·보관에도 원래 기준으로 채점합니다. 공개 조회에는 예제만 반환합니다.

첫 정답 XP는 BEGINNER 10, EASY 20, MEDIUM 40, HARD 80, EXPERT 160입니다. 레벨은 `1 + floor(XP / 100)`입니다. 같은 문제의 추가 정답에는 XP를 중복 지급하지 않습니다. 재채점 대기·서버 오류(`SYSTEM_ERROR`)·취소(`CANCELLED`)는 기존 정답 근거와 XP를 유지하며, 최초 제출의 오류에는 XP를 지급하지 않습니다. 정상 채점으로 오답 등이 확정되고 다른 유효 정답도 없을 때만 지급 XP를 회수합니다.

이 정책은 제출별 `accepted_for_xp`에 마지막 정상 정답 근거를 보존합니다. 적용 시 채점 요청·워커를 잠시 중지하고 `npm run db:migration:run`으로 스키마를 갱신한 뒤 모든 API를 새 버전으로 교체하고 채점을 재개하세요. 이전 API와 새 API를 섞어 운영하지 마세요. 마이그레이션은 현재 정답과 기존 XP 원장으로 확인되는 근거만 반영하며, 이미 사라진 과거 정답 이력이나 회수된 XP를 추정해 복원하지 않습니다. 현재 판정이 정답이 아닌 제출에 정답 근거가 보존되어 있으면 이 필드를 제거하는 롤백도 거절합니다.

JSON 요청 전체 제한은 16MiB입니다. 각 필드의 길이 제한과 별도로 적용되므로 여러 대형 테스트케이스를 한 번에 보내는 경우 합계 크기도 확인하세요. 기존 `/problems/:slug` 상세 경로는 호환성을 위해 유지하지만, `mine` 등의 관리 경로와 충돌하지 않는 `/problems/by-slug/:slug`를 사용하세요.

프록시 뒤에서 실행할 때는 `TRUST_PROXY`에 신뢰하는 프록시 IP/CIDR을 쉼표로 지정해야 IP별 요청 제한이 분리됩니다. 기본값은 비어 있어 전달 헤더를 신뢰하지 않습니다. 프록시는 외부에서 받은 `X-Forwarded-For`를 실제 접속 IP로 덮어써야 합니다. 로컬 Compose는 API 포트를 localhost에만 공개하고 내부 사설망(`uniquelocal`)을 신뢰합니다. 외부 운영에서는 실제 프록시 주소 범위로 좁히고 API 직접 접근을 차단하세요.

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
  "totalTestCases": 10
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
- 공개 예제를 비공개 테스트보다 먼저 실행해 비공개 테스트가 실패하더라도 예제 출력을 받을 수 있게 합니다. `testCase`는 원래 테스트 순서의 번호를 유지합니다.
- 첫 실패에서 채점을 중단하므로 뒤쪽 예제는 실행되지 않을 수 있습니다. 빈 배열은 실행된 공개 예제가 없거나 이전 워커의 결과임을 뜻합니다.
- 비공개 테스트의 출력과 오류 내용은 노출하지 않습니다. 컴파일 오류는 기존 `compileOutput`을 확인합니다.
- 실행 오류·시간 초과·출력 초과에도 그때까지 수집된 공개 예제 출력을 반환합니다. 프로그램이 버퍼를 비우지 않은 출력은 남지 않을 수 있습니다.
- 목록 API에는 출력을 포함하지 않고, 재채점 시 이전 출력은 초기화합니다.

## 명령어

```bash
npm run start:dev             # 개발 서버
npm run db:migration:run      # migration 적용
npm run db:migration:revert   # 최근 migration 되돌리기
npm run check                 # lint + typecheck + unit test + build
npm run test:e2e              # compose 인프라가 실행 중일 때 E2E
npm run test:pipeline         # 임시 DB에서 API·워커 파이프라인 검사
npm run test:migrations       # 새 빌드로 마이그레이션 왕복·롤백 안전장치 검사
npm run test:operations       # 통합 실행기·nginx 설정 회귀 검사
```

`test:e2e`·`test:pipeline`은 Back을 새로 빌드한 뒤 실행마다 일회용 PostgreSQL DB를 생성·마이그레이션합니다. `DATABASE_URL` 계정에는 `CREATEDB` 권한이 필요하며 지정된 기존 DB를 마이그레이션하지 않습니다. 직접 Vitest 통합 설정을 실행하면 거절합니다. 종료 시 소유한 프로세스를 먼저 중단하고 생성한 DB만 삭제하며, 프로세스 종료를 확인하지 못하면 안전을 위해 DB를 남깁니다.
`test:pipeline`은 Judge 빌드와 `docker compose up -d --build --wait go-judge`로 실행 서비스를 준비한 다음 실행합니다. `GO_JUDGE_URL`·`GO_JUDGE_TOKEN`으로 대상 서비스를 지정하며 기본값은 로컬 Compose와 같습니다.
로컬 PostgreSQL/Redis가 필요하며 테스트 API는 임시 포트에서 시작하고, 워커도 자동으로 시작·종료합니다.
`REDIS_HOST`·`REDIS_PORT`로 테스트용 Redis를 지정할 수 있습니다. E2E는 `REDIS_DB`(기본 1), 파이프라인은 `PIPELINE_REDIS_DB`(기본 2)를 사용합니다. 해당 Redis DB에 다른 워커를 연결하지 마세요.
XP 획득 원장이 남아 있는 foundations 마이그레이션의 롤백은 중단됩니다. XP 중복 지급을 막기 위한 제한이며, 운영 데이터는 검증된 복구 절차 없이 강제 롤백하지 마세요.
정답, 오답, 실행 오류, 시간 초과, 출력 초과, 컴파일 오류, 비공개 오류 차단을 실제 실행으로 검증합니다.

검증은 로컬에서 위 명령어와 `Judge/`의 `npm run check`, `npm run test:runtime`으로 실행합니다. 워커는 Docker socket을 사용하지 않습니다. 운영에서는 privileged go-judge 실행 서비스를 API/DB와 분리된 전용 Linux 호스트에 배치해야 합니다.

## 커뮤니티

글·답변·추천·팔로우는 PostgreSQL에 저장합니다(`Community1791200000000`, `CommunityUi1791200001000` 마이그레이션). 전체 API와 입력 제한은 [기능 목록](./FEATURES.md#6-커뮤니티)에 있습니다. 브라우저에는 계정별 작성 초안만 남습니다. 예전 버전이 브라우저에만 저장한 글·답변·추천은 서버로 옮기지 않습니다.

API 규칙은 `npm run test:e2e`의 `test/community.e2e-spec.ts`가, 실제 화면과 API의 연결은 저장소 루트 `node scripts/check-compose.mjs`가 실행하는 `Front/tests-live/community-flow.spec.ts`가 검증합니다.
