import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { PageHeader } from "../components/PageHeader";
import { WeekStrip } from "../components/WeekStrip";
import { problemPath } from "../paths";
import {
  streakDays,
  learningByDay,
  submissionsByDay,
  useDocumentTitle,
  useRequest,
  useSubmissionHistory,
} from "../hooks";
import {
  CaseResults,
  JudgeRefreshNotice,
  ResultNotices,
  ResultSummary,
  useSubmissionResult,
} from "../components/JudgeResult";

export function SubmissionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const resultState = useSubmissionResult(id ?? null, session);
  const { submission, error } = resultState;
  useDocumentTitle(
    submission
      ? `${submission.problem.title ?? "제출"} 채점 결과`
      : "채점 결과",
  );
  // 연속 학습 카드는 정답일 때만 보이므로 그때만 전체 제출 기록을 받는다.
  const history = useSubmissionHistory(
    submission?.status === "ACCEPTED" && !submission.isTest ? session : null,
  );
  // 재채점은 문제 작성자와 관리자만 한다. 작성자는 내 문제 목록으로 확인한다.
  const isAuthor = session?.user.role === "AUTHOR";
  const mine = useRequest<{ id: string }[]>(
    isAuthor ? (signal) => api("/problems/mine", { signal }, session?.accessToken) : null,
    [],
    "",
    [isAuthor, session?.accessToken],
  );
  // 기업 테스트 응시 제출은 서버가 ADMIN에게만 재채점을 허용한다.
  const canRejudge =
    session?.user.role === "ADMIN" ||
    (isAuthor &&
      !submission?.attemptId &&
      mine.data.some((item) => item.id === submission?.problem.id));
  const [rejudging, setRejudging] = useState(false);
  const [rejudgeError, setRejudgeError] = useState("");
  async function rejudge() {
    if (
      !session ||
      !submission ||
      rejudging ||
      !window.confirm(
        "이 제출을 다시 채점할까요? 지금 판정은 지워지고 새 제출 뒤에 채점됩니다.",
      )
    )
      return;
    setRejudging(true);
    setRejudgeError("");
    try {
      await api(
        `/submissions/${submission.id}/rejudge`,
        { method: "POST" },
        session.accessToken,
      );
      resultState.retry();
    } catch (cause) {
      setRejudgeError(
        cause instanceof Error ? cause.message : "재채점을 요청하지 못했습니다.",
      );
    } finally {
      setRejudging(false);
    }
  }

  if (error && !submission)
    return (
      <div className="page-width empty-state">
        <JudgeRefreshNotice {...resultState} />
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
      <JudgeRefreshNotice {...resultState} />
      {canRejudge ? (
        <div className="card-actions">
          <button
            type="button"
            className="button button-outline button-small"
            disabled={rejudging}
            onClick={() => void rejudge()}
          >
            다시 채점
          </button>
          {rejudgeError ? (
            <p className="error-message" role="alert">
              {rejudgeError}
            </p>
          ) : null}
        </div>
      ) : null}
      <ResultSummary submission={submission} />
      {submission.status === "ACCEPTED" &&
      !submission.isTest &&
      !history.loading &&
      !history.error ? (
        <section className="streak-card" aria-label="연속 학습">
          <div className="streak-text">
            <strong>{streakDays(learningByDay(history.submissions))}일</strong>
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
      {/* 검증용·기업 테스트 제출은 학습 흐름(다음 문제·코드 수정)과 무관하고, 기업 전용 문제는 공개 화면이 없다. */}
      {submission.isTest ? null : (
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
                  state={
                    submission.sourceCode
                      ? {
                          restore: {
                            language: submission.language,
                            sourceCode: submission.sourceCode,
                          },
                        }
                      : undefined
                  }
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
      )}
    </div>
  );
}
