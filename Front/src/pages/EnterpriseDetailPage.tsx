import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import {
  formatDateTime,
  metaLine,
  periodProgress,
  remainingText,
  statusLabel,
  testStatus,
} from "../enterprise/model";
import { enterpriseActions, useEnterpriseTests } from "../enterprise/store";
import { useNow } from "../enterprise/useNow";
import { useAllProblems, useDocumentTitle } from "../hooks";
import { problemPath } from "../paths";
import { statusPillClass } from "./EnterprisePage";
import { difficultyLabel } from "./ProblemsPage";

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-width">
      <PageHeader title="테스트 상세" back={{ to: "/enterprise", label: "기업 테스트" }} />
      <div className="empty-state ent-empty">{children}</div>
    </div>
  );
}

export function EnterpriseDetailPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const now = useNow(10_000);
  const tests = useEnterpriseTests(session?.user.id);
  const { problems, loading } = useAllProblems();
  const test = tests.find((item) => item.id === id);
  useDocumentTitle(test?.title ?? "테스트 상세");

  if (!session)
    return (
      <Missing>
        <strong>로그인하면 만든 테스트를 볼 수 있어요</strong>
        <Link className="button" to="/auth" state={{ from: `/enterprise/${id}` }}>
          로그인하기 <span aria-hidden="true">→</span>
        </Link>
      </Missing>
    );
  if (!test)
    return (
      <Missing>
        <strong>테스트를 찾을 수 없어요</strong>
        <p>삭제되었거나 이 브라우저에서 만든 테스트가 아닙니다.</p>
        <Link className="button" to="/enterprise">
          기업 테스트로 <span aria-hidden="true">→</span>
        </Link>
      </Missing>
    );

  const status = testStatus(test, now);
  const progress = Math.round(periodProgress(test, now) * 100);
  const byId = new Map(problems.map((problem) => [problem.id, problem]));
  const timeLine =
    status === "scheduled"
      ? `시작까지 ${remainingText(Date.parse(test.startsAt) - now)}`
      : status === "running"
        ? `마감까지 ${remainingText(Date.parse(test.endsAt) - now)}`
        : `${formatDateTime(test.endsAt)}에 마감됐어요`;

  function remove() {
    if (
      !window.confirm(
        `‘${test!.title}’ 테스트를 삭제할까요? 삭제하면 되돌릴 수 없어요.`,
      )
    )
      return;
    enterpriseActions.remove(session!.user.id, test!.id);
    navigate("/enterprise");
  }

  return (
    <div className="page-width enterprise-page">
      <PageHeader
        title={test.title}
        badge={<span className={statusPillClass[status]}>{statusLabel[status]}</span>}
        description={`${metaLine(test)} · ${formatDateTime(test.startsAt)} – ${formatDateTime(test.endsAt)}`}
        back={{ to: "/enterprise", label: "기업 테스트" }}
        aside={
          <div className="ent-actions">
            {status === "scheduled" ? (
              <Link className="button button-outline" to={`/enterprise/${test.id}/edit`}>
                편집
              </Link>
            ) : null}
            <button className="button button-outline ent-danger" onClick={remove}>
              삭제
            </button>
          </div>
        }
      />

      <div className="ent-detail-grid">
        <section className="form-card ent-card" aria-labelledby="ent-problems-title">
          <div className="ent-pick-head">
            <h2 id="ent-problems-title">출제 문제</h2>
            <span className="muted">{test.problemIds.length}문항</span>
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
                      <span
                        className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                      >
                        {difficultyLabel(problem.difficulty)}
                      </span>
                      <small>
                        {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                      </small>
                      <Link
                        className="button button-outline button-small"
                        to={problemPath(problem.slug)}
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
          </ol>
        </section>

        <aside className="ent-side">
          <section className="form-card ent-card" aria-labelledby="ent-status-title">
            <h2 id="ent-status-title">응시 현황</h2>
            <p className="ent-time">{timeLine}</p>
            <div
              className="progress ent-progress"
              role="progressbar"
              aria-label="응시 기간 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="muted ent-note">
              응시자 수·점수·합격률은 응시 기능이 열린 뒤 이곳에 표시됩니다.
            </p>
          </section>
          {test.description ? (
            <section className="form-card ent-card" aria-labelledby="ent-guide-title">
              <h2 id="ent-guide-title">안내 문구</h2>
              <p className="ent-guide">{test.description}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
