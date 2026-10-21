import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { SkeletonRows } from "../components/Skeleton";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";
import { problemPath } from "../paths";
import { difficultyLabel } from "../difficulty";

interface MyProblem {
  id: string;
  slug: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  difficulty: string;
  currentVersion: number;
  updatedAt: string;
}

const statusLabel: Record<MyProblem["status"], string> = {
  DRAFT: "초안 · 검수 대기",
  PUBLISHED: "공개 중",
  ARCHIVED: "보관됨",
};

export function MyProblemsPage() {
  useDocumentTitle("내 문제");
  const { session } = useAuth();
  const location = useLocation();
  const isAdmin = session?.user.role === "ADMIN";
  const [problems, setProblems] = useState<MyProblem[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? "",
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function changeStatus(
    problem: MyProblem,
    status: "PUBLISHED" | "DRAFT",
  ) {
    if (!session) return;
    setBusyId(problem.id);
    setError("");
    try {
      await api(
        `/problems/${problem.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        session.accessToken,
      );
      setProblems(
        (previous) =>
          previous?.map((item) =>
            item.id === problem.id ? { ...item, status } : item,
          ) ?? null,
      );
      setNotice(
        status === "PUBLISHED"
          ? "문제를 공개했어요."
          : "문제를 초안으로 돌렸어요.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "상태를 바꾸지 못했습니다.",
      );
    } finally {
      setBusyId("");
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
              <span
                className={`case-pill status-${problem.status.toLowerCase()}`}
              >
                {statusLabel[problem.status]}
              </span>
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
                {isAdmin && problem.status === "DRAFT" ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busyId === problem.id}
                    onClick={() => changeStatus(problem, "PUBLISHED")}
                  >
                    공개하기
                  </button>
                ) : null}
                {isAdmin && problem.status === "PUBLISHED" ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busyId === problem.id}
                    onClick={() => changeStatus(problem, "DRAFT")}
                  >
                    초안으로
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
