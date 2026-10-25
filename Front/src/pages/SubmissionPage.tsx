import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
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
  // 연속 학습 카드는 정답일 때만 보이므로 그때만 전체 제출 기록을 받는다.
  const history = useSubmissionHistory(
    submission?.status === "ACCEPTED" ? session : null,
  );

  if (error && !submission)
    return (
      <div className="page-width empty-state">
        <p className="error-message" role="alert">
          {error}
        </p>
        <Link to="/submissions">내 제출로</Link>
      </div>
    );
  if (!submission)
    return (
      <div className="page-width result-page">
        <SkeletonRegion label="제출 결과를 불러오는 중입니다">
          <Skeleton width={260} height={34} style={{ margin: "8px 0 24px" }} />
          <div className="result-skeleton-grid">
            <Skeleton height={120} radius={14} />
            <Skeleton height={120} radius={14} />
          </div>
          <Skeleton height={200} radius={14} style={{ marginTop: 16 }} />
        </SkeletonRegion>
      </div>
    );
  return (
    <div className="page-width result-page">
      <PageHeader
        back={{ to: "/submissions", label: "내 제출" }}
        title={submission.problem.title ?? "제출 결과"}
        description={`제출 ${submission.id.slice(0, 8).toUpperCase()} · ${new Date(submission.createdAt).toLocaleString("ko-KR")}`}
      />
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <ResultSummary submission={submission} />
      {submission.status === "ACCEPTED" && !history.loading && !history.error ? (
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
