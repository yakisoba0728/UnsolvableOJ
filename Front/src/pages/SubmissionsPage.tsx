import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Pagination } from "../components/Pagination";
import type { Page, Submission } from "../types";

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
    <div className="page-width content-section standalone-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR HISTORY</span>
          <h1>내 제출</h1>
          <p>제출한 코드와 판정을 확인하세요.</p>
        </div>
        <span className="total-count">{data?.total ?? 0}건</span>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="empty-state">제출을 불러오는 중입니다…</div>
      ) : data?.items.length ? (
        <div className="problem-list">
          {data.items.map((item) => (
            <Link
              className="problem-row submission-row"
              to={`/submissions/${item.id}`}
              key={item.id}
            >
              <span className="problem-title">
                <strong>{item.problem.title ?? "문제"}</strong>
                <small>
                  {item.language} ·{" "}
                  {new Date(item.createdAt).toLocaleString("ko-KR")}
                </small>
              </span>
              <span className={`verdict verdict-${item.status.toLowerCase()}`}>
                {item.status.replaceAll("_", " ")}
              </span>
              <span className="row-arrow" aria-hidden="true">
                ↗
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
