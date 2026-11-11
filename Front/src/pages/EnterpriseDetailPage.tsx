import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { CopyButton } from "../components/CopyButton";
import { EnterpriseSchedule } from "../components/EnterpriseSchedule";
import {
  formatEnd,
  formatPeriod,
  metaLine,
  remainingText,
  statusLabel,
  statusPillClass,
  testStatus,
} from "../enterprise/model";
import {
  enterpriseApi,
  inviteUrl,
  useEnterpriseTest,
  useTestResults,
} from "../enterprise/api";
import { useEnterpriseProblems, useDocumentTitle, useNow } from "../hooks";
import { problemPath } from "../paths";
import { difficultyLabel } from "../difficulty";

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-width">
      <PageHeader
        title="테스트 상세"
        back={{ to: "/enterprise", label: "기업 테스트" }}
      />
      <div className="empty-state ent-empty">{children}</div>
    </div>
  );
}

export function EnterpriseDetailPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState("");
  const now = useNow(10_000);
  const {
    data: test,
    loading: testLoading,
    error: testError,
    retry,
  } = useEnterpriseTest(session, id);
  const { problems, loading } = useEnterpriseProblems(session);
  const liveStatus = test ? testStatus(test, now) : null;
  // 응시자가 아직 없어도 시작된 테스트는 결과를 받아, 응시가 생기면 바로 보이게 한다.
  const results = useTestResults(
    session,
    id,
    liveStatus !== null && liveStatus !== "scheduled",
  );
  const refreshResults = results.retry;
  // 진행 중에는 30초마다 다시 받는다. 탭이 숨겨져 있으면 쉬고, 돌아오면 바로 받는다.
  useEffect(() => {
    if (liveStatus !== "running") return;
    const refresh = () => {
      if (!document.hidden) refreshResults();
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [liveStatus, refreshResults]);
  useDocumentTitle(test?.title ?? "테스트 상세");

  if (!session)
    return (
      <Missing>
        <strong>로그인하면 만든 테스트를 볼 수 있어요</strong>
        <Link
          className="button"
          to="/auth"
          state={{ from: `/enterprise/${id}` }}
        >
          로그인하기 <span aria-hidden="true">→</span>
        </Link>
      </Missing>
    );
  if (!test && testLoading)
    return (
      <Missing>
        <p role="status">테스트를 불러오는 중…</p>
      </Missing>
    );
  if (!test && testError && !/찾을 수 없/.test(testError))
    return (
      <Missing>
        <strong role="alert">{testError}</strong>
        <button className="button" onClick={retry}>
          다시 시도
        </button>
      </Missing>
    );
  if (!test)
    return (
      <Missing>
        <strong>테스트를 찾을 수 없어요</strong>
        <p>삭제되었거나 이 계정이 만든 테스트가 아닙니다.</p>
        <Link className="button" to="/enterprise">
          기업 테스트로 <span aria-hidden="true">→</span>
        </Link>
      </Missing>
    );

  const status = testStatus(test, now);
  const byId = new Map(problems.map((problem) => [problem.id, problem]));
  const timeLine =
    status === "scheduled"
      ? `시작까지 ${remainingText(Date.parse(test.startsAt) - now)}`
      : status === "running"
        ? `마감까지 ${remainingText(Date.parse(test.endsAt) - now)}`
        : `${formatEnd(test)}에 마감됐어요`;

  async function remove() {
    if (
      !window.confirm(
        `‘${test!.title}’ 테스트를 삭제할까요? 삭제하면 되돌릴 수 없어요.`,
      )
    )
      return;
    try {
      await enterpriseApi.remove(session!.accessToken, test!.id);
      navigate("/enterprise");
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "테스트를 삭제하지 못했어요.",
      );
    }
  }
  const link = inviteUrl(test.inviteCode);
  const summary = results.data?.summary;
  // 테스트 정보는 처음 연 때의 값이라, 자동 갱신되는 결과의 응시자 수를 우선한다.
  const attemptCount = summary?.candidates ?? test.attemptCount;

  return (
    <div className="page-width enterprise-page">
      {saveError ? (
        <p className="error-message" role="alert">
          {saveError}
        </p>
      ) : null}
      <PageHeader
        title={test.title}
        badge={
          <span className={statusPillClass[status]}>{statusLabel[status]}</span>
        }
        description={`${metaLine(test)} · ${formatPeriod(test)}`}
        back={{ to: "/enterprise", label: "기업 테스트" }}
        aside={
          <div className="ent-actions">
            {status === "scheduled" ? (
              <Link
                className="button button-outline"
                to={`/enterprise/${test.id}/edit`}
              >
                편집
              </Link>
            ) : null}
            {/* 응시 기록이 있으면 서버가 삭제를 거절하므로 버튼을 두지 않는다. */}
            {attemptCount === 0 ? (
              <button
                className="button button-outline ent-danger"
                onClick={() => void remove()}
              >
                삭제
              </button>
            ) : null}
          </div>
        }
      />

      <div className="ent-detail-grid">
        <div className="ent-schedule-detail">
          <EnterpriseSchedule test={test} />
        </div>
        <section
          className="form-card ent-card"
          aria-labelledby="ent-problems-title"
        >
          <div className="ent-pick-head">
            <h2 id="ent-problems-title">출제 문제</h2>
            <span className="muted">
              {test.problemIds.length + (test.vibeChallengeIds?.length ?? 0)}
              문항
            </span>
          </div>
          <ol className="ent-problem-list">
            {test.problemIds.map((problemId, index) => {
              const problem = byId.get(problemId);
              return (
                <li key={problemId}>
                  <span className="ent-order">{index + 1}</span>
                  {problem ? (
                    <>
                      <span className="ent-problem-title">{problem.title}</span>
                      {problem.isPrivate ? (
                        <span className="case-pill status-private">
                          기업 전용
                        </span>
                      ) : null}
                      <span
                        className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                      >
                        {difficultyLabel(problem.difficulty)}
                      </span>
                      <small>
                        {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                      </small>
                      {/* 기업 전용 문제는 공개 화면이 없어 출제 화면으로 연다. */}
                      <Link
                        className="button button-outline button-small"
                        to={
                          problem.isPrivate
                            ? `/my-problems/${problem.id}/edit`
                            : problemPath(problem.slug)
                        }
                        aria-label={`${problem.title} 문제 보기`}
                      >
                        문제 보기
                      </Link>
                    </>
                  ) : (
                    <span className="ent-problem-title muted">
                      {loading ? "불러오는 중…" : "비공개 또는 삭제된 문제"}
                    </span>
                  )}
                </li>
              );
            })}
            {test.vibeChallengeIds?.map((challengeId, index) => (
              <li key={challengeId}>
                <span className="ent-order">
                  {test.problemIds.length + index + 1}
                </span>
                <span className="ent-problem-title">바이브코딩 과제</span>
                <span className="case-pill">프로젝트 수정</span>
              </li>
            ))}
          </ol>
        </section>

        <aside className="ent-side">
          <section
            className="form-card ent-card"
            aria-labelledby="ent-status-title"
          >
            <h2 id="ent-status-title">응시 현황</h2>
            <p className="ent-time">{timeLine}</p>
            <dl className="ent-summary">
              <div>
                <dt>응시자</dt>
                <dd>{attemptCount}명</dd>
              </div>
              <div>
                <dt>평균 점수</dt>
                <dd>
                  {summary?.averageScore != null
                    ? `${summary.averageScore}점`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>전부 맞힌 사람</dt>
                <dd>{summary ? `${summary.perfect}명` : "—"}</dd>
              </div>
            </dl>
          </section>
          <section
            className="form-card ent-card"
            aria-labelledby="ent-invite-title"
          >
            <h2 id="ent-invite-title">응시 링크</h2>
            <p className="ent-invite">
              <code>{link}</code>
            </p>
            <CopyButton text={link} label="링크 복사" />
            <p className="muted ent-note">
              {test.inviteOnly
                ? `초대한 ${test.invitees.length}명만 이 링크로 한 번 응시할 수 있어요.`
                : "로그인한 사람은 누구나 이 링크로 한 번 응시할 수 있어요."}{" "}
              응시 기간 안에 시작하면 그때부터 {test.durationMin}분이
              주어집니다.
              {test.showScoreToCandidates
                ? " 응시를 마친 사람은 자기 점수를 볼 수 있어요."
                : ""}
            </p>
            {test.inviteOnly ? (
              <details className="ent-note">
                <summary>초대 목록 보기</summary>
                <ul>
                  {test.invitees.map((invitee) => (
                    <li key={invitee}>{invitee}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
          {test.description ? (
            <section
              className="form-card ent-card"
              aria-labelledby="ent-guide-title"
            >
              <h2 id="ent-guide-title">안내 문구</h2>
              <p className="ent-guide">{test.description}</p>
            </section>
          ) : null}
        </aside>
      </div>

      <section
        className="form-card ent-card ent-results"
        aria-labelledby="ent-results-title"
      >
        <div className="ent-pick-head">
          <h2 id="ent-results-title">응시 결과</h2>
          {results.data ? (
            <button
              className="button button-outline button-small"
              onClick={results.retry}
            >
              새로고침
            </button>
          ) : null}
        </div>
        {test.vibeChallengeIds?.length ? (
          <p className="muted ent-note">
            각 문항은 동일한 비중으로 합산합니다. 바이브코딩은 결과물
            40점·프롬프트 30점·활용 과정 30점이며, 평가 대기 응시자는 평균에서
            제외합니다.
            {summary?.pending ? ` 현재 ${summary.pending}명 평가 대기.` : ""}
          </p>
        ) : null}
        {!attemptCount ? (
          <p className="muted">
            아직 응시한 사람이 없어요. 응시 링크를 보내 보세요.
          </p>
        ) : results.error && !results.data ? (
          <p className="error-message" role="alert">
            {results.error}{" "}
            <button className="text-button" onClick={results.retry}>
              다시 시도
            </button>
          </p>
        ) : !results.data ? (
          <p className="muted" role="status">
            결과를 불러오는 중…
          </p>
        ) : (
          <table className="ent-table ent-result-table">
            <thead>
              <tr>
                <th scope="col">응시자</th>
                <th scope="col">점수</th>
                {test.problemIds.map((problemId, index) => (
                  <th scope="col" key={problemId}>
                    {index + 1}번
                  </th>
                ))}
                {test.vibeChallengeIds?.map((challengeId, index) => (
                  <th scope="col" key={challengeId}>
                    바이브코딩 {index + 1}
                  </th>
                ))}
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              {results.data.candidates.map((candidate) => {
                const byProblem = new Map(
                  candidate.problems.map((item) => [item.problemId, item]),
                );
                const done =
                  candidate.finishedAt ||
                  Date.parse(candidate.deadlineAt) <= now;
                return (
                  <tr key={candidate.id}>
                    <td>
                      <Link to={`/users/${candidate.user.username}`}>
                        {candidate.user.username}
                      </Link>
                    </td>
                    <td>
                      <strong>
                        {candidate.score == null
                          ? "평가 대기"
                          : `${candidate.score}점`}
                      </strong>
                      {test.problemIds.length ? (
                        <small className="muted">
                          {" "}
                          ({test.vibeChallengeIds?.length ? "일반 " : ""}
                          {candidate.solved}/{test.problemIds.length})
                        </small>
                      ) : null}
                    </td>
                    {test.problemIds.map((problemId, index) => {
                      const item = byProblem.get(problemId);
                      return (
                        <td key={problemId}>
                          {item ? (
                            <Link
                              to={`/submissions/${item.submissionId}`}
                              aria-label={`${candidate.user.username} ${index + 1}번 제출 보기`}
                              className={
                                item.solved ? "verdict-good" : "verdict-bad"
                              }
                            >
                              {item.solved ? "정답" : "미해결"}
                              <small className="muted">
                                {" "}
                                · {item.submissions}회
                              </small>
                            </Link>
                          ) : (
                            <span className="muted">미제출</span>
                          )}
                        </td>
                      );
                    })}
                    {candidate.vibeTasks?.map((task) => (
                      <td key={task.challengeId}>
                        {task.id ? (
                          <Link
                            to={`/enterprise/${test.id}/attempts/${candidate.id}/vibe/${task.id}`}
                            aria-label={`${candidate.user.username} ${task.title} 과정 검토`}
                          >
                            {task.score == null
                              ? "평가 대기"
                              : `${task.score}점`}{" "}
                            · 과정 보기
                          </Link>
                        ) : (
                          <span className="muted">미시작</span>
                        )}
                      </td>
                    ))}
                    <td>{done ? "종료" : "응시 중"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
