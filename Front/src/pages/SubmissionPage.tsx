import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { WeekStrip } from "../components/WeekStrip";
import { problemPath } from "../paths";
import {
  streakDays,
  submissionsByDay,
  useDocumentTitle,
  useSubmissionHistory,
} from "../hooks";
import type { Submission } from "../types";

export function SubmissionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const [submission, setSubmission] = useState<Submission | null>(null);
  useDocumentTitle(
    submission ? `${submission.problem.title ?? "제출"} 채점 결과` : "채점 결과",
  );
  const [error, setError] = useState("");
  const history = useSubmissionHistory(session);

  useEffect(() => {
    if (!session || !id) return;
    const controller = new AbortController();
    setError("");
    setSubmission(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await api<Submission>(
          `/submissions/${id}`,
          { signal: controller.signal },
          session!.accessToken,
        );
        if (controller.signal.aborted) return;
        setSubmission(next);
        if (next.status === "QUEUED" || next.status === "JUDGING")
          timer = setTimeout(() => {
            void load();
          }, 2000);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "결과를 불러오지 못했습니다.",
          );
      }
    }
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, session]);

  if (error)
    return (
      <div className="page-width empty-state">
        <p className="error-message">{error}</p>
        <Link to="/submissions">내 제출로</Link>
      </div>
    );
  if (!submission)
    return (
      <div className="page-width empty-state">
        제출 결과를 불러오는 중입니다…
      </div>
    );
  return (
    <div className="page-width result-page">
      <PageHeader
        back={{ to: "/submissions", label: "내 제출" }}
        title={submission.problem.title ?? "제출 결과"}
        description={`제출 ${submission.id.slice(0, 8).toUpperCase()} · ${new Date(submission.createdAt).toLocaleString("ko-KR")}`}
      />
      <div className="result-summary">
      <div
        className={`result-banner result-${submission.status.toLowerCase()}`}
      >
        <div>
          <span className="result-label">채점 결과</span>
          <strong>{submission.status.replaceAll("_", " ")}</strong>
          {submission.totalTestCases > 0 ? (
            <div className="result-progress">
              <span>
                테스트 {submission.passedTestCases} / {submission.totalTestCases}{" "}
                통과
              </span>
              <div
                className="progress"
                role="progressbar"
                aria-label="통과한 테스트 비율"
                aria-valuemin={0}
                aria-valuemax={submission.totalTestCases}
                aria-valuenow={submission.passedTestCases}
              >
                <span
                  style={{
                    width: `${(submission.passedTestCases / submission.totalTestCases) * 100}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
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
          <strong>{submission.language}</strong>
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
      {submission.status === "ACCEPTED" ? (
        <section className="streak-card" aria-label="연속 학습">
          <div className="streak-text">
            <strong>{streakDays(submissionsByDay(history.submissions))}일</strong>
            <span>연속 학습 중이에요. 내일도 이어가 보세요!</span>
          </div>
          <WeekStrip counts={submissionsByDay(history.submissions)} />
        </section>
      ) : null}
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
      {submission.debugOutputs && submission.debugOutputs.length > 0 ? (
        <section className="source-section">
          <h2>실행 출력</h2>
          <p className="muted">
            실행된 공개 예제의 출력입니다. 비공개 테스트 출력은 표시하지 않습니다.
          </p>
          {submission.debugOutputs.map((output) => (
            <div className="notice" key={output.testCase}>
              <h3>테스트 {output.testCase} · 공개 예제</h3>
              <strong>표준 출력 (stdout)</strong>
              <pre className="source-code">{output.stdout || "(출력 없음)"}</pre>
              {output.stdoutTruncated ? (
                <p>출력이 길어 앞부분만 표시합니다.</p>
              ) : null}
              <strong>오류 출력 (stderr)</strong>
              <pre className="source-code">{output.stderr || "(출력 없음)"}</pre>
              {output.stderrTruncated ? (
                <p>오류 출력이 길어 앞부분만 표시합니다.</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      <section className="source-section">
        <div className="section-heading">
          <div>
            <h2>제출한 코드</h2>
          </div>
        </div>
        <pre className="source-code">{submission.sourceCode}</pre>
      </section>
      <div className="card-actions result-actions">
        {submission.status === "ACCEPTED" ? (
          <>
            <Link className="button" to="/problems">
              다음 문제 찾기
            </Link>
            <Link className="button button-outline" to="/profile">
              내 학습 기록
            </Link>
          </>
        ) : (
          <>
            {submission.problem.slug ? (
              <Link
                className="button"
                to={problemPath(submission.problem.slug)}
              >
                코드 수정하고 다시 풀기
              </Link>
            ) : null}
            <Link className="button button-outline" to="/submissions">
              제출 내역
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
