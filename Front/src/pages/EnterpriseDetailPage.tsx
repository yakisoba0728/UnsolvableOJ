import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useConfirm } from "../components/ConfirmDialog";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { PageHeader } from "../components/PageHeader";
import {
  EnterpriseNotice,
  NoticeAction,
  TestNotFound,
} from "../enterprise/EnterpriseNotice";
import {
  formatPeriod,
  metaLine,
  statusLabel,
  statusPillClass,
  statusTimeText,
  testStatus,
  type EnterpriseTest,
} from "../enterprise/model";
import { enterpriseActions, useEnterpriseTests } from "../enterprise/store";
import { useAllProblems, useDocumentTitle, useNow } from "../hooks";
import { problemPath } from "../paths";
import type { ProblemSummary } from "../types";

const TITLE = "테스트 상세";

export function EnterpriseDetailPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const now = useNow(10_000);
  const tests = useEnterpriseTests(session?.user.id);
  const { problems, loading } = useAllProblems();
  const test = tests.find((item) => item.id === id);
  useDocumentTitle(test?.title ?? TITLE);

  if (!session)
    return (
      <EnterpriseNotice title={TITLE}>
        <strong>로그인하면 만든 테스트를 볼 수 있어요</strong>
        <NoticeAction to="/auth" from={`/enterprise/${id}`}>
          로그인하기
        </NoticeAction>
      </EnterpriseNotice>
    );
  if (!test) return <TestNotFound title={TITLE} />;

  const userId = session.user.id;
  const current: EnterpriseTest = test;
  const status = testStatus(current, now);

  async function remove() {
    if (
      !(await confirm({
        title: `‘${current.title}’ 테스트를 삭제할까요?`,
        message: "삭제하면 되돌릴 수 없어요.",
        confirmLabel: "삭제",
        danger: true,
      }))
    )
      return;
    if (!enterpriseActions.remove(userId, current.id)) {
      setSaveError(
        "테스트를 삭제하지 못했어요. 저장 공간·권한을 확인하고 다시 시도해 주세요.",
      );
      return;
    }
    navigate("/enterprise");
  }

  return (
    <div className="page-width enterprise-page">
      {confirmDialog}
      {saveError ? (
        <p className="error-message" role="alert">
          {saveError}
        </p>
      ) : null}
      <PageHeader
        title={current.title}
        badge={
          <span className={statusPillClass[status]}>{statusLabel[status]}</span>
        }
        description={`${metaLine(current)} · ${formatPeriod(current)}`}
        back={{ to: "/enterprise", label: "기업 테스트" }}
        aside={
          <div className="ent-actions">
            {status === "scheduled" ? (
              <Link
                className="button button-outline"
                to={`/enterprise/${current.id}/edit`}
              >
                편집
              </Link>
            ) : null}
            <button
              className="button button-outline ent-danger"
              onClick={() => void remove()}
            >
              삭제
            </button>
          </div>
        }
      />

      <div className="ent-detail-grid">
        <section className="form-card ent-card" aria-labelledby="ent-problems-title">
          <div className="ent-pick-head">
            <h2 id="ent-problems-title">출제 문제</h2>
            <span className="muted">{current.problemIds.length}문항</span>
          </div>
          <ProblemList
            problemIds={current.problemIds}
            problems={problems}
            loading={loading}
          />
        </section>

        <aside className="ent-side">
          <section className="form-card ent-card" aria-labelledby="ent-status-title">
            <h2 id="ent-status-title">응시 현황</h2>
            <p className="ent-time">{statusTimeText(current, status, now)}</p>
            <p className="muted ent-note">
              응시자 수·점수·합격률은 응시 기능이 열린 뒤 이곳에 표시됩니다.
            </p>
          </section>
          {current.description ? (
            <section className="form-card ent-card" aria-labelledby="ent-guide-title">
              <h2 id="ent-guide-title">안내 문구</h2>
              <p className="ent-guide">{current.description}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** 출제 순서대로의 문제. 공개 목록에 없는 문제는 이름 대신 안내를 보인다. */
function ProblemList({
  problemIds,
  problems,
  loading,
}: {
  problemIds: string[];
  problems: ProblemSummary[];
  loading: boolean;
}) {
  const byId = new Map(problems.map((problem) => [problem.id, problem]));
  return (
    <ol className="ent-problem-list">
      {problemIds.map((problemId, index) => {
        const problem = byId.get(problemId);
        return (
          <li key={problemId}>
            <span className="ent-order">{index + 1}</span>
            {problem ? (
              <>
                <span className="ent-problem-title">{problem.title}</span>
                <DifficultyBadge difficulty={problem.difficulty} />
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
  );
}
