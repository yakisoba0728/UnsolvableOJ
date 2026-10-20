# go-judge 전환 타당성 조사

조사일: 2026-10-20. **구현이 아닌 조건부 타당성 검토**다. 공식 문서와 공식 저장소의 최신 릴리스 `v1.13.3` 소스를 대조했다. 조사 당시 `master`도 `4ebd2ffe9474639c665fa21cfb438f68820fe77c`였다. Context7에서 `/criyle/go-judge`를 조회했지만, 최종 사실 확인은 아래 일차 자료를 기준으로 했다. 바이너리 설치·실행, Docker 채점·DB 변경은 하지 않았다.[^release][^commits]

## 결론

> 후속 구현: `Judge/src/judge.ts`의 HTTP 연동과 Compose 실행 서비스를 추가했다. macOS arm64의 Linux/cgroup v2 Docker에서 프로토콜 회귀 34개, 실제 실행 24개(8개 언어 포함), 별도 임시 PostgreSQL/Redis의 API 통합 5개·전체 채점 파이프라인 15개·출력 흐름 7개가 통과했다. 기존 개발 DB는 변경하지 않았다. 아래 본문은 구현 전 조사 기록이며, 현재 실행 절차와 제한은 `Judge/README.md`를 기준으로 한다. Linux amd64·cgroup v1 및 원격 CI 실행은 아직 확인하지 않았다.

**실행기 교체는 가능성이 높지만, 채점 시스템 전체의 대체품은 아니다.** HTTP `POST /run`으로 컴파일과 제한된 프로그램 실행을 맡기고, 기존 TypeScript worker가 제출 소유권·heartbeat·테스트 순서·정답 비교·결과 보고를 계속 담당하는 경계가 가장 작다. `/run`의 `Accepted`는 **프로그램이 정상 종료했다는 뜻이지 정답이라는 뜻이 아니다**. `expectedOutput`, 언어 선택, 제출/테스트 식별자나 채점 점수는 API 스키마에 없다.[^api][^design][^model]

가장 큰 도입 조건은 다음과 같다.

1. **Linux 운영 환경과 실제 작동하는 cgroup controller 확보.** cgroup 실패 시 기본 fallback은 동일한 안전장치가 아니다. `-no-fallback`을 쓰더라도 `pids` controller 부재는 현재 소스에서 경고만 하므로, `/config`와 실제 제한 시험으로 확인해야 한다.[^design][^cgroup-setup]
2. **privileged 실행 서비스의 신뢰 경계 재설계.** 공식 Docker 방식은 `--privileged`이며, 공식 API 문서는 전용·신뢰 가능한 호스트와 네트워크 통제 및 인증을 요구한다. 현재 제출별 `--cap-drop ALL` 컨테이너와 같은 운영 모델로 보면 안 된다.[^install][^api]
3. **기존 판정과 측정치의 비동등성.** 현재는 wall time과 프로세스 트리 RSS 중심이고, go-judge는 CPU/wall을 별도로 제한하며 cgroup 메모리를 우선 사용한다. 수치·제한을 단위 변환만 해서 옮기면 기존 통과/실패가 달라질 수 있다.[^process][^waiter][^design]
4. **8개 언어 도구와 컴파일 산출물 전달을 직접 구성.** 공식 이미지는 실행 서비스이지 현재 언어 도구 모음이 아니다. 캐시 `fileIds`는 직접 회수해야 한다.[^image][^example]

이 조건이 충족되지 않으면 전환을 보류하는 편이 맞다. 속도 향상·격리 완전성·현재 결과와의 호환성은 이번 정적 조사로 입증하지 않았다.

## 현재 코드에서 남겨야 하는 책임

| 위치 | 확인한 현재 동작 | 전환 경계에 대한 판단 |
| --- | --- | --- |
| `Judge/src/worker.ts:42–57, 180–249` | BullMQ 소비, claim/generation/attempt, worker/lease heartbeat, 결과 PATCH, 동시성 | 그대로 유지하는 것이 최소 변경. go-judge의 내부 실행 대기열은 이 제출 프로토콜을 대체하지 않는다. |
| `Judge/src/worker.ts:60–177` | 제출마다 Docker 생성·강제 제거, 네트워크 차단, 읽기 전용 rootfs, capability 제거, PID 64, CPU 1, 메모리/스왑, 출력·전체 timeout | 외부 실행 서비스 호출로 교체 가능한 부분. 기존 전체 작업 deadline과 장애의 `SYSTEM_ERROR` 변환은 여전히 필요하다. |
| `Judge/runtime/runner.py:16–25, 206–259` | 언어별 명령, 30초 컴파일, sample 우선·순차 실행·첫 실패 중단, 바이트 `rstrip()` 비교, 최대 runtime/memory, sample 최대 5개·각 1,000바이트 디버그 | OS 실행 코드는 제거 후보지만 **이 채점 정책은 TypeScript 쪽으로 보존해야 한다**. |
| `Judge/runtime/runner.py:51–196`, `execute.py:13–33` | subreaper, `/proc` 자손 RSS 합계, 2ms polling, 프로세스 그룹/고아 정리, `wait4`, OOM kill 감지, 파일 출력 제한 | go-judge에 위임할 핵심. 삭제 전 회귀 시험이 필요하다. |
| `Judge/runtime/Dockerfile:1–13` | Ubuntu 24.04에 GCC/G++, JDK 21, Python, Node/esbuild, Go, Rust 설치 | Python supervisor는 대체 가능하지만 컴파일러·런타임 공급 책임은 사라지지 않는다. |

위 표는 로컬 파일의 정적 확인이며 변경 제안과 구분했다. 기존 timeout은 컴파일·여러 테스트를 감싸는 총 deadline과 테스트별 wall deadline의 두 층이다. 현재 메모리 컨테이너 상한은 `max(128, memoryMb + 96)` MiB이고, 제출 실행 RSS 판정은 별도로 `memoryMb * 1024` KiB다. 이 두 수치를 go-judge `memoryLimit` 하나로 동일하게 재현할 수 있다고 가정하면 안 된다.

## 공식 HTTP 계약

`POST /run`은 JSON `{ "cmd": [Cmd, ...], "pipeMapping": [...] }`를 받고 **`Result[]` 배열**을 반환한다. REST 결과는 `{results: ...}` wrapper가 아니다. 여러 `cmd`는 각각 환경을 받아 **병렬** 실행하는 그룹이며, “컴파일 후 실행”을 순서대로 연결하는 workflow가 아니다. 따라서 컴파일 결과의 `fileIds`를 받은 뒤 별도 요청으로 실행한다.[^api][^rest][^group][^worker]

| 요청 필드 | 확인한 의미 |
| --- | --- |
| `cmd[].args`, `env` | 실행 파일 및 인자 배열, `KEY=value` 환경 배열. 실행 경로·명령은 애플리케이션이 정한다. |
| `files` | 배열 index가 fd다. 통상 stdin은 `{content: "..."}`, stdout/stderr는 `{name: "stdout", max: N}` 같은 collector다. `{src: ...}`, `{fileId: ...}`도 가능하며 `null`은 pipe 연결용이다. REST 소스의 `content`는 문자열이다. |
| `cpuLimit`, `clockLimit` | 각각 CPU 시간·wall 시간, 모두 **나노초**. deprecated `realCpuLimit`도 남아 있고 설정하면 `clockLimit`을 덮어쓴다. 새 연동에서는 쓰지 않는 것이 타당하다. |
| `memoryLimit`, `stackLimit` | **바이트**. `procLimit`은 process/task 수 제한. `cpuRateLimit: 1000`은 CPU 1개분이며 서버의 `-enable-cpu-rate`가 있어야 실제 rate 제한이 설정된다. `cpuSetLimit`은 Linux cgroup CPU set이다. |
| `copyIn` | 샌드박스 파일 경로 → `{content}`, `{fileId}`, `{src}` 또는 `{symlink}`. 현재 기본 작업 경로는 `/w`이므로 기존 `/workspace` 절대경로를 그대로 재사용하지 않는다. |
| `copyOut`, `copyOutCached` | 파일명 배열. 전자는 `files` 문자열, 후자는 서버 캐시와 `fileIds`를 반환한다. 파일명 뒤 `?`는 누락을 허용한다. |
| `copyOutMax`, `copyOutTruncate` | 파일별 copy-out 크기 제한 및 초과 시 잘라내기 옵션. stdout/stderr collector 제한, POSIX 파일 크기 제한과 별개다. |
| `pipeMapping`, `tty` | 상호작용 프로그램용 연결/터미널 기능. 현재 일반 입출력 채점 교체에는 불필요하다. |
| `dataSegmentLimit`, `addressSpaceLimit` | Linux rlimit 옵션. deprecated `strictMemoryLimit`은 전자의 별칭으로 남아 있다. 메모리 측정 모델과 혼동하지 않는다. |

위 스키마·단위는 공식 API 및 `model.go`, rate 활성화 조건은 실행 소스 기준이다.[^api][^model][^environment]

결과에는 `status`, `exitStatus`, `time`(CPU ns), `runTime`(wall ns), `memory`(bytes), 선택적 `error`, `files`, `fileIds`, `fileError`, `procPeak`가 있다. `procPeak`는 공식 문서상 cgroup v2/Linux 6.1 이상 기능이다. `fileError`는 파일명·오류 유형·메시지를 제공한다. HTTP 400(잘못된 요청/빈 cmd), 404(없는 파일 참조), 500(worker 등 서버 오류)도 실행 결과의 `status`와 별도로 처리해야 한다.[^api][^rest]

### 정확한 상태 문자열과 로컬 매핑 제안

| 공식 기본 실행 상태 | 이 저장소로 변환하는 제안 |
| --- | --- |
| `Accepted` | 출력 비교 후에만 `ACCEPTED` 또는 `WRONG_ANSWER`. 컴파일 단계라면 컴파일 성공일 뿐이다. |
| `Memory Limit Exceeded` | 실행 단계 `MEMORY_LIMIT_EXCEEDED` |
| `Time Limit Exceeded` | 실행 단계 `TIME_LIMIT_EXCEEDED` — CPU 또는 wall 중 어느 쪽이 초과해도 같은 상태 |
| `Output Limit Exceeded` | 실행 단계 `OUTPUT_LIMIT_EXCEEDED` |
| `Nonzero Exit Status` | 실행 단계 `RUNTIME_ERROR` |
| `Signalled` | 실행 단계 `RUNTIME_ERROR` |
| `Dangerous Syscall` | 실행 단계 `RUNTIME_ERROR` 후보. 서비스/런타임 설정 불일치인지도 진단해야 한다. |
| `File Error` | 원인에 따라 분리. 잘못된 artifact·없어진 캐시·copy-in/out 실패를 무조건 제출 탓으로 돌리지 않는다. |
| `Internal Error` | `SYSTEM_ERROR` |

상태의 **실제 철자는 `Nonzero Exit Status`**다. README의 설명 문구 `Non Zero Exit Status`를 그대로 비교하면 안 된다. 현재 소스 enum에는 추가로 `Invalid`, `Wrong Answer`, `Partially Correct`, `Judgement Failed`, `Invalid Interaction`도 정의돼 있다. 하지만 기본 `/run` 실행 경로가 expected output을 받아 WA/부분점수를 자동 판정하는 것은 아니다. 미지원/알 수 없는 상태는 성공으로 취급하지 않는 방어적 매핑이 필요하다.[^status][^run-single][^api]

컴파일 단계의 비정상 종료·시간/메모리 초과는 기존 정책에 맞춰 `COMPILE_ERROR`로 변환하는 것이 후보지만, HTTP 실패나 서비스 초기화 실패까지 `COMPILE_ERROR`로 숨겨서는 안 된다. 이는 upstream 기능이 아니라 애플리케이션의 판정 정책이다.

## 컴파일 산출물, fileIds, 정리

공식 예시는 컴파일 요청에서 `copyOutCached: ["a"]`를 지정하고, 응답 `fileIds.a`를 다음 실행 요청의 `copyIn.a.fileId`로 전달한다. 같은 artifact로 여러 테스트를 실행할 수 있다. 소스·stdin은 작은 문자열이면 `content`로 직접 넣을 수 있어 `/file` 업로드가 필수는 아니다.[^example]

- `POST /file`은 multipart의 `file` 필드를 받는다. **현재 구현의 성공 응답은 JSON 문자열 ID 자체**이며 `{fileId: ...}` 객체가 아니다. Context7 요약의 객체 예시보다 pinned 소스를 우선해야 한다.[^file-handler]
- 캐시 API는 `GET /file`(목록), `GET /file/:fileId`(바이너리 다운로드), `DELETE /file/:fileId`(삭제)다. 삭제 성공은 200, 이미 없으면 404다.[^file-handler]
- 공식 문서는 캐시 때문에 서비스가 stateful해지며, 클라이언트가 모든 ID를 추적하고 삭제하지 않으면 메모리/스왑에 누수가 남는다고 명시한다. 성공/실패/취소 모두 `finally`에 해당하는 경로에서 **얻은 ID 전부 삭제**가 필요하다.[^api][^example]
- Linux 기본 저장소는 `/dev/shm`; `-dir`로 바꿀 수 있다. `-file-timeout`은 보조 회수 장치다. 설정값이 0이면 timeout wrapper가 붙지 않으며, 현재 timeout 구현은 `Get` 때 시간을 갱신한다. 무조건 일정 시간 후 삭제되는 고정 만료라고 가정하지 않는다.[^main][^ttl]
- **연동 제안:** 응답 유실로 ID를 못 받은 경우까지 대비한 TTL, 인스턴스별 캐시 소유권, 동일 인스턴스로 compile/run/delete 라우팅이 필요하다. `fileId`를 재시작·다른 replica 사이에서 영속 식별자로 쓰는 설계는 피한다. 이는 프로세스 로컬 파일 저장소 구현에 근거한 운영 제안이다.[^main][^filestore]
- Java의 복수 산출물 등 현재 동일 디렉터리에 남겨 두던 파일을 어떻게 전달할지는 별도 설계 항목이다. API는 명시적인 파일명 배열을 받는다. “모든 언어는 `main` 실행파일 한 개만 캐시하면 된다”는 가정은 하지 않는다.[^model]

## 시간·메모리·프로세스 트리의 의미

| 항목 | 검증한 upstream 동작 | 이 저장소에 주는 영향 |
| --- | --- | --- |
| CPU와 wall | `time`은 cgroup CPU 사용량 우선, `runTime`은 wall. CPU 사용량과 wall 경과를 각각 검사한다. `clockLimit` 0이면 waiter가 `cpuLimit`을 wall 한도로 사용한다. 기본 검사 간격은 100ms이며 설정 가능하다.[^process][^waiter][^config] | 현재 `timeMs`는 `monotonic()` wall 판정이다. CPU 한도와 wall 한도를 **명시적으로 둘 다** 정해야 한다. wall 한도만 지정하고 CPU 한도를 생략하는 요청도 안전하다고 가정하면 안 된다. |
| CPU rate | rate는 시간 총량과 별개다. `cpuRateLimit`은 enable flag가 있을 때 cgroup quota로 설정된다.[^environment][^cgroup-wrapper] | 기존 Docker `--cpus 1`을 단순히 `cpuLimit`으로 바꿀 수 없다. 여러 스레드의 합산 CPU 시간은 wall과 다를 수 있다. |
| 메모리 peak | cgroup `MaxMemory`가 성공하면 `wait4` 메모리 값을 대체한다. v1은 `memory.max_usage_in_bytes`, v2는 `memory.peak`; 공식 문서는 v2/Linux 5.19 미만에서 `wait4 maxrss` fallback을 설명한다.[^process][^design][^cg-v1][^cg-v2] | 현재 “자손 RSS 합계의 polling 최대값 + launcher의 wait4 peak”와 동일하지 않다. cgroup 메모리에는 page cache·커널 구조체 등도 포함되므로 기존 KiB 숫자와 직접 비교하지 않는다.[^kernel] |
| 메모리 강제 제한 | 실행 메모리 cgroup 한도에는 기본 16KiB extra buffer가 더해지고 최종 측정치는 요청한 `memoryLimit`과 다시 비교한다.[^run-single][^config] | 현재 Docker +96MiB supervisor 여유와 성격이 다르다. 컴파일 제한도 실행 제한과 별도로 정해야 한다. |
| 스왑 | 확인한 제한 경로는 v2 `memory.max`를 설정하며, 같은 경로에서 `memory.swap.max`를 설정하지 않는다. 커널은 이를 별도 제한으로 정의한다.[^environment][^cgroup-wrapper][^cg-v2][^kernel] | 현재 `--memory-swap == --memory`의 무스왑 정책이 자동 유지된다고 볼 수 없다. 호스트/상위 cgroup 정책을 검증해야 한다. |
| 자식과 스레드 | 요청별 cgroup에 실행 프로세스를 넣고 메모리·PID 제한을 설정한다. 자식은 부모 cgroup을 상속한다. `pids.max`는 커널 task/TID를 세므로 스레드도 포함한다.[^environment][^kernel] | fork/setsid로 프로세스 그룹을 벗어나는 문제를 `/proc` 순회보다 커널 경계에서 다룰 수 있다. JVM/Go/Rust 컴파일러 등에 맞는 `procLimit`은 직접 정한다. |
| 실행 후 정리 | pinned `go-sandbox v0.14.2`의 컨테이너 실행 코드는 종료·취소 시 namespace 내 `kill(-1, SIGKILL)` 후 자식 회수를 기다린다. go-judge 환경 풀은 반환 시 `Reset()`하고 실패하면 파기한다.[^gomod][^sandbox-exec][^pool] | 기존 subreaper/고아 정리 코드를 위임할 근거는 있다. 악성 double-fork·setsid·타임아웃 반복에서 실제 누수 없음은 이번에 실행 검증하지 않았다. |
| 출력 | collector `max`, 서버 `-output-limit`(POSIX 파일 크기), `copyOutMax`는 서로 다르다. v1.13.3 설정 소스의 output/copy-out 기본값은 모두 256MiB다. README에는 copy-out 64MiB 표기도 있어 **명시값 및 pinned 소스**를 우선한다.[^config][^collect][^readme] | 현재 stdout/stderr 각 1,000,000바이트 제한을 명시적으로 옮긴다. 현재는 `>=`에서 OLE지만 collector 소스는 `>`로 초과를 판별해 경계값 회귀 시험이 필요하다. |

제안: 호환 우선이면 `runtimeMs`는 `runTime / 1e6`, `memoryKb`는 `memory / 1024`를 바탕으로 집계하되, 반올림·측정 구간까지 동일하다고 약속하지 않는다. CPU 시간으로 상품 정책을 바꾸는 일은 별도 변경으로 취급한다. 현재 정답 비교가 **바이트 기준**인 반면 inline `files`는 JSON 문자열이므로 비 UTF-8 출력의 동등성도 확인해야 한다. 필요하면 원시 다운로드 가능한 캐시 출력 경로를 검토하되 그만큼 ID 정리 책임이 늘어난다.[^api][^model][^file-handler]

## 언어 지원

go-judge는 명령 배열을 실행한다. 언어 ID를 받아 컴파일 명령을 고르거나 컴파일러를 자동 설치하는 서비스가 아니다. 공식 예제도 컨테이너 안에 `g++` 설치를 전제하고, 설치 문서는 사용자 이미지에 compiler를 설치하는 방법을 안내한다. 공식 릴리스 Dockerfile은 Debian base + go-judge/mount 파일 복사뿐이다.[^model][^example][^install][^image]

따라서 현재 C/C++/Java/Python/JavaScript/TypeScript/Go/Rust는 **필요한 도구가 설치되고 mount/환경/리소스가 맞으면 같은 HTTP 실행 모델로 수용할 수 있다**는 결론이다. 8종 실제 호환성이 확인된 것은 아니다. 기존 C17·C++20·JDK 21·esbuild 명령과 버전을 보존하고 `/workspace`→`/w`, HOME/GOCACHE/GOPATH/TMPDIR 및 Java classpath를 조정해야 한다. JVM·Node의 가상 주소 공간 요구 때문에 `addressSpaceLimit`을 모든 언어에 일괄 적용하는 결정도 검증 없이 하지 않는다.

## 격리와 운영 안전성

- **공식 전제:** Linux kernel ≥3.10, `/sys/fs/cgroup` mount. v1은 cgroup 생성 권한/위임, v2는 systemd D-Bus transient scope 또는 현재 cgroup에서 nesting 설정 경로가 있다. 배포판의 user namespace·AppArmor 정책도 영향을 준다. 공식 CI가 user namespace와 AppArmor 설정을 조정하는 것은 모든 기본 배포 설정에서 작동한다는 보장이 없음을 보여준다.[^design][^cgroup-setup][^ci]
- **Docker와 capability를 분리해서 판단:** 공식 Docker 예제의 `--privileged`는 중첩 sandbox를 만드는 **서비스 컨테이너**에 부여된다. 반면 실제 제출 프로세스는 namespace 안에서 `NoNewPrivs: true`, `DropCaps: true`로 시작한다. 외부 서비스의 강한 권한이 제출에 그대로 부여된다는 뜻은 아니지만, 서비스/커널 침해의 피해 범위는 별도 위험이다. 공식 자료에서 충분한 최소 `--cap-add` 목록은 확인하지 못했다.[^install][^sandbox-exec]
- **기본 격리:** user/PID/mount/IPC/network/UTS namespace와 cgroup 경계가 사용된다. 기본 network namespace를 `-net-share`로 공유할 수 있으므로 제출 채점에서는 활성화하지 않는 것이 제안이다. 기본 Linux seccomp는 architecture-aware Moby 기반 embedded profile이다. `-no-seccomp`는 공식 문서상 troubleshooting/benchmark 용도이며 정상 서비스에 쓰지 말라고 경고한다.[^sandbox-flags][^env-linux][^seccomp]
- **API는 신뢰된 내부 호출자 전용:** 기본 auth token은 빈 값이고 설정 시 REST는 `Authorization: Bearer ...` 인증을 한다. `/file` 목록/다운로드/삭제는 동일 서비스 저장소를 다루며, `copyIn.src`는 서비스 쪽 파일을 읽는 기능이다. `-src-prefix` 제한은 있으나 사용자에게 arbitrary `/run` 요청을 전달하는 방식은 피한다. 기존 제출 source/language/input만 받아 서버가 고정 명령·경로·상한을 생성하는 경계가 필요하다.[^main][^file-handler][^model][^config]
- **파일 노출:** 기본 mount는 서비스 호스트의 `/usr`, `/bin`, `/lib` 등이다. 별도 rootfs와 읽기 전용 mount를 구성하는 공식 방법이 있다. API/DB credential, 비공개 정답 파일, Docker socket 등은 실행 rootfs에 넣지 않는 것이 제안이다.[^mount][^rootfs]
- **macOS:** native backend는 존재하지만 **공식적으로 experimental, production 금지** 경고가 있다. 이 macOS 개발 머신에서 native 실행 성공 여부로 운영 안전성을 결론낼 수 없다. 개발자가 Linux VM/Docker의 Linux backend를 이용하는 경로는 검토 후보지만 Docker Desktop의 cgroup·privileged·아키텍처별 실제 동작은 이번에 검증하지 않았다.[^design]

**악의적 제출용으로 설계된 제한 실행 서비스라는 근거는 있지만 “임의 적대 코드에 완전히 안전”하다는 보장은 없다.** 특히 privileged 배포에 대해 upstream 스스로 dedicated/trusted host, 네트워크 통제, 인증을 명시하고 cgroup fallback·seccomp 해제·macOS 운영의 위험을 경고한다. 전용 Linux 실행 노드/VM, 최신 보안 패치, 제한된 내부 API, 요청 상한·동시성·shm/캐시 관리가 전제라는 평가가 타당하다. 이것은 보안 인증이나 침투 테스트 결과가 아니다.[^api][^design][^seccomp]

## 최소 연동 경계 — 제안이며 미구현

```text
기존 BullMQ / claim / lease heartbeat
  → 언어별 고정 compile/run 명령 선택
  → POST /run: compile → fileIds 보관
  → sample 우선, 각 테스트별 POST /run: artifact + 해당 stdin만 전달
  → 상태 변환 + 기존 출력 비교 + 첫 실패 중단 + 최대값/공개 debug 집계
  → finally: 얻은 fileIds DELETE (TTL은 보조)
  → 기존 결과 PATCH / generation·attempt 검증
```

- go-judge에 expected output이나 다른 테스트 전체를 넘길 이유가 없다. 컴파일/실행·파일·계측·프로세스 정리만 위임한다. 첫 실패 중단·sample 노출 정책을 유지하려면 처음에는 테스트를 순차 HTTP 호출하는 방식이 가장 작다. `cmd[]` 병렬화는 현재 정책과 메모리/동시성 의미를 바꾸므로 범위 밖이다.[^api][^group]
- worker가 go-judge를 직접 HTTP 호출하면 Python 실행기 두 파일은 대체 후보가 되지만, `runner.py`의 비교·집계 로직까지 자동으로 사라지지는 않는다. **HTTP 모드는 OS 실행 오케스트레이션은 대체하지만 OJ 제출/채점 오케스트레이션은 대체하지 않는다.**
- 구현 시 영향 범위는 `worker.ts`의 실행 호출 및 언어/판정 어댑터, runtime image/배포·인증 설정, 기존 judge 회귀 테스트·fixture다. 연동 코드와 배포 설정은 수정하지 않았다.

### 로컬 연동부 추가 확인

- `Back/src/common/queue.constants.ts`의 큐 payload는 `submissionId`, `generation`뿐이다. `Back/src/modules/submissions/judge-internal.controller.ts`의 claim/heartbeat/result와 `dto/judge-result.dto.ts` 계약을 유지하면 백엔드·DB·프론트를 변경하지 않는 전환이 가능하다.
- 공개 출력은 최대 5개, 스트림별 앞 1,000바이트와 잘림 여부를 유지해야 한다. 원래 테스트 번호·제출 버전의 예제를 연결하는 `Back/src/modules/submissions/submissions.service.ts:160–193`과 후행 ASCII 공백만 무시하는 `Front/src/pages/SubmissionPage.tsx:16–17`도 호환 대상이다.
- 배포 변경은 `Judge/Dockerfile`, `Judge/.env.example`, `Judge/runtime/Dockerfile`, `compose.yaml`에 집중된다. HTTP 연동 시 워커의 Docker CLI/socket 의존은 제거 후보지만 go-judge 실행 노드의 높은 권한은 별도로 남는다. 루트·Back·Judge README의 실행 절차도 함께 갱신해야 한다.
- 기존 검증 재료는 `Judge/runtime/smoke-sources.json`의 8개 언어, `Judge/runtime/test_runner.py`의 자원·비공개 출력 회귀, `Back/test/judge.pipeline-spec.ts`, `Back/scripts/check-judge-flow.mjs`다. 실행 방식 변경에 맞춰 `Judge/package.json`의 검사 명령도 갱신해야 한다. 이번 조사에서는 이 테스트들을 재실행하지 않았다.
- 재채점 결과가 달라지면 `Back/src/modules/submissions/submissions.service.ts:374–421`에서 XP·해결 기록도 정산된다. 엔진의 시간·메모리 차이를 확인하기 전 기존 제출을 일괄 재채점하지 않는 것이 제안이다.
- 현재 개발 호스트는 macOS arm64다(`uname -m`). `docker info`는 Docker socket 부재로 연결에 실패했으므로 Linux VM의 cgroup/실행 권한과 실제 언어 호환성은 확인하지 못했다.

### 도입 전 최소 통과 조건

1. 실제 운영 Linux에서 `-no-fallback` startup, `/config`의 cgroup type/controller·seccomp·mount 확인. 특히 PID controller는 따로 확인한다.[^cgroup-setup][^env-linux]
2. 8개 언어의 컴파일·정상 실행·컴파일 오류, Java 복수 artifact, 런타임 경로/환경 회귀.
3. busy loop와 sleep을 분리한 CPU/wall 시험, 멀티스레드 CPU, fork/setsid/double-fork·고아·PID 고갈, 여러 자식 메모리·OOM·swap 정책 시험.
4. 출력 한도 바로 아래/같음/초과, 비 UTF-8·NUL·trailing whitespace, sample/private 출력 노출, 65,536바이트 컴파일 로그 정책 회귀.
5. compile/run 중 HTTP 단절·timeout·서버 재시작·캐시 404·worker 재시도에서 artifact 회수와 lease/결과 일관성 확인. 기존 총 deadline도 유지.

이 목록은 **후속 검증 제안**이며 실행한 테스트 목록이 아니다.

## 릴리스·라이선스·유지보수

- 조사 당시 최신 정식 릴리스는 **v1.13.3, 2026-10-13 03:27:54 UTC**. 릴리스 노트는 arm64 seccomp 수정 및 arm64 integration CI 추가를 기록한다. 최근 유지보수 활동의 근거는 있지만 지원 SLA·향후 유지보수 지속성을 의미하지 않는다. 조사 당시 GitHub API의 `archived`/`disabled`는 모두 false였다.[^release][^repo]
- main 코드의 라이선스는 **MIT**, 저작권/허가 고지 유지 조건이며 AS IS·무보증이다. embedded Moby seccomp snapshot에는 별도 **Apache-2.0** 출처/고지가 있으므로 배포 시 “전체가 MIT만”이라고 처리하지 않는다.[^license][^seccomp-license]
- 도입한다면 검증한 릴리스/이미지 digest를 고정하는 것이 제안이다. 공식 기본 Dockerfile의 `debian:latest`와 개발 문서의 최신 브랜치는 재현 가능한 compiler·보안 정책의 고정을 대신하지 않는다. 이번 조사에서 이미지 digest, 모든 전이 의존성의 라이선스, 미공개 취약점은 확인하지 않았다.[^image]

## 출처

문서는 공식 사이트, 소스는 가능하면 조사 시점 릴리스 tag로 고정했다. 이하 GitHub 링크는 모두 upstream 공식 저장소다.

[^release]: https://api.github.com/repos/criyle/go-judge/releases/latest 및 https://github.com/criyle/go-judge/releases/tag/v1.13.3
[^commits]: https://api.github.com/repos/criyle/go-judge/commits?per_page=3
[^repo]: https://api.github.com/repos/criyle/go-judge
[^api]: https://docs.goj.ac/api#rest-api-interface , https://docs.goj.ac/api#grpc-api , https://docs.goj.ac/api#client-implementation-suggestion
[^design]: https://docs.goj.ac/design#return-status , https://docs.goj.ac/design#notice , https://docs.goj.ac/design#cgroup-v2-support
[^model]: https://github.com/criyle/go-judge/blob/v1.13.3/cmd/go-judge/model/model.go
[^rest]: https://github.com/criyle/go-judge/blob/v1.13.3/cmd/go-judge/rest_executor/cmd_handler.go
[^status]: https://github.com/criyle/go-judge/blob/v1.13.3/envexec/run_status.go
[^group]: https://github.com/criyle/go-judge/blob/v1.13.3/envexec/group.go
[^worker]: https://github.com/criyle/go-judge/blob/v1.13.3/worker/worker.go
[^run-single]: https://github.com/criyle/go-judge/blob/v1.13.3/envexec/run_single.go
[^example]: https://docs.goj.ac/example#single-execution
[^file-handler]: https://github.com/criyle/go-judge/blob/v1.13.3/cmd/go-judge/rest_executor/file_handler.go
[^main]: https://github.com/criyle/go-judge/blob/v1.13.3/cmd/go-judge/main.go
[^filestore]: https://github.com/criyle/go-judge/blob/v1.13.3/filestore/file_local.go
[^ttl]: https://github.com/criyle/go-judge/blob/v1.13.3/filestore/timeout.go
[^process]: https://github.com/criyle/go-judge/blob/v1.13.3/env/linuxcontainer/envprocess_linux.go
[^environment]: https://github.com/criyle/go-judge/blob/v1.13.3/env/linuxcontainer/environment_linux.go
[^waiter]: https://github.com/criyle/go-judge/blob/v1.13.3/worker/waiter.go
[^config]: https://github.com/criyle/go-judge/blob/v1.13.3/cmd/go-judge/config/config.go 및 https://docs.goj.ac/configuration#sandbox
[^cgroup-wrapper]: https://github.com/criyle/go-judge/blob/v1.13.3/env/linuxcontainer/cgroup_wrapper_linux.go
[^cgroup-setup]: https://github.com/criyle/go-judge/blob/v1.13.3/env/env_cgroup_linux.go
[^cg-v1]: https://github.com/criyle/go-sandbox/blob/v0.14.2/pkg/cgroup/v1_linux.go
[^cg-v2]: https://github.com/criyle/go-sandbox/blob/v0.14.2/pkg/cgroup/v2_linux.go
[^kernel]: https://docs.kernel.org/admin-guide/cgroup-v2.html#memory , https://docs.kernel.org/admin-guide/cgroup-v2.html#pid , https://docs.kernel.org/admin-guide/cgroup-v2.html#processes
[^gomod]: https://github.com/criyle/go-judge/blob/v1.13.3/go.mod
[^sandbox-exec]: https://github.com/criyle/go-sandbox/blob/v0.14.2/container/container_exec_linux.go
[^sandbox-flags]: https://github.com/criyle/go-sandbox/blob/v0.14.2/pkg/forkexec/consts_linux.go
[^pool]: https://github.com/criyle/go-judge/blob/v1.13.3/env/pool/interface.go
[^collect]: https://github.com/criyle/go-judge/blob/v1.13.3/envexec/file_collect.go
[^readme]: https://github.com/criyle/go-judge/blob/v1.13.3/README.md
[^image]: https://github.com/criyle/go-judge/blob/v1.13.3/Dockerfile.goreleaser
[^install]: https://docs.goj.ac/install#docker
[^env-linux]: https://github.com/criyle/go-judge/blob/v1.13.3/env/env_linux.go
[^ci]: https://github.com/criyle/go-judge/blob/v1.13.3/.github/workflows/build.yml
[^seccomp]: https://docs.goj.ac/seccomp
[^mount]: https://docs.goj.ac/mount#container-root-file-system
[^rootfs]: https://docs.goj.ac/rootfs
[^license]: https://github.com/criyle/go-judge/blob/v1.13.3/LICENSE
[^seccomp-license]: https://github.com/criyle/go-judge/blob/v1.13.3/seccomp/README.md 및 https://github.com/criyle/go-judge/blob/v1.13.3/seccomp/NOTICE
