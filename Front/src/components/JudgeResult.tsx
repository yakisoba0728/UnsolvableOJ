import { useEffect, useState } from "react";
import { verdictLabel } from "../verdict";
import { api, ApiError } from "../api";
import { LANGUAGE_LABELS, type Session, type Submission } from "../types";

/** Match the runner's bytes.rstrip(): only trailing ASCII whitespace is ignored. */
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

  useEffect(() => {
    setSubmission(null);
    setError("");
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
        setError(
          (cause instanceof Error
            ? cause.message
            : "결과를 불러오지 못했습니다.") +
            (retry ? " 잠시 후 다시 확인합니다." : ""),
        );
        if (retry) {
          failures += 1;
          schedule(
            Math.max(
              Math.min(30_000, 2000 * 2 ** (failures - 1)),
              cause instanceof ApiError ? cause.retryAfterMs ?? 0 : 0,
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
  }, [id, session]);

  return { submission, error };
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
        <span className="result-symbol">
          {submission.status === "ACCEPTED"
            ? "✓"
            : submission.status === "QUEUED" || submission.status === "JUDGING"
              ? "…"
              : "!"}
        </span>
      </div>
      <div className="result-stats">
        <div>
          <small>언어</small>
          <strong>{LANGUAGE_LABELS[submission.language] ?? submission.language}</strong>
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
            {submission.memoryKb === null ? "—" : `${submission.memoryKb}KB`}
          </strong>
        </div>
        <div>
          <small>통과</small>
          <strong>
            {submission.passedTestCases} / {submission.totalTestCases}
          </strong>
        </div>
      </div>
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

/** 공개 예제별 입력·기대 출력·내 출력 */
export function CaseResults({ submission }: { submission: Submission }) {
  return (
    <>
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
