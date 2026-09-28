# Judge worker

BullMQ의 `judge-submissions` 큐를 소비합니다. `submissionId`로 API에서 소스 코드와 테스트케이스를 가져온 뒤, 일회용 Docker 컨테이너에서 컴파일·실행하고 판정을 기록합니다.

```bash
# 저장소 루트
docker build -t unsolvable-judge-runtime:local Judge/runtime
cp Judge/.env.example Judge/.env
# JUDGE_SERVICE_TOKEN을 Back/.env의 값과 일치시키세요.
cd Judge
npm install
npm run check
npm run test:runtime  # Docker 이미지로 8개 언어 smoke test
npm run start:dev
```

작업당 컨테이너는 네트워크가 없고, 읽기 전용 루트 파일시스템, 제거된 Linux capabilities, 프로세스·CPU·메모리 제한으로 실행됩니다. 소스와 테스트케이스는 Docker 표준 입력으로 전송되며 호스트 볼륨에 저장되지 않습니다. 컨테이너에는 실행을 위한 임시 파일시스템만 있습니다.

지원 언어: C 17, C++ 20, Java 21, Python 3, JavaScript, TypeScript, Go, Rust. Java는 `Main` 클래스를 사용합니다. 출력은 테스트당 1MB, 컴파일은 30초로 제한합니다. 실행 시간은 각 테스트의 프로세스 실행 시간입니다. `memoryKb`는 각 실행 프로세스의 최대 RSS 중 가장 큰 값이며, 컨테이너 메모리 제한은 컴파일러와 런타임 전체에 적용됩니다.

워커는 10초마다 API에 생존 신호를 보내고, 제출별 채점 lease도 10초마다 연장합니다. 운영 상태와 최근 실패 작업은 관리자 API `GET /api/v1/admin/ops`에서 확인할 수 있습니다. Docker 소켓에 접근할 수 있는 워커는 API와 분리된 호스트에서 운영해야 합니다.
