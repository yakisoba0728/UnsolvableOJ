import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { BrandArt } from "../components/BrandArt";
import { FavoriteButton } from "../components/FavoriteButton";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { ProblemStatus, solveState, type SolveState } from "../components/ProblemStatus";
import {
  useAllProblems,
  useDocumentTitle,
  useFavorites,
  pickNextProblem,
  pickResume,
  useMyStanding,
  useSubmissionHistory,
} from "../hooks";
import { problemPath } from "../paths";
import { newSeed, seededShuffle } from "../shuffle";
import type { Difficulty, ProblemSummary } from "../types";

const difficultyOptions: { value: Difficulty; label: string }[] = [
  { value: "BEGINNER", label: "입문" },
  { value: "EASY", label: "쉬움" },
  { value: "MEDIUM", label: "보통" },
  { value: "HARD", label: "어려움" },
  { value: "EXPERT", label: "전문가" },
];
const order = difficultyOptions.map((item) => item.value);

export function difficultyLabel(value: Difficulty) {
  return difficultyOptions.find((item) => item.value === value)?.label ?? value;
}

const PAGE_SIZE = 20;

const sorts = [
  { value: "latest", label: "정렬: 최신순" },
  { value: "easy", label: "쉬운 난이도순" },
  { value: "hard", label: "어려운 난이도순" },
  { value: "title", label: "제목순" },
  { value: "random", label: "무작위 순서" },
];

const statusChips: { value: "" | SolveState; label: string }[] = [
  { value: "", label: "전체" },
  { value: "none", label: "미해결" },
  { value: "attempted", label: "풀이 중" },
  { value: "solved", label: "해결" },
];

/**
 * 목록 조건(검색어·난이도·상태·즐겨찾기·정렬·페이지)은 모두 URL에 저장한다.
 * 문제를 열었다가 뒤로 가도 같은 목록이 복원되고, 주소를 공유할 수 있다. (LeetCode, solved.ac 방식)
 */
export function ProblemsPage() {
  const { session } = useAuth();
  useDocumentTitle("문제 목록");
  const { problems, loading, error } = useAllProblems();
  const history = useSubmissionHistory(session);
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const { profile, rank } = useMyStanding(session);
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [announce, setAnnounce] = useState("");

  const urlQuery = params.get("q") ?? "";
  const selectedDifficulties = (params.get("d") ?? "")
    .split(",")
    .filter((value): value is Difficulty => order.includes(value as Difficulty));
  const status = (params.get("s") ?? "") as "" | SolveState;
  const sort = params.get("sort") ?? "latest";
  const seed = Number(params.get("seed")) || 1;
  const favoritesOnly = params.get("fav") === "1";
  const page = Math.max(1, Number(params.get("page")) || 1);

  function update(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  // 검색어: 입력은 즉시 반영하고 URL에는 잠시 멈춘 뒤 저장한다(한글 입력 중 끊김 방지)
  const [queryText, setQueryText] = useState(urlQuery);
  const lastWritten = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastWritten.current) {
      lastWritten.current = urlQuery;
      setQueryText(urlQuery);
    }
  }, [urlQuery]);
  useEffect(() => {
    if (queryText === urlQuery) return;
    const timer = setTimeout(() => {
      lastWritten.current = queryText;
      update({ q: queryText || null });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText]);

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

  const keyword = urlQuery.trim().toLowerCase();
  const stateOf = (problem: ProblemSummary) =>
    solveState(problem.id, history.solved, history.attempted);

  // skip: 해당 그룹의 조건만 빼고 센다 → 칩의 숫자가 "그 칩을 눌렀을 때의 결과 수"가 된다
  const matches = (problem: ProblemSummary, skip: "difficulty" | "status" | null) => {
    if (
      skip !== "difficulty" &&
      selectedDifficulties.length &&
      !selectedDifficulties.includes(problem.difficulty)
    )
      return false;
    if (skip !== "status" && status && stateOf(problem) !== status) return false;
    if (favoritesOnly && !favorites.has(problem.id)) return false;
    return (
      !keyword ||
      problem.title.toLowerCase().includes(keyword) ||
      problem.slug.toLowerCase().includes(keyword)
    );
  };

  const filtered = useMemo(() => {
    // 무작위: 전체를 한 번 섞은 뒤 필터를 적용한다. 필터를 바꿔도 상대 순서가 유지된다.
    const base = sort === "random" ? seededShuffle(problems, seed) : [...problems];
    if (sort === "easy" || sort === "hard")
      base.sort(
        (a, b) =>
          (order.indexOf(a.difficulty) - order.indexOf(b.difficulty)) *
          (sort === "easy" ? 1 : -1),
      );
    else if (sort === "title")
      base.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    else if (sort !== "random")
      base.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return base.filter((problem) => matches(problem, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, sort, seed, params, favorites, history.solved, history.attempted]);

  const statusCount = (value: "" | SolveState) =>
    problems.filter((p) => matches(p, "status") && (!value || stateOf(p) === value)).length;
  const difficultyCount = (value: Difficulty | "") =>
    problems.filter((p) => matches(p, "difficulty") && (!value || p.difficulty === value)).length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const hasFilter = Boolean(
    selectedDifficulties.length || status || favoritesOnly || keyword,
  );
  const solvedCount = problems.filter((p) => history.solved.has(p.id)).length;
  const favoriteCount = problems.filter((p) => favorites.has(p.id)).length;

  // 이어 풀 문제(시도했지만 못 푼 가장 최근 문제). 없으면 가장 쉬운 안 푼 문제.
  const resume = pickResume(history.submissions, history.solved);
  const next = resume ? null : pickNextProblem(problems, history.solved);
  const continueTarget = resume
    ? {
        slug: resume.problem.slug as string,
        title: resume.problem.title ?? "문제",
        label: "이어서 풀기",
      }
    : next
      ? { slug: next.slug, title: next.title, label: "다음 문제 풀기" }
      : null;

  function toggleDifficulty(value: Difficulty | "") {
    if (value === "") return update({ d: null });
    const next = new Set(selectedDifficulties);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update({ d: order.filter((item) => next.has(item)).join(",") || null });
  }

  // 목록을 무작위 순서로 섞는다(이동하지 않는다). 선택한 조건 안에서 섞인다.
  function shuffle() {
    update({ sort: "random", seed: String(newSeed()) });
    const scope = selectedDifficulties.length
      ? `${selectedDifficulties.map(difficultyLabel).join("·")} 난이도 `
      : "";
    setAnnounce(`${scope}문제 목록을 무작위로 섞었어요.`);
  }

  function changeSort(value: string) {
    if (value === "random") update({ sort: "random", seed: String(newSeed()) });
    else update({ sort: value === "latest" ? null : value, seed: null });
  }

  function resetFilters() {
    const next = new URLSearchParams(params);
    ["q", "d", "s", "fav", "page"].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
    setQueryText("");
    lastWritten.current = "";
  }

  return (
    <div className="page-width problems-page">
      <PageHeader
        title="문제 목록"
        badge={<span className="pill">{problems.length}문제</span>}
        description="한 문제씩, 더 단단해지는 실력. 오늘 풀 문제를 찾아보세요."
        aside={
          session && problems.length ? (
            <div className="header-actions">
              {continueTarget ? (
                <Link
                  className="button"
                  to={problemPath(continueTarget.slug)}
                  title={`${continueTarget.title} · ${continueTarget.label}`}
                >
                  {continueTarget.label} <span aria-hidden="true">→</span>
                </Link>
              ) : null}
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
                  <span style={{ width: `${(solvedCount / problems.length) * 100}%` }} />
                </div>
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
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>
          <select
            aria-label="정렬"
            value={sort}
            onChange={(event) => changeSort(event.target.value)}
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

        {session ? (
          <div className="filter-bar" role="group" aria-label="풀이 상태 필터">
            <span className="filter-label">상태</span>
            {statusChips.map((item) => (
              <button
                key={item.value}
                className={`filter-chip ${status === item.value ? "selected" : ""}`}
                aria-pressed={status === item.value}
                onClick={() => update({ s: item.value || null })}
              >
                {item.label}
                <span className="chip-count">{statusCount(item.value)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="filter-bar" role="group" aria-label="난이도 필터">
          <span className="filter-label">난이도</span>
          <button
            className={`filter-chip ${selectedDifficulties.length === 0 ? "selected" : ""}`}
            aria-pressed={selectedDifficulties.length === 0}
            onClick={() => toggleDifficulty("")}
          >
            전체
            <span className="chip-count">{difficultyCount("")}</span>
          </button>
          {difficultyOptions.map((item) => (
            <button
              key={item.value}
              className={`filter-chip ${selectedDifficulties.includes(item.value) ? "selected" : ""}`}
              aria-pressed={selectedDifficulties.includes(item.value)}
              onClick={() => toggleDifficulty(item.value)}
            >
              {item.label}
              <span className="chip-count">{difficultyCount(item.value)}</span>
            </button>
          ))}
          <span className="filter-spacer" />
          <button
            className={`filter-chip filter-chip-star ${favoritesOnly ? "selected" : ""}`}
            aria-pressed={favoritesOnly}
            onClick={() => update({ fav: favoritesOnly ? null : "1" })}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" className="chip-star">
              <path
                d="m12 3.4 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.4Z"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            즐겨찾기
            <span className="chip-count">{favoriteCount}</span>
          </button>
          {hasFilter ? (
            <button className="inline-button" onClick={resetFilters}>
              필터 초기화
            </button>
          ) : null}
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
                    onClick={() => changeSort("latest")}
                  >
                    기본 순서로
                  </button>
                </>
              ) : null}
            </div>
            <span className="total-count">
              {filtered.length}문제
              {filtered.length
                ? ` 중 ${(current - 1) * PAGE_SIZE + 1}–${(current - 1) * PAGE_SIZE + visible.length}`
                : ""}
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
                <div className="problem-row-wrap" key={problem.id}>
                  <FavoriteButton
                    active={favorites.has(problem.id)}
                    title={problem.title}
                    onToggle={() => toggleFavorite(problem.id)}
                  />
                  <Link className="problem-row" to={problemPath(problem.slug)}>
                    <span className="problem-title">
                      <strong>{problem.title}</strong>
                    </span>
                    <ProblemStatus state={stateOf(problem)} />
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
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {hasFilter ? (
                <>
                  <strong>조건에 맞는 문제가 없어요.</strong>
                  <p>
                    {keyword ? `‘${urlQuery.trim()}’ 검색어와 ` : ""}선택한 필터를
                    유지한 채 결과가 없습니다. 조건을 줄여 다시 찾아보세요.
                  </p>
                  <button className="button button-soft" onClick={resetFilters}>
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
            onChange={(next) =>
              update({ page: next === 1 ? null : String(next) }, { resetPage: false })
            }
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
          {!session ? (
            <div className="brand-card">
              <BrandArt />
              <h2>게임처럼 성장하는 온라인 저지</h2>
              <p>
                풀수록 레벨이 오르고 랭킹·미션으로 이어집니다. 마음에 드는 문제를
                골라 바로 풀어 보세요.
              </p>
            </div>
          ) : null}
          <div className="guide-card">
            <h2>나에게 맞는 문제 찾기</h2>
            <ol>
              <li>
                <button onClick={() => update({ d: "BEGINNER" })}>
                  <strong>쉬운 난이도로 시작하기</strong>
                  <span>부담 없는 문제부터 차근차근</span>
                </button>
              </li>
              <li>
                <button onClick={() => update({ d: "MEDIUM" })}>
                  <strong>보통 난이도에 도전하기</strong>
                  <span>익숙해졌다면 한 단계 위로</span>
                </button>
              </li>
              {session ? (
                <li>
                  <button onClick={() => update({ s: "none" })}>
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
