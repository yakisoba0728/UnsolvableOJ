import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { WeekStrip } from "../components/WeekStrip";
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
                to={`/problems/${submission.problem.slug}`}
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
