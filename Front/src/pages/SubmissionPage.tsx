import { Link, useParams } from "react-router-dom";
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
import {
  CaseResults,
  ResultNotices,
  ResultSummary,
  useSubmissionResult,
} from "../components/JudgeResult";

export function SubmissionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const { submission, error } = useSubmissionResult(id ?? null, session);
  useDocumentTitle(
    submission
      ? `${submission.problem.title ?? "제출"} 채점 결과`
      : "채점 결과",
  );
  const history = useSubmissionHistory(session);

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
      <ResultSummary submission={submission} />
      {submission.status === "ACCEPTED" ? (
        <section className="streak-card" aria-label="연속 학습">
          <div className="streak-text">
            <strong>
              {streakDays(submissionsByDay(history.submissions))}일
            </strong>
            <span>연속 학습 중이에요. 내일도 이어가 보세요!</span>
          </div>
          <WeekStrip counts={submissionsByDay(history.submissions)} />
        </section>
      ) : null}
      <ResultNotices submission={submission} />
      <CaseResults submission={submission} />
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
                코드 수정하기
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
