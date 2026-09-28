import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Submission } from "../types";

export function SubmissionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");

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
      <Link className="back-link" to="/submissions">
        ← 내 제출
      </Link>
      <span className="eyebrow">
        SUBMISSION / {submission.id.slice(0, 8).toUpperCase()}
      </span>
      <h1>{submission.problem.title ?? "제출 결과"}</h1>
      <div
        className={`result-banner result-${submission.status.toLowerCase()}`}
      >
        <div>
          <span className="eyebrow">JUDGE RESULT</span>
          <strong>{submission.status.replaceAll("_", " ")}</strong>
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
          <p className="muted">실행된 공개 예제의 출력입니다. 비공개 테스트 출력은 표시하지 않습니다.</p>
          {submission.debugOutputs.map((output) => (
            <div className="notice" key={output.testCase}>
              <h3>테스트 {output.testCase} · 공개 예제</h3>
              <strong>표준 출력 (stdout)</strong>
              <pre className="source-code">{output.stdout || '(출력 없음)'}</pre>
              {output.stdoutTruncated ? <p>출력이 길어 앞부분만 표시합니다.</p> : null}
              <strong>오류 출력 (stderr)</strong>
              <pre className="source-code">{output.stderr || '(출력 없음)'}</pre>
              {output.stderrTruncated ? <p>오류 출력이 길어 앞부분만 표시합니다.</p> : null}
            </div>
          ))}
        </section>
      ) : null}
      <section className="source-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SOURCE CODE</span>
            <h2>제출한 코드</h2>
          </div>
          <span className="muted">
            {new Date(submission.createdAt).toLocaleString("ko-KR")}
          </span>
        </div>
        <pre className="source-code">{submission.sourceCode}</pre>
      </section>
      {submission.problem.slug ? (
        <Link className="button" to={`/problems/view/${encodeURIComponent(submission.problem.slug)}`}>
          문제로 돌아가기 ↗
        </Link>
      ) : null}
    </div>
  );
}
