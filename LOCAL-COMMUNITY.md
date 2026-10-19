# 커뮤니티 로컬 실행

저장소 루트에서 Docker Desktop 실행 후:

```powershell
docker compose -f compose.community.yaml up -d --build --wait
```

- 화면: http://localhost:3109/community
- API/상태: http://localhost:3108/api/v1/health
- 회원가입 후 질문·자유·코드 리뷰를 작성할 수 있습니다. 풀이 공유에는 공개된 문제가 필요합니다. 새 로컬 DB에는 팀원의 문제 데이터가 자동으로 복사되지 않습니다.
- PostgreSQL: `127.0.0.1:55432`, DB `unsolvable_community`, 사용자 `unsolvable`, 비밀번호 `local_password` (로컬 전용).
- Redis: `127.0.0.1:56379`, DB 0. 컨테이너 안에서는 각각 `postgres:5432`, `redis:6379`에 연결합니다.
- API 시작 시 누락된 마이그레이션을 적용합니다. 프론트는 같은 주소의 `/api/v1` 프록시를 사용합니다.
- PostgreSQL과 Redis는 이름 있는 볼륨에 저장되므로 컨테이너 재시작 후에도 데이터가 유지됩니다.
- 중지: `docker compose -f compose.community.yaml stop`. 재개: 위 실행 명령. `down -v`는 저장 데이터를 삭제하므로 사용하지 마세요.
- 이 구성의 포트는 이 컴퓨터에서만 접근 가능합니다. 비밀번호와 토큰은 로컬 개발용이며 운영에 사용하지 않습니다.
- 채점 워커는 이 구성에 포함하지 않습니다. 이번 검증 범위는 커뮤니티입니다.

## 테스트 환경

검증은 별도 `community_test` DB와 Redis DB 1을 사용합니다. 운영/사용자 DB에서 테스트를 실행하지 않습니다.

```powershell
$env:DATABASE_URL='postgresql://unsolvable:local_password@127.0.0.1:55432/community_test'
$env:REDIS_HOST='127.0.0.1'
$env:REDIS_PORT='56379'
$env:REDIS_DB='1'
npm run db:migration:run --prefix Back
npm run check --prefix Back
npm run test:e2e --prefix Back
npm run test:migrations --prefix Back
npm run check --prefix Front
```

브라우저 실제 API 테스트 실행 방법은 `Back/README.md`에 있습니다. 테스트 계정은 격리 DB에만 남습니다.

## 배포 사이트 연결

이 로컬 구성은 Vercel 사이트나 팀의 운영 DB를 변경하지 않습니다. 팀 서버의 DB 접속 정보로 마이그레이션/API를 배포하고, Vercel의 `VITE_API_BASE_URL` 및 백엔드 `CORS_ORIGIN`을 설정한 후 재배포해야 외부 사이트에서도 사용할 수 있습니다.

## 검증 기록 (2026-10-19)

- 백엔드 lint·타입·빌드와 단위 테스트 29개 통과.
- PostgreSQL 통합 테스트 12개, 마이그레이션 기존 DB 업그레이드·재실행·되돌리기·신규 설치 검사 통과.
- 실제 두 계정의 글 작성, 답변, 채택, 글/답변 추천, 저장, 팔로우, 수정, 삭제와 새로고침 후 상태 유지 검증.
- 컨테이너 PostgreSQL·Redis·API 재시작 뒤 저장 글 유지 검증. 임시 검증 글과 계정 삭제 완료.
- 높은 등급 의존성 경고는 Joi 18.3.0, source-map-js 1.2.2로 해결. 백엔드 운영 의존성 audit 경고 0개.
- 남은 사항: 프론트 수식 렌더링의 간접 KaTeX 의존성에 낮은 등급 audit 경고 4건(동일 취약점의 의존 경로)이 있습니다. 자동 수정이 주요 버전 변경/다운그레이드를 제안하여 이번 커뮤니티 변경에서는 강제 적용하지 않았습니다. 기존 ProblemsPage 정적·동적 import 중복 빌드 경고도 남아 있으며 빌드는 성공합니다.
- 검증 범위는 로컬 커뮤니티와 프론트 회귀 검사입니다. 운영 배포·학교 규모 동시접속 부하·실제 채점 워커 검증은 이번 작업에 포함하지 않습니다.

최종 프론트 검증: 전체 59개 중 커뮤니티 수정 영향 범위 38개를 마지막으로 재실행해 모두 통과했고, 나머지 21개도 통과했습니다. 발견한 수정 직후 버튼 입력 무시 문제는 로딩 중 버튼 비활성화로 해결했습니다.
