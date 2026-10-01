import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { newSeed, seededShuffle } from "../shuffle";
import { ProblemStatus, solveState } from "../components/ProblemStatus";
import {
  useAllProblems,
  useDocumentTitle,
  useMyStanding,
  useSubmissionHistory,
} from "../hooks";
import type { Difficulty } from "../types";

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

const PAGE_SIZE = 20;

const sorts = [
  { value: "latest", label: "정렬: 최신순" },
  { value: "easy", label: "쉬운 난이도순" },
  { value: "hard", label: "어려운 난이도순" },
  { value: "title", label: "제목순" },
  { value: "random", label: "무작위 순서" },
];
const order: Difficulty[] = ["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"];

const statusFilters = [
  { value: "", label: "풀이 상태: 전체" },
  { value: "solved", label: "해결" },
  { value: "attempted", label: "풀이 중" },
  { value: "none", label: "미해결" },
];

export function ProblemsPage() {
  const { session } = useAuth();
  useDocumentTitle("문제 목록");
  const { problems, loading, error } = useAllProblems();
  const history = useSubmissionHistory(session);
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [status, setStatus] = useState("");
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [sort, setSort] = useState("latest");
  const [seed, setSeed] = useState(newSeed);
  const [announce, setAnnounce] = useState("");
  const [page, setPage] = useState(1);
  const { profile, rank } = useMyStanding(session);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" 키로 검색창에 바로 이동 (LeetCode·GitHub 방식)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
        return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setPage(1), [difficulty, status, query, sort]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    // 무작위: 전체를 한 번 섞은 뒤 필터를 적용한다. 필터를 바꿔도 상대 순서가 유지되고,
    // 난이도 칩을 고른 채 섞으면 그 난이도 안에서의 무작위 순서가 된다.
    const base =
      sort === "random" ? seededShuffle(problems, seed) : [...problems];
    if (sort === "random") {
      /* 이미 섞인 순서를 그대로 쓴다 */
    } else if (sort === "easy" || sort === "hard")
      base.sort(
        (a, b) =>
          (order.indexOf(a.difficulty) - order.indexOf(b.difficulty)) *
          (sort === "easy" ? 1 : -1),
      );
    else if (sort === "title")
      base.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    else base.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return base.filter((problem) => {
      if (difficulty && problem.difficulty !== difficulty) return false;
      if (
        status &&
        solveState(problem.id, history.solved, history.attempted) !== status
      )
        return false;
      return (
        !keyword ||
        problem.title.toLowerCase().includes(keyword) ||
        problem.slug.toLowerCase().includes(keyword)
      );
    });
  }, [
    problems,
    difficulty,
    status,
    query,
    sort,
    seed,
    history.solved,
    history.attempted,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );
  const hasFilter = Boolean(difficulty || status || query.trim());
  const resume =
    history.submissions.find(
      (item) => !history.solved.has(item.problem.id) && item.problem.slug,
    ) ?? null;
  const resumeProblem = resume
    ? problems.find((problem) => problem.id === resume.problem.id)
    : null;

  const solvedCount = problems.filter((problem) =>
    history.solved.has(problem.id),
  ).length;
  const countByDifficulty = (value: Difficulty | "") =>
    value
      ? problems.filter((problem) => problem.difficulty === value).length
      : problems.length;

  // 목록을 무작위 순서로 섞는다(이동하지 않는다). 선택한 난이도·상태 필터 안에서 섞인다.
  function shuffle() {
    const next = newSeed();
    setSeed(next);
    setSort("random");
    setPage(1);
    const scope = difficulty ? `${difficultyLabel(difficulty)} 난이도 ` : "";
    setAnnounce(`${scope}문제 목록을 무작위로 섞었어요.`);
  }

  function reset() {
    setDifficulty("");
    setStatus("");
    setQuery("");
  }

  return (
    <div className="page-width problems-page">
      <PageHeader
        title="문제 목록"
        badge={<span className="pill">{problems.length}문제</span>}
        description="한 문제씩, 더 단단해지는 실력. 오늘 풀 문제를 찾아보세요."
        aside={
          session && problems.length ? (
          <div className="solved-summary">
            <span>
              <strong>{solvedCount}</strong> / {problems.length} 해결
            </span>
            <div
              className="progress"
              role="progressbar"
              aria-label="해결한 문제 비율"
              aria-valuemin={0}
              aria-valuemax={problems.length}
              aria-valuenow={solvedCount}
            >
              <span
                style={{ width: `${(solvedCount / problems.length) * 100}%` }}
              />
            </div>
          </div>
          ) : null
        }
      />

      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder="문제 제목 검색"
              aria-label="문제 검색"
              aria-keyshortcuts="/"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>
          {session ? (
            <select
              aria-label="풀이 상태"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statusFilters.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : null}
          <select
            aria-label="정렬"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              if (event.target.value === "random") setSeed(newSeed());
            }}
          >
            {sorts.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-outline"
            onClick={shuffle}
            disabled={filtered.length < 2}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M3 7h3.2c1.6 0 3 .8 3.9 2.1l2.8 3.8c.9 1.3 2.3 2.1 3.9 2.1H21M3 17h3.2c1.6 0 3-.8 3.9-2.1M14 8.2c.8-.7 1.8-1.2 2.9-1.2H21M18.5 4 21 7l-2.5 3M18.5 11 21 14l-2.5 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {sort === "random" ? "다시 섞기" : "무작위 섞기"}
          </button>
        </div>
        <div className="filter-bar" role="group" aria-label="난이도 필터">
          <span className="filter-label">난이도</span>
          {difficulties.map((item) => (
            <button
              key={item.value}
              className={`filter-chip ${difficulty === item.value ? "selected" : ""}`}
              aria-pressed={difficulty === item.value}
              onClick={() => setDifficulty(item.value)}
            >
              {item.label}
              <span className="chip-count">
                {countByDifficulty(item.value)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="list-layout">
        <section aria-label="문제 목록">
          <div className="section-heading compact">
            <div className="title-line">
              <h2>{hasFilter ? "검색 결과" : "전체 문제"}</h2>
              {sort === "random" ? (
                <>
                  <span className="pill pill-primary">무작위 순서</span>
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => setSort("latest")}
                  >
                    기본 순서로
                  </button>
                </>
              ) : null}
            </div>
            <span className="total-count">
              {filtered.length}문제
              {filtered.length ? ` 중 ${(current - 1) * PAGE_SIZE + 1}–${(current - 1) * PAGE_SIZE + visible.length}` : ""}
            </span>
          </div>
          {loading ? (
            <div className="empty-state">문제를 불러오는 중입니다…</div>
          ) : visible.length ? (
            <div className="problem-list">
              <div className="problem-head" aria-hidden="true">
                <span>문제</span>
                <span>풀이 상태</span>
                <span>난이도</span>
                <span>제한</span>
              </div>
              {visible.map((problem) => (
                <Link
                  className="problem-row"
                  to={`/problems/${problem.slug}`}
                  key={problem.id}
                >
                  <span className="problem-title">
                    <strong>{problem.title}</strong>
                  </span>
                  <ProblemStatus
                    state={solveState(
                      problem.id,
                      history.solved,
                      history.attempted,
                    )}
                  />
                  <span
                    className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                  >
                    {difficultyLabel(problem.difficulty)}
                  </span>
                  <span className="problem-limit">
                    {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                  </span>
                  <span className="row-arrow" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {hasFilter ? (
                <>
                  <strong>조건에 맞는 문제가 없어요.</strong>
                  <p>
                    {query.trim() ? `‘${query.trim()}’ 검색어와 ` : ""}선택한
                    필터를 유지한 채 결과가 없습니다. 조건을 줄여 다시
                    찾아보세요.
                  </p>
                  <button className="button button-soft" onClick={reset}>
                    필터 초기화
                  </button>
                </>
              ) : (
                "공개된 문제가 아직 없습니다."
              )}
            </div>
          )}
          <Pagination
            page={current}
            totalPages={totalPages}
            onChange={setPage}
          />
        </section>

        <aside className="side-stack">
          {profile ? (
            <Link to="/profile" className="standing-card">
              <h2>내 요약</h2>
              <dl>
                <div>
                  <dt>순위</dt>
                  <dd>{rank >= 0 ? `${rank + 1}위` : "—"}</dd>
                </div>
                <div>
                  <dt>XP</dt>
                  <dd>{profile.xp.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>해결한 문제</dt>
                  <dd>{profile.solvedCount}개</dd>
                </div>
              </dl>
            </Link>
          ) : null}
          {resume && resumeProblem ? (
            <div className="resume-card">
              <span className="pill pill-dark">이어서 풀기</span>
              <h2>{resumeProblem.title}</h2>
              <p>
                {difficultyLabel(resumeProblem.difficulty)} ·{" "}
                {resumeProblem.timeLimitMs}ms
              </p>
              <Link
                className="button button-white"
                to={`/problems/${resumeProblem.slug}`}
              >
                계속 풀기 →
              </Link>
            </div>
          ) : !session ? (
            <div className="resume-card">
              <span className="pill pill-dark">기록 남기기</span>
              <h2>로그인하고 풀이 상태를 확인하세요</h2>
              <p>해결한 문제와 풀이 중인 문제가 목록에 표시됩니다.</p>
              <Link className="button button-white" to="/auth">
                로그인 →
              </Link>
            </div>
          ) : null}
          <div className="guide-card">
            <h2>나에게 맞는 문제 찾기</h2>
            <ol>
              <li>
                <button onClick={() => setDifficulty("BEGINNER")}>
                  <strong>쉬운 난이도로 시작하기</strong>
                  <span>부담 없는 문제부터 차근차근</span>
                </button>
              </li>
              <li>
                <button onClick={() => setDifficulty("MEDIUM")}>
                  <strong>보통 난이도에 도전하기</strong>
                  <span>익숙해졌다면 한 단계 위로</span>
                </button>
              </li>
              {session ? (
                <li>
                  <button onClick={() => setStatus("none")}>
                    <strong>아직 안 푼 문제만 보기</strong>
                    <span>새로운 문제에 집중해요</span>
                  </button>
                </li>
              ) : null}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
