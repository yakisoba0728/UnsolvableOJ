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
npm run test:runtime  # Docker 이미지로 8개 언어 및 메모리/OOM 회귀 검사
npm run start:dev
```

작업당 컨테이너는 네트워크가 없고, 읽기 전용 루트 파일시스템, 제거된 Linux capabilities, 프로세스·CPU·메모리 제한으로 실행됩니다. 소스와 테스트케이스는 Docker 표준 입력으로 전송되며 호스트 볼륨에 저장되지 않습니다. 컨테이너에는 실행을 위한 임시 파일시스템만 있습니다.

지원 언어: C 17, C++ 20, Java 21, Python 3, JavaScript, TypeScript, Go, Rust. Java는 `Main` 클래스를 사용합니다. 출력은 테스트당 1MB, 컴파일은 30초로 제한합니다. 실행 시간은 각 테스트의 경과 시간입니다.

Linux 실행기는 약 2ms마다 제출 프로세스와 자식들의 RSS 합계를 확인하고 문제의 `memoryMb`를 넘으면 종료해 MEMORY_LIMIT_EXCEEDED를 반환합니다. `wait4`의 최대 RSS도 확인하므로 샘플 사이에 종료한 주 프로세스의 메모리 초과를 판정할 수 있습니다. 테스트 데이터를 보유한 감시기의 메모리가 제출에 상속되어 집계되지 않도록 작은 별도 실행기(`execute.py`)에서 프로그램을 시작합니다. `memoryKb`는 샘플링과 `wait4` 측정치 중 테스트 전체에서 가장 큰 값입니다. 샘플링이므로 짧게 생겼다 사라지는 여러 자식의 동시 메모리 피크까지 정확히 합산하는 방식은 아닙니다.

Docker 메모리 제한(`max(128, 문제 제한 + 96)MB`)은 컴파일러·감시기·파일 캐시 등을 포함한 컨테이너 전체의 별도 상한입니다. 자식만 OOM으로 종료되는 경우도 cgroup v2의 `memory.events`로 감지합니다. 제출의 명시적인 SIGKILL은 메모리 초과로 오인하지 않습니다. 정상 종료·시간 초과·메모리 초과 모두 자식 프로세스를 정리하고 회수하며, Linux subreaper로 세션을 분리한 자식도 다음 테스트 전에 정리합니다.

실행기를 수정한 뒤에는 Docker 이미지를 다시 빌드해야 합니다. `JUDGE_RUNTIME_IMAGE`를 지정하면 별도 이미지 태그로 smoke test를 실행할 수 있습니다. 로컬 단위 테스트에서 Linux 전용 검사는 생략되므로 다음 명령으로 컨테이너에서도 검증하세요.

```bash
# 저장소 루트; 테스트 파일만 읽기 전용으로 연결
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 352m \
  --memory-swap 352m --cpus 1 \
  --tmpfs /tmp:rw,exec,nosuid,size=128m,mode=1777 \
  --mount "type=bind,source=$PWD/Judge/runtime/test_runner.py,target=/opt/judge/test_runner.py,readonly" \
  --entrypoint python3 unsolvable-judge-runtime:local \
  -m unittest discover -s /opt/judge -p 'test_*.py'
```

공개 예제(`isSample: true`)는 최대 5개까지 `stdout`/`stderr` 앞 1,000바이트와 잘림 여부를 `debugOutputs`에 담아 API로 전송합니다. 예제 표시가 없는 테스트는 비공개로 취급합니다. 정답 비교는 자르기 전 출력으로 수행하며 표준 오류도 1MB 제한을 적용합니다. 첫 실패 시 채점을 중단하는 기존 동작은 유지합니다.

공개 예제를 먼저 실행하고 각 그룹 안에서는 기존 순서를 유지합니다. 제출 코드가 파일에 남긴 비공개 입력을 이후 공개 예제에서 출력하는 것을 방지하기 위함입니다. 출력의 `testCase` 번호는 원래 순서를 기준으로 합니다.

워커는 10초마다 API에 생존 신호를 보내고, 제출별 채점 lease도 10초마다 연장합니다. 운영 상태와 최근 실패 작업은 관리자 API `GET /api/v1/admin/ops`에서 확인할 수 있습니다. Docker 소켓에 접근할 수 있는 워커는 API와 분리된 호스트에서 운영해야 합니다.
