import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Difficulty, Page, ProblemSummary } from "../types";

const difficulties: { value: Difficulty | ""; label: string }[] = [
  { value: "", label: "전체" },
  { value: "BEGINNER", label: "입문" },
  { value: "EASY", label: "쉬움" },
  { value: "MEDIUM", label: "보통" },
  { value: "HARD", label: "어려움" },
  { value: "EXPERT", label: "전문가" },
];

export function difficultyLabel(value: Difficulty) {
  return difficulties.find((item) => item.value === value)?.label ?? value;
}

export function ProblemsPage() {
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ProblemSummary> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), limit: "20" });
    if (difficulty) query.set("difficulty", difficulty);
    void api<Page<ProblemSummary>>(`/problems?${query}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "문제를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [difficulty, page]);

  return (
    <div className="page-width">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">PRACTICE / PROGRESS / REPEAT</span>
          <h1>
            오늘의 한 문제,
            <br />
            <em>내일의 새로운 실력.</em>
          </h1>
          <p>쉬운 문제부터 차근차근. 직접 생각하고 제출하며 성장해 보세요.</p>
          <a className="button" href="#problem-list">
            문제 살펴보기 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-core">{`{ }`}</div>
          <div className="hero-chip chip-one">solve()</div>
          <div className="hero-chip chip-two">ACCEPTED ✓</div>
        </div>
      </section>
      <section id="problem-list" className="content-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PROBLEM SET</span>
            <h2>문제 목록</h2>
            <p>풀고 싶은 난이도를 골라 시작하세요.</p>
          </div>
          <span className="total-count">{data?.total ?? 0}개의 문제</span>
        </div>
        <div className="filter-bar" role="group" aria-label="난이도 필터">
          {difficulties.map((item) => (
            <button
              key={item.value}
              className={`filter-chip ${difficulty === item.value ? "selected" : ""}`}
              onClick={() => {
                setDifficulty(item.value);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <div className="empty-state">문제를 불러오는 중입니다…</div>
        ) : data?.items.length ? (
          <div className="problem-list">
            {data.items.map((problem, index) => (
              <Link
                className="problem-row"
                to={`/problems/${problem.slug}`}
                key={problem.id}
              >
                <span className="problem-index">
                  {String((page - 1) * 20 + index + 1).padStart(2, "0")}
                </span>
                <span className="problem-title">
                  <strong>{problem.title}</strong>
                  <small>/{problem.slug}</small>
                </span>
                <span
                  className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                >
                  {difficultyLabel(problem.difficulty)}
                </span>
                <span className="problem-limit">
                  {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                </span>
                <span className="row-arrow" aria-hidden="true">
                  ↗
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            이 난이도에 공개된 문제가 아직 없습니다.
          </div>
        )}
        {data && data.totalPages > 1 ? (
          <div className="pagination">
            <button
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              이전
            </button>
            <span>
              {page} / {data.totalPages}
            </span>
            <button
              disabled={page >= data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              다음
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
