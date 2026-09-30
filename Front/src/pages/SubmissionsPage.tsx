import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import type { Page, Submission } from "../types";

const languageLabels: Record<string, string> = {
  C: "C",
  CPP: "C++",
  JAVA: "Java",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  GO: "Go",
  RUST: "Rust",
};

export function SubmissionsPage() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Submission> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<Page<Submission>>(
      `/submissions?page=${page}&limit=20`,
      { signal: controller.signal },
      session.accessToken,
    )
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "제출을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, session]);

  return (
    <div className="page-width page-body">
      <PageHeader
        title="내 제출"
        badge={<span className="pill">{data?.total ?? 0}건</span>}
        description="제출한 코드와 판정을 확인하세요."
      />
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="empty-state">제출을 불러오는 중입니다…</div>
      ) : data?.items.length ? (
        <div className="problem-list">
          <div className="history-head" aria-hidden="true">
            <span>문제</span>
            <span>판정</span>
            <span>언어</span>
            <span>실행 결과</span>
            <span>제출 시각</span>
          </div>
          {data.items.map((item) => (
            <Link
              className="history-row"
              to={`/submissions/${item.id}`}
              key={item.id}
            >
              <span className="history-title">
                <strong>{item.problem.title ?? "문제"}</strong>
                <small>
                  {item.passedTestCases} / {item.totalTestCases} 통과
                </small>
              </span>
              <span className={`verdict verdict-${item.status.toLowerCase()}`}>
                {item.status.replaceAll("_", " ")}
              </span>
              <span className="history-lang">
                {languageLabels[item.language] ?? item.language}
              </span>
              <span className="history-metrics">
                {item.runtimeMs === null ? "—" : `${item.runtimeMs}ms`}
                {" · "}
                {item.memoryKb === null
                  ? "—"
                  : `${(item.memoryKb / 1024).toFixed(1)}MB`}
              </span>
              <time className="history-time" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <span className="row-arrow" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          아직 제출이 없습니다.{" "}
          <Link to="/problems">첫 문제를 골라보세요.</Link>
        </div>
      )}
      {data ? (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onChange={setPage}
        />
      ) : null}
    </div>
  );
}
