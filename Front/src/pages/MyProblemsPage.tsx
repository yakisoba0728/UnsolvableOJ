import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { SkeletonRows } from "../components/Skeleton";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle, useFlashNotice } from "../hooks";
import { problemPath } from "../paths";
import { difficultyLabel } from "../difficulty";

interface MyProblem {
  id: string;
  slug: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  isPrivate?: boolean;
  difficulty: string;
  currentVersion: number;
  updatedAt: string;
}

const statusLabel: Record<MyProblem["status"], string> = {
  DRAFT: "초안 · 검수 대기",
  PUBLISHED: "공개 중",
  ARCHIVED: "보관됨",
};
const changedNotice: Record<MyProblem["status"], string> = {
  PUBLISHED: "문제를 공개했어요.",
  DRAFT: "문제를 비공개로 전환했어요.",
  ARCHIVED: "문제를 보관했어요.",
};

export function MyProblemsPage() {
  useDocumentTitle("내 문제");
  const { session, getSessionVersion } = useAuth();
  const sessionVersion = getSessionVersion();
  const isAdmin = session?.user.role === "ADMIN";
  const [problems, setProblems] = useState<MyProblem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const [notice, setNotice] = useFlashNotice();

  useEffect(() => {
    alive.current = true;
    busyRef.current = false;
    setBusy(false);
    setProblems(null);
    setError("");
    let cancelled = false;
    if (session) {
      api<MyProblem[]>("/problems/mine", {}, session.accessToken)
        .then((list) => !cancelled && setProblems(list))
        .catch(
          (cause) =>
            !cancelled &&
            setError(
              cause instanceof Error
                ? cause.message
                : "목록을 불러오지 못했습니다.",
            ),
        );
    }
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [session]);

  async function changeStatus(
    problem: MyProblem,
    status: MyProblem["status"],
  ) {
    const current = () => alive.current && sessionVersion === getSessionVersion();
    if (
      !session ||
      !current() ||
      busyRef.current ||
      (status === "PUBLISHED" && !isAdmin)
    ) return;
    const question =
      status === "ARCHIVED"
        ? `‘${problem.title}’을(를) 보관할까요? 공개 목록에서 내려가고 새 제출을 받지 않아요. 보관을 해제하면 초안으로 돌아와요.`
        : problem.status === "ARCHIVED"
          ? `‘${problem.title}’의 보관을 해제할까요? 초안으로 돌아오며, 다시 공개하려면 관리자 검수가 필요해요.`
          : "";
    if (question && !window.confirm(question)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        `/problems/${problem.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        session.accessToken,
      );
      if (!current()) return;
      setProblems(
        (previous) =>
          previous?.map((item) =>
            item.id === problem.id ? { ...item, status } : item,
          ) ?? null,
      );
      setNotice(
        problem.status === "ARCHIVED"
          ? "보관을 해제했어요. 초안으로 돌아왔어요."
          : changedNotice[status],
      );
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error ? cause.message : "상태를 바꾸지 못했습니다.",
        );
      }
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <div className="page-width my-problems-page">
      <PageHeader
        back={{ to: "/problems", label: "문제 목록" }}
        title="내 문제"
        description={
          isAdmin
            ? "모든 문제를 수정하고, 초안을 검수한 뒤 공개할 수 있어요."
            : "내가 만든 문제를 수정하고 상태를 확인할 수 있어요. 초안은 관리자 검수 후 공개됩니다."
        }
        aside={
          <Link className="button" to="/problems/new">
            새 문제 만들기
          </Link>
        }
      />
      {notice ? (
        <p className="notice-inline" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {problems === null && !error ? (
        <SkeletonRows count={4} columns={3} />
      ) : null}
      {problems && problems.length === 0 ? (
        <div className="empty-state">
          <strong>아직 만든 문제가 없어요.</strong>
          <p>첫 문제를 만들어 다른 사람과 나눠 보세요.</p>
          <Link className="button" to="/problems/new">
            문제 만들기
          </Link>
        </div>
      ) : null}
      {problems && problems.length > 0 ? (
        <ul className="my-problem-list">
          {problems.map((problem) => (
            <li key={problem.id} className="my-problem-row">
              <div className="my-problem-main">
                <strong>{problem.title}</strong>
                <span className="muted">
                  {difficultyLabel(problem.difficulty)} ·
                  수정 {new Date(problem.updatedAt).toLocaleDateString("ko-KR")}{" "}
                  · /{problem.slug}
                </span>
              </div>
              {problem.isPrivate ? (
                <span className="case-pill status-private">기업 전용</span>
              ) : (
                <span
                  className={`case-pill status-${problem.status.toLowerCase()}`}
                >
                  {statusLabel[problem.status]}
                </span>
              )}
              <div className="my-problem-actions">
                <Link
                  className="button button-outline"
                  to={`/my-problems/${problem.id}/edit`}
                >
                  수정
                </Link>
                {problem.status === "PUBLISHED" ? (
                  <Link className="text-button" to={problemPath(problem.slug)}>
                    문제 보기
                  </Link>
                ) : null}
                {/* 기업 전용 문제는 공개할 수 없다(서버 규칙). */}
                {isAdmin && problem.status === "DRAFT" && !problem.isPrivate ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => changeStatus(problem, "PUBLISHED")}
                  >
                    공개하기
                  </button>
                ) : null}
                {/* 공개는 관리자 검수가 필요하지만 비공개 전환은 작성자도 할 수 있다(서버 규칙). */}
                {problem.status === "PUBLISHED" ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => changeStatus(problem, "DRAFT")}
                  >
                    비공개로 전환
                  </button>
                ) : null}
                {/* 보관 해제는 초안으로 돌아간다. 다시 공개하려면 관리자 검수를 거친다. */}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    changeStatus(
                      problem,
                      problem.status === "ARCHIVED" ? "DRAFT" : "ARCHIVED",
                    )
                  }
                >
                  {problem.status === "ARCHIVED" ? "보관 해제" : "보관"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
