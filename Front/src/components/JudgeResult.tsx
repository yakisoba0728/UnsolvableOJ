import { useCallback, useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { verdictLabel } from "../verdict";
import { api, ApiError } from "../api";
import { LANGUAGE_LABELS, type Session, type Submission } from "../types";
import {
  invalidResourceIdMessage,
  isInvalidResourceId,
} from "../resourceErrors";

/** 채점기의 bytes.rstrip()과 맞춘다: 끝에 붙은 ASCII 공백만 무시한다. */
const normalizeOutput = (text: string) => text.replace(/[\t\n\v\f\r ]+$/, "");

function IoBlock({
  label,
  text,
  tone,
  note,
}: {
  label: string;
  text: string;
  tone?: "good" | "bad";
  note?: string;
}) {
  return (
    <div className={`io-block ${tone ?? ""}`}>
      <strong>{label}</strong>
      <CopyButton label={`${label} 복사`} text={text} />
      <pre className="source-code">{text || "(없음)"}</pre>
      {note ? <small className="muted">{note}</small> : null}
    </div>
  );
}

/** 채점 중에는 폴링하고, 일시적인 실패는 최대 5회까지 간격을 늘려 재시도한다. */
export function useSubmissionResult(
  id: string | null,
  session: Session | null,
) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [retryIndex, setRetryIndex] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [invalidId, setInvalidId] = useState(false);
  const identity = `${session?.accessToken ?? ""}:${id ?? ""}`;
  const identityRef = useRef(identity);
  const retry = useCallback(() => setRetryIndex((value) => value + 1), []);

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      setSubmission(null);
      setLastUpdated(null);
    }
    setError("");
    setRetrying(false);
    setInvalidId(false);
    if (!session || !id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    function schedule(delay: number) {
      const due = Date.now() + delay;
      const tick = () => {
        if (controller.signal.aborted) return;
        const remaining = due - Date.now();
        if (remaining > 0)
          timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
        else void load();
      };
      timer = setTimeout(tick, Math.min(delay, 2_147_483_647));
    }
    async function load() {
      if (!controller.signal.aborted) setRetrying(true);
      try {
        const next = await api<Submission>(
          `/submissions/${id}`,
          { signal: controller.signal },
          session!.accessToken,
        );
        if (controller.signal.aborted) return;
        failures = 0;
        setError("");
        setSubmission(next);
        setLastUpdated(Date.now());
        setRetrying(false);
        if (isJudging(next)) schedule(2000);
      } catch (cause) {
        if (
          controller.signal.aborted ||
          (cause instanceof Error && cause.name === "AbortError")
        )
          return;
        const transient =
          cause instanceof TypeError ||
          (cause instanceof ApiError &&
            (cause.status === 429 ||
              (cause.status >= 500 && cause.status <= 599)));
        const retry = transient && failures < 5;
        setRetrying(retry);
        const malformed = isInvalidResourceId(cause);
        setInvalidId(malformed);
        setError(
          (malformed
            ? invalidResourceIdMessage
            : cause instanceof Error
              ? cause.message
              : "결과를 불러오지 못했습니다.") +
            (retry ? " 잠시 후 다시 확인합니다." : ""),
        );
        if (retry) {
          failures += 1;
          schedule(
            Math.max(
              Math.min(30_000, 2000 * 2 ** (failures - 1)),
              cause instanceof ApiError ? (cause.retryAfterMs ?? 0) : 0,
            ),
          );
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id, session, identity, retryIndex]);

  const current = identityRef.current === identity && session && id;
  return {
    submission: current ? submission : null,
    error: current ? error : "",
    retry,
    retrying,
    invalidId: Boolean(current && invalidId),
    lastUpdated: current ? lastUpdated : null,
  };
}

export function JudgeRefreshNotice({
  error,
  retry,
  retrying,
  lastUpdated,
  invalidId = false,
}: {
  error: string;
  retry: () => void;
  retrying: boolean;
  lastUpdated: number | null;
  invalidId?: boolean;
}) {
  return (
    <>
      {error ? (
        <div className="error-message" role="alert">
          <p>{error}</p>
          {lastUpdated ? (
            <p>표시된 결과는 마지막 확인 당시 상태입니다.</p>
          ) : null}
          {!retrying && !invalidId ? (
            <button
              type="button"
              className="button button-outline"
              onClick={retry}
            >
              다시 확인
            </button>
          ) : null}
        </div>
      ) : null}
      {lastUpdated ? (
        <p className="judge-last-updated muted">
          마지막 확인: {new Date(lastUpdated).toLocaleTimeString("ko-KR")}
        </p>
      ) : null}
    </>
  );
}

function JudgeElapsed({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <p className="judge-last-updated muted">
      제출 후 {Math.floor(seconds / 60)}분 {seconds % 60}초 경과 (기기 시각
      기준, 완료 예상 시간이 아닙니다)
    </p>
  );
}

export const isJudging = (submission: Submission) =>
  submission.status === "QUEUED" || submission.status === "JUDGING";

/** 판정 배너와 언어·시간·메모리·통과 수 */
export function ResultSummary({ submission }: { submission: Submission }) {
  return (
    <div className="result-summary">
      <div
        className={`result-banner result-${submission.status.toLowerCase()}`}
      >
        <div>
          <span className="result-label">채점 결과</span>
          <strong>{verdictLabel(submission.status)}</strong>
        </div>
        <span className="result-symbol" aria-hidden="true">
          {submission.status === "ACCEPTED"
            ? "✓"
            : submission.status === "QUEUED" || submission.status === "JUDGING"
              ? "…"
              : "✕"}
        </span>
      </div>
      <div className="result-stats">
        <div>
          <small>언어</small>
          <strong>
            {LANGUAGE_LABELS[submission.language] ?? submission.language}
          </strong>
        </div>
        <div>
          <small>실행 시간</small>
          <strong>
            {submission.runtimeMs === null ? "—" : `${submission.runtimeMs}ms`}
          </strong>
        </div>
        <div>
          <small>메모리</small>
          <strong>
            {submission.memoryKb === null
              ? "—"
              : `${(submission.memoryKb / 1024).toFixed(1)}MB`}
          </strong>
        </div>
        <div>
          <small>통과</small>
          <strong>
            {submission.passedTestCases} / {submission.totalTestCases}
          </strong>
        </div>
      </div>
      {isJudging(submission) ? (
        <JudgeElapsed createdAt={submission.createdAt} />
      ) : null}
    </div>
  );
}

/** 채점 메시지와 컴파일 출력 */
export function ResultNotices({ submission }: { submission: Submission }) {
  return (
    <>
      {submission.judgeMessage ? (
        <div className="notice">
          <strong>채점 메시지</strong>
          <p>{submission.judgeMessage}</p>
        </div>
      ) : null}
      {submission.compileOutput ? (
        <div className="notice">
          <strong>컴파일 출력</strong>
          <pre>{submission.compileOutput}</pre>
        </div>
      ) : null}
    </>
  );
}

/** 테스트별 판정 표와 공개 예제별 입력·기대 출력·내 출력 */
export function CaseResults({ submission }: { submission: Submission }) {
  const tests = submission.testResults ?? [];
  const failed = tests.find((test) => test.status !== "ACCEPTED");
  return (
    <>
      {tests.length > 0 ? (
        <section className="source-section case-results">
          <h2>테스트별 결과</h2>
          {failed ? (
            <p className="test-failed">
              <strong>{failed.testCase}번 테스트에서 실패</strong> (
              {failed.isSample ? "예제" : "비공개"},{" "}
              {verdictLabel(failed.status)})
            </p>
          ) : null}
          <p className="muted">
            테스트는 예제부터 실행하고 첫 실패에서 멈춰요. 비공개 테스트는
            번호와 판정, 시간, 메모리만 보여 드려요.
          </p>
          <div className="test-results-scroll">
            <table className="test-results-table">
              <thead>
                <tr>
                  <th scope="col">번호</th>
                  <th scope="col">종류</th>
                  <th scope="col">판정</th>
                  <th scope="col">시간</th>
                  <th scope="col">메모리</th>
                </tr>
              </thead>
              <tbody>
                {[...tests]
                  .sort((left, right) => left.testCase - right.testCase)
                  .map((test) => (
                    <tr key={test.testCase}>
                      <td>{test.testCase}</td>
                      <td>
                        <span
                          className={`case-pill ${test.isSample ? "sample" : "hidden"}`}
                        >
                          {test.isSample ? "예제" : "비공개"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`verdict verdict-${test.status.toLowerCase()}`}
                        >
                          {verdictLabel(test.status)}
                        </span>
                      </td>
                      <td>{test.runtimeMs}ms</td>
                      <td>{(test.memoryKb / 1024).toFixed(1)}MB</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {submission.debugOutputs && submission.debugOutputs.length > 0 ? (
        <section className="source-section case-results">
          <h2>케이스별 입력과 출력</h2>
          <p className="muted">
            제출 당시 문제 버전의 공개 예제와 내 코드의 출력을 보여 드려요.
            비공개 테스트의 입력과 출력은 표시하지 않습니다.
          </p>
          {[...submission.debugOutputs]
            .sort((left, right) => left.testCase - right.testCase)
            .map((output, index) => {
              const sample = submission.sampleTestCases?.find(
                (item) => item.testCase === output.testCase,
              );
              const same =
                sample && !output.stdoutTruncated
                  ? normalizeOutput(output.stdout) ===
                    normalizeOutput(sample.expectedOutput)
                  : null;
              return (
                <div className="case-result" key={output.testCase}>
                  <div className="case-result-head">
                    <h3>예제 {index + 1}</h3>
                    {same === null ? null : (
                      <span
                        className={`case-pill ${same ? "match" : "mismatch"}`}
                      >
                        {same ? "기대 출력과 같아요" : "기대 출력과 달라요"}
                      </span>
                    )}
                  </div>
                  <div className={`case-io ${sample ? "three" : ""}`}>
                    {sample ? (
                      <IoBlock label="입력" text={sample.input} />
                    ) : null}
                    {sample ? (
                      <IoBlock label="기대 출력" text={sample.expectedOutput} />
                    ) : null}
                    <IoBlock
                      label="내 출력"
                      text={output.stdout}
                      tone={same === false ? "bad" : same ? "good" : undefined}
                      note={
                        output.stdoutTruncated
                          ? "출력이 길어 앞부분만 표시합니다."
                          : undefined
                      }
                    />
                  </div>
                  {output.stderr ? (
                    <IoBlock
                      label="오류 출력 (stderr)"
                      text={output.stderr}
                      tone="bad"
                      note={
                        output.stderrTruncated
                          ? "오류 출력이 길어 앞부분만 표시합니다."
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              );
            })}
        </section>
      ) : null}
    </>
  );
}
