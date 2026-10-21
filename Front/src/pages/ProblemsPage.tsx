import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { BrandArt } from "../components/BrandArt";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { SlideToggle } from "../components/SlideToggle";
import { Pagination } from "../components/Pagination";
import { pageRange, pageRangeTitle } from "../pageRange";
import { Skeleton, SkeletonRegion, SkeletonRows } from "../components/Skeleton";
import { ReverseIcon } from "../components/ReverseIcon";
import { ShuffleIcon } from "../components/ShuffleIcon";
import {
  ProblemStatus,
  solveState,
  type SolveState,
} from "../components/ProblemStatus";
import {
  useAllProblems,
  useDocumentTitle,
  pickNextProblem,
  pickResume,
  useMyStanding,
  useStickyTop,
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
  { value: "latest", label: "최신순" },
  { value: "difficulty", label: "난이도순" },
  { value: "title", label: "제목순" },
  { value: "solvers", label: "푼 사람순" },
  { value: "rate", label: "정답률순" },
  { value: "random", label: "무작위" },
];

/** 옛 주소(sort=easy 등)도 열리도록 새 정렬 이름과 '뒤집기' 여부로 바꿔 읽는다. */
const legacySorts: Record<string, { sort: string; reversed: boolean }> = {
  easy: { sort: "difficulty", reversed: false },
  hard: { sort: "difficulty", reversed: true },
  "solvers-asc": { sort: "solvers", reversed: true },
  "rate-asc": { sort: "rate", reversed: true },
};

const statusChips: { value: "" | SolveState; label: string }[] = [
  { value: "", label: "전체" },
  { value: "none", label: "미해결" },
  { value: "attempted", label: "풀이 중" },
  { value: "solved", label: "해결" },
];

/**
 * 목록 조건(검색어·난이도·상태·정렬·순서 뒤집기·페이지)은 모두 URL에 저장한다.
 * 문제를 열었다가 뒤로 가도 같은 목록이 복원되고, 주소를 공유할 수 있다. (LeetCode, solved.ac 방식)
 */
export function ProblemsPage() {
  const { session } = useAuth();
  useDocumentTitle("문제 목록");
  const { problems, loading, error } = useAllProblems();
  const history = useSubmissionHistory(session);
  const { profile, rank, profileLoading, rankLoading, profileError, rankError } =
    useMyStanding(session);
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const searchRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  useStickyTop(sideRef);
  const [announce, setAnnounce] = useState("");
  // 다시 섞기 아이콘을 누를 때마다 화살표가 오른쪽으로 빠져나갔다 왼쪽에서 다시 들어오게 한다(키가 바뀌면 애니메이션이 처음부터 다시 실행된다).
  const [spinKey, setSpinKey] = useState(0);
  // 순서 뒤집기 아이콘: 누를 때마다 위·아래 화살표가 각자 방향으로 움직였다가 돌아온다.
  const [reverseKey, setReverseKey] = useState(0);

  const urlQuery = params.get("q") ?? "";
  const selectedDifficulties = (params.get("d") ?? "")
    .split(",")
    .filter((value): value is Difficulty =>
      order.includes(value as Difficulty),
    );
  const statuses = (session ? (params.get("s") ?? "") : "")
    .split(",")
    .filter((value): value is SolveState =>
      ["solved", "attempted", "none"].includes(value),
    );
  const rawSort = params.get("sort") ?? "latest";
  const legacySort = legacySorts[rawSort];
  const sort = legacySort?.sort ?? rawSort;
  // 기본 순서(최신순=최신 먼저, 난이도순=쉬운 것 먼저, 푼 사람순=많은 순, 정답률순=높은 순)를 뒤집은 상태
  const reversed =
    (params.get("rev") === "1") !== Boolean(legacySort?.reversed);
  const seed = Number(params.get("seed")) || 1;
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);

  function update(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(paramsRef.current);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    paramsRef.current = next;
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
  }, [queryText, urlQuery]);

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
  const isSingle = (value: string) =>
    selectedDifficulties.length === 1 && selectedDifficulties[0] === value;
  const stateOf = (problem: ProblemSummary) =>
    solveState(problem.id, history.solved, history.attempted);

  // skip: 해당 그룹의 조건만 빼고 센다 → 칩의 숫자가 "그 칩을 눌렀을 때의 결과 수"가 된다
  const matches = (
    problem: ProblemSummary,
    skip: "difficulty" | "status" | null,
  ) => {
    if (
      skip !== "difficulty" &&
      selectedDifficulties.length &&
      !selectedDifficulties.includes(problem.difficulty)
    )
      return false;
    if (
      skip !== "status" &&
      statuses.length &&
      !statuses.includes(stateOf(problem))
    )
      return false;
    return (
      !keyword ||
      problem.title.toLowerCase().includes(keyword) ||
      problem.slug.toLowerCase().includes(keyword)
    );
  };

  const filtered = useMemo(() => {
    // 무작위: 전체를 한 번 섞은 뒤 필터를 적용한다. 필터를 바꿔도 상대 순서가 유지된다.
    const base =
      sort === "random" ? seededShuffle(problems, seed) : [...problems];
    const dir = reversed ? -1 : 1;
    if (sort === "difficulty")
      base.sort(
        (a, b) =>
          (order.indexOf(a.difficulty) - order.indexOf(b.difficulty)) * dir,
      );
    else if (sort === "title")
      base.sort((a, b) => a.title.localeCompare(b.title, "ko") * dir);
    else if (sort === "solvers")
      base.sort((a, b) => ((b.solverCount ?? 0) - (a.solverCount ?? 0)) * dir);
    else if (sort === "rate")
      // 정답률이 없는(제출 없는) 문제는 뒤집어도 맨 뒤에 둔다.
      base.sort((a, b) => {
        if (a.acceptanceRate == null || b.acceptanceRate == null)
          return (
            Number(a.acceptanceRate == null) - Number(b.acceptanceRate == null)
          );
        return (b.acceptanceRate - a.acceptanceRate) * dir;
      });
    else if (sort !== "random")
      base.sort((a, b) => b.createdAt.localeCompare(a.createdAt) * dir);
    return base.filter((problem) => matches(problem, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    problems,
    sort,
    reversed,
    seed,
    params,
    history.solved,
    history.attempted,
  ]);

  const statusCount = (value: "" | SolveState) =>
    problems.filter(
      (p) => matches(p, "status") && (!value || stateOf(p) === value),
    ).length;
  const difficultyCount = (value: Difficulty | "") =>
    problems.filter(
      (p) => matches(p, "difficulty") && (!value || p.difficulty === value),
    ).length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );
  const hasFilter = Boolean(
    selectedDifficulties.length || statuses.length || keyword,
  );
  const solvedCount = problems.filter((p) => history.solved.has(p.id)).length;

  // 이어 풀 문제(시도했지만 못 푼 가장 최근 문제). 없으면 가장 쉬운 안 푼 문제.
  const recommendationsReady =
    !loading && !error && !history.loading && !history.error;
  const resume = recommendationsReady
    ? pickResume(history.submissions, history.solved, problems)
    : null;
  const resumeProblem = resume
    ? problems.find((problem) => problem.id === resume.problem.id)
    : undefined;
  const next =
    recommendationsReady && !resume
      ? pickNextProblem(problems, history.solved)
      : null;
  const continueTarget = resumeProblem
    ? {
        slug: resumeProblem.slug,
        title: resumeProblem.title,
        label: "이어서 풀기",
      }
    : next
      ? { slug: next.slug, title: next.title, label: "다음 문제 풀기" }
      : null;

  const continueDifficulty = continueTarget
    ? problems.find((problem) => problem.slug === continueTarget.slug)
        ?.difficulty
    : undefined;

  // 목록을 무작위 순서로 섞는다(이동하지 않는다). 선택한 조건 안에서 섞인다.
  function shuffle() {
    update({ sort: "random", seed: String(newSeed()) });
    const scope = selectedDifficulties.length
      ? `${selectedDifficulties.map(difficultyLabel).join("·")} 난이도 `
      : "";
    setAnnounce(`${scope}문제 목록을 무작위로 섞었어요.`);
  }

  // 현재 목록의 순서를 거꾸로 뒤집는다(같은 정렬 안에서의 방향만 바뀐다).
  function reverseOrder() {
    update({
      sort: sort === "latest" ? null : sort,
      rev: reversed ? null : "1",
    });
    setAnnounce(
      reversed ? "목록 순서를 원래대로 되돌렸어요." : "목록 순서를 뒤집었어요.",
    );
  }

  function changeSort(value: string) {
    update({
      rev: null,
      sort: value === "latest" ? null : value,
      // 무작위를 고를 때마다 새 순서를 만든다.
      seed: value === "random" ? String(newSeed()) : null,
    });
  }

  return (
    <div className="page-width problems-page">
      <PageHeader
        title="문제 목록"
        description="한 문제씩, 더 단단해지는 실력. 오늘 풀 문제를 찾아보세요."
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
          </div>
          <Select
            ariaLabel="정렬"
            value={sort}
            options={sorts.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
            onChange={changeSort}
          />
        </div>

        <div className="filter-groups">
          <div className="filter-bar">
            <span className="filter-label">상태</span>
            {session ? (
              <SlideToggle
                multiple
                ariaLabel="풀이 상태 필터"
                countsLoading={loading || history.loading}
                values={statuses}
                options={statusChips.map((item) => ({
                  value: item.value,
                  label: item.label,
                  count: statusCount(item.value),
                }))}
                defaultValue=""
                onChangeValues={(next) => update({ s: next.join(",") || null })}
              />
            ) : (
              <div className="slide-toggle toggle-note">
                <span className="toggle-option">
                  로그인하면 내 풀이 상태가 반영돼요
                </span>
              </div>
            )}
          </div>

          <div className="filter-bar">
            <span className="filter-label">난이도</span>
            <SlideToggle
              multiple
              ariaLabel="난이도 필터"
              countsLoading={loading}
              values={selectedDifficulties}
              options={[
                { value: "", label: "전체", count: difficultyCount("") },
                ...difficultyOptions.map((item) => ({
                  value: item.value,
                  label: item.label,
                  count: difficultyCount(item.value),
                })),
              ]}
              defaultValue=""
              onChangeValues={(next) => update({ d: next.join(",") || null })}
            />
          </div>
          {sort === "random" ? (
            <button
              type="button"
              className="shuffle-icon-button"
              aria-label="무작위로 다시 섞기"
              title="무작위로 다시 섞기"
              onClick={() => {
                setSpinKey((key) => key + 1);
                shuffle();
              }}
              disabled={filtered.length < 2}
            >
              <ShuffleIcon playKey={spinKey} />
            </button>
          ) : (
            <button
              type="button"
              className="shuffle-icon-button reverse-icon-button"
              aria-label="목록 순서 뒤집기"
              aria-pressed={reversed}
              title="목록 순서 뒤집기"
              onClick={() => {
                setReverseKey((key) => key + 1);
                reverseOrder();
              }}
              disabled={filtered.length < 2}
            >
              <ReverseIcon playKey={reverseKey} />
            </button>
          )}
        </div>
      </div>

      {error || history.error ? (
        <p className="error-message" role="alert">
          {error || history.error}
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
            <span
              className="total-count"
              aria-hidden={loading ? undefined : true}
            >
              {loading ? (
                <Skeleton width={80} height={14} />
              ) : (
                pageRange(
                  (current - 1) * PAGE_SIZE,
                  visible.length,
                  filtered.length,
                )
              )}
            </span>
            {loading ? null : (
              <span className="sr-only">
                {pageRangeTitle(
                  (current - 1) * PAGE_SIZE,
                  visible.length,
                  filtered.length,
                )}
              </span>
            )}
          </div>
          {loading ? (
            <SkeletonRows count={8} />
          ) : visible.length ? (
            <div className="problem-list data-list list-problems">
              <div className="problem-head" aria-hidden="true">
                <span>문제</span>
                <span>난이도</span>
                <span>푼 사람</span>
                <span>정답률</span>
              </div>
              {visible.map((problem) => (
                <div className="problem-row-wrap" key={problem.id}>
                  {/* 프로그래머스처럼 문제는 새 탭에서 열어, 목록의 검색·필터·쪽 위치를 그대로 둔다. */}
                  <Link
                    className="problem-row"
                    to={problemPath(problem.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="problem-title">
                      <span className="post-title-line">
                        <strong title={problem.title}>{problem.title}</strong>
                        <span className="sr-only">(새 탭에서 열려요)</span>
                        {session && history.loading ? (
                          <Skeleton width={48} height={16} />
                        ) : stateOf(problem) === "none" ? null : (
                          <ProblemStatus state={stateOf(problem)} />
                        )}
                      </span>
                    </span>
                    <span
                      className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                    >
                      {difficultyLabel(problem.difficulty)}
                    </span>
                    <span className="problem-limit" data-label="푼 사람">
                      {problem.solverCount ?? 0}명
                    </span>
                    <span className="problem-limit" data-label="정답률">
                      {problem.acceptanceRate == null
                        ? "—"
                        : `${problem.acceptanceRate}%`}
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
                    {keyword ? `‘${urlQuery.trim()}’ 검색어와 ` : ""}선택한
                    필터를 유지한 채 결과가 없습니다. 조건을 줄여 다시
                    찾아보세요.
                  </p>
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
              update(
                { page: next === 1 ? null : String(next) },
                { resetPage: false },
              )
            }
          />
        </section>

        <aside className="side-stack" ref={sideRef}>
          {session && profileLoading ? (
            <SkeletonRegion
              className="standing-card"
              label="내 요약을 불러오는 중입니다"
            >
              <Skeleton width={90} height={18} />
              <div className="skeleton-stats">
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
              </div>
              <Skeleton height={40} radius={10} />
            </SkeletonRegion>
          ) : null}
          {session && profileError ? (
            <p className="error-message" role="alert">
              {profileError}
            </p>
          ) : null}
          {session && rankError ? (
            <p className="error-message" role="alert">
              {rankError}
            </p>
          ) : null}
          {profile ? (
            <div className="standing-card">
              <Link to="/profile" className="standing-link">
                <h2>
                  내 요약
                  <span className="card-more" aria-hidden="true">
                    프로필 ›
                  </span>
                </h2>
              </Link>
              <dl>
                <div>
                  <dt>순위</dt>
                  <dd>
                    {rankLoading ? (
                      <Skeleton width={36} height={20} />
                    ) : rank >= 0 ? (
                      `${rank + 1}위`
                    ) : (
                      "—"
                    )}
                  </dd>
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
              {continueTarget ? (
                <div className="standing-continue">
                  <div className="standing-continue-title">
                    <strong>{continueTarget.title}</strong>
                    {continueDifficulty ? (
                      <span
                        className={`difficulty difficulty-${continueDifficulty.toLowerCase()}`}
                      >
                        {difficultyLabel(continueDifficulty)}
                      </span>
                    ) : null}
                  </div>
                  <Link
                    className="button"
                    to={problemPath(continueTarget.slug)}
                    title={`${continueTarget.title} · ${continueTarget.label}`}
                  >
                    {continueTarget.label} <span aria-hidden="true">→</span>
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
          {!session ? (
            <div className="brand-card">
              <BrandArt />
              <h2>게임처럼 성장하는 온라인 저지</h2>
              <p>
                풀수록 레벨이 오르고 랭킹·미션으로 이어집니다. 마음에 드는
                문제를 골라 바로 풀어 보세요.
              </p>
            </div>
          ) : null}
          <div className="guide-card">
            <h2>나에게 맞는 문제 찾기</h2>
            <ol>
              <li>
                <button
                  aria-pressed={isSingle("BEGINNER")}
                  onClick={() => update({ d: "BEGINNER" })}
                >
                  <strong>쉬운 난이도로 시작하기</strong>
                  <span>부담 없는 문제부터 차근차근</span>
                  <i className="row-chevron" aria-hidden="true">
                    ›
                  </i>
                </button>
              </li>
              <li>
                <button
                  aria-pressed={isSingle("MEDIUM")}
                  onClick={() => update({ d: "MEDIUM" })}
                >
                  <strong>보통 난이도에 도전하기</strong>
                  <span>익숙해졌다면 한 단계 위로</span>
                  <i className="row-chevron" aria-hidden="true">
                    ›
                  </i>
                </button>
              </li>
              {session ? (
                <li>
                  <button
                    aria-pressed={
                      statuses.length === 1 &&
                      statuses[0] === "none" &&
                      !selectedDifficulties.length
                    }
                    onClick={() => update({ s: "none", d: null })}
                  >
                    <strong>아직 안 푼 문제만 보기</strong>
                    <span>새로운 문제에 집중해요</span>
                    <i className="row-chevron" aria-hidden="true">
                      ›
                    </i>
                  </button>
                </li>
              ) : null}
            </ol>
          </div>
          {session?.user.role === "AUTHOR" || session?.user.role === "ADMIN" ? (
            <div className="guide-card create-cta">
              <h2>직접 문제를 만들어 보세요</h2>
              <p>
                떠오른 아이디어를 문제로 만들어 다른 사람과 나눠 보세요. 설명과
                예제, 채점용 테스트케이스까지 한 화면에서 만들 수 있어요.
              </p>
              <ol className="create-cta-steps">
                <li>
                  <span>1</span>문제 설명 쓰기
                </li>
                <li>
                  <span>2</span>예제와 숨김 테스트케이스 추가
                </li>
                <li>
                  <span>3</span>검수를 거쳐 공개
                </li>
              </ol>
              <Link className="button button-full" to="/problems/new">
                문제 만들기 <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
