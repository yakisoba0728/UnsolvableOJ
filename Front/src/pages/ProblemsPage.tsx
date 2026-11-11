import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Link } from "react-router-dom";
import { canAuthor, useAuth } from "../auth";
import { BrandArt } from "../components/BrandArt";
import { DifficultyBadge } from "../components/DifficultyBadge";
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
  useDocumentTitle,
  pickResume,
  useRequest,
  useMyStanding,
  useSlashFocus,
  useStickyTop,
  useSubmissionHistory,
  useUrlFilters,
} from "../hooks";
import { problemPath } from "../paths";
import { newSeed } from "../shuffle";
import type { Difficulty, ProblemListPage, ProblemSummary } from "../types";
import {
  DIFFICULTIES as order,
  difficultyLabel,
  difficultyOptions,
} from "../difficulty";

const PAGE_SIZE = 20;
/** 서버의 검색어 길이 상한 */
const SEARCH_MAX = 100;

const EMPTY_PAGE: ProblemListPage = {
  items: [],
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

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
  const history = useSubmissionHistory(session);
  const { profile, rank, profileLoading, rankLoading, profileError, rankError, retryProfile, retryRank } =
    useMyStanding(session);
  const { params, update, urlQuery, queryText, setQueryText, page } =
    useUrlFilters();
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const sideRef = useRef<HTMLElement>(null);
  useStickyTop(sideRef);
  const [announce, setAnnounce] = useState("");
  // 다시 섞기 아이콘을 누를 때마다 화살표가 오른쪽으로 빠져나갔다 왼쪽에서 다시 들어오게 한다(키가 바뀌면 애니메이션이 처음부터 다시 실행된다).
  const [spinKey, setSpinKey] = useState(0);
  // 순서 뒤집기 아이콘: 누를 때마다 위·아래 화살표가 각자 방향으로 움직였다가 돌아온다.
  const [reverseKey, setReverseKey] = useState(0);

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
  const selectedTag = params.get("t") ?? "";
  const rawSort = params.get("sort") ?? "latest";
  const legacySort = legacySorts[rawSort];
  // 모르는 정렬 이름은 서버가 거절하므로 기본 정렬로 읽는다.
  const sort = sorts.some((item) => item.value === (legacySort?.sort ?? rawSort))
    ? (legacySort?.sort ?? rawSort)
    : "latest";
  // 기본 순서(최신순=최신 먼저, 난이도순=쉬운 것 먼저, 푼 사람순=많은 순, 정답률순=높은 순)를 뒤집은 상태
  const reversed =
    (params.get("rev") === "1") !== Boolean(legacySort?.reversed);
  // 서버가 받는 범위(1 이상 2^31-1 이하의 정수)로 맞춘다.
  const seed = Math.floor(Math.abs(Number(params.get("seed")))) % 2147483647 || 1;

  const keyword = urlQuery.trim();
  const isSingle = (value: string) =>
    selectedDifficulties.length === 1 && selectedDifficulties[0] === value;
  const stateOf = (problem: ProblemSummary) =>
    solveState(problem.id, history.solved, history.attempted);

  // 검색·필터·정렬·쪽은 서버가 처리한다. 조건이 바뀌면 useRequest가 앞선 요청을 취소하고 다시 받는다.
  const request = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  // 글자(코드 포인트) 단위로 자른다: 서로게이트 쌍이 잘리면 서버가 거절한다.
  if (keyword) request.set("q", Array.from(keyword).slice(0, SEARCH_MAX).join(""));
  if (selectedDifficulties.length)
    request.set("difficulty", selectedDifficulties.join(","));
  if (selectedTag) request.set("tag", selectedTag);
  if (statuses.length) request.set("solve", statuses.join(","));
  if (sort !== "latest") request.set("sort", sort);
  if (sort === "random") request.set("seed", String(seed));
  else if (reversed) request.set("reverse", "true");
  const requestKey = request.toString();
  const {
    data: loaded,
    loading,
    error,
    retry,
  } = useRequest(
    (signal) =>
      api<ProblemListPage>(
        `/problems?${requestKey}`,
        { signal },
        session?.accessToken,
      ),
    EMPTY_PAGE,
    "문제를 불러오지 못했습니다.",
    [requestKey, session],
    // 조건을 바꿔도 새 결과가 올 때까지 앞선 목록을 보여 주고(깜빡임 없음), 연달아 바꾸면 마지막 조건으로 한 번만 요청한다.
    { keepPrevious: true, debounceMs: 150 },
  );
  // 실패한 요청의 조건에는 앞선 목록을 보이지 않는다.
  const list = error ? EMPTY_PAGE : loaded;
  const problems = list.items;
  // 이미 보이는 목록이 있으면 새로 받는 동안 그대로 두고 흐리게만 한다. 보일 목록이 없을 때만 스켈레톤을 쓴다.
  const refreshing = loading && problems.length > 0;
  const showSkeleton = loading && !refreshing;
  // 태그 목록은 다시 받는 동안에도 앞서 받은 것을 보여 준다(고르는 칸이 사라졌다 생기지 않게).
  const lastTags = useRef<{ tag: string; count: number }[]>([]);
  if (!loading && list.facets?.tags) lastTags.current = list.facets.tags;

  const statusCount = (value: "" | SolveState) =>
    list.facets?.solves?.[value] ?? 0;
  const difficultyCount = (value: Difficulty | "") =>
    list.facets?.difficulties?.[value] ?? 0;

  const tagCounts = new Map(
    lastTags.current.map((item) => [item.tag, item.count]),
  );
  if (selectedTag && !tagCounts.has(selectedTag)) tagCounts.set(selectedTag, 0);
  const tagOptions = [
    { value: "", label: "모든 태그" },
    ...[...tagCounts.keys()]
      .sort(
        (a, b) =>
          (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0) ||
          a.localeCompare(b, "ko"),
      )
      .map((tag) => ({ value: tag, label: `${tag} (${tagCounts.get(tag) ?? 0})` })),
  ];

  const total = list.total;
  const totalPages = Math.max(1, list.totalPages);
  const current = page;
  // 주소의 쪽이 결과보다 뒤면(결과가 줄었거나 손으로 고친 주소) 마지막 쪽으로 옮긴다.
  useEffect(() => {
    // list.page가 같아야 지금 주소의 응답이다(조건이 막 바뀐 렌더에는 앞선 응답이 남아 있다).
    if (!loading && !error && list.page === page && page > totalPages)
      update(
        { page: totalPages === 1 ? null : String(totalPages) },
        { resetPage: false },
      );
  }, [loading, error, list.page, page, totalPages]);
  const hasFilter = Boolean(
    selectedDifficulties.length || statuses.length || keyword || selectedTag,
  );

  // 이어 풀 문제(시도했지만 못 푼 가장 최근 문제). 없으면 가장 쉬운 안 푼 문제.
  // 둘 다 서버에 내 풀이 상태로 물어본다: 풀이 중인 공개 문제 전체, 없으면 가장 쉬운 미해결 문제 하나.
  const continuation = useRequest(
    session
      ? async (signal) => {
          const ask = (query: string) =>
            api<ProblemListPage>(
              `/problems?${query}`,
              { signal },
              session.accessToken,
            ).then((result) => result.items);
          const attempted = await ask("solve=attempted&limit=1000");
          return {
            attempted,
            next: attempted.length
              ? null
              : ((await ask("solve=none&sort=difficulty&limit=1"))[0] ?? null),
          };
        }
      : null,
    { attempted: [] as ProblemSummary[], next: null as ProblemSummary | null },
    "이어 풀 문제를 불러오지 못했습니다.",
    [session],
  );
  const recommendationsReady =
    !continuation.loading &&
    !continuation.error &&
    !history.loading &&
    !history.error;
  const resume = recommendationsReady
    ? pickResume(
        history.submissions,
        history.solved,
        continuation.data.attempted,
      )
    : null;
  const resumeProblem = resume
    ? continuation.data.attempted.find(
        (problem) => problem.id === resume.problem.id,
      )
    : undefined;
  const next = recommendationsReady && !resume ? continuation.data.next : null;
  const continueProblem = resumeProblem ?? next;
  const continueTarget = continueProblem
    ? {
        slug: continueProblem.slug,
        title: continueProblem.title,
        label: resumeProblem ? "이어서 풀기" : "다음 문제 풀기",
      }
    : null;
  const continueDifficulty = continueProblem?.difficulty;

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
              placeholder="문제 제목·주소 검색"
              aria-label="문제 검색"
              name="q"
              aria-keyshortcuts="/"
              maxLength={SEARCH_MAX}
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </div>
          {tagOptions.length > 1 ? (
            <Select
              ariaLabel="태그 필터"
              value={selectedTag}
              options={tagOptions}
              onChange={(next) => update({ t: next || null })}
            />
          ) : null}
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
                countsLoading={showSkeleton}
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
              disabled={total < 2}
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
              disabled={total < 2}
            >
              <ReverseIcon playKey={reverseKey} />
            </button>
          )}
        </div>
      </div>

      {error || history.error ? (
        <p className="error-message" role="alert">
          {error || history.error}{" "}
          <button
            type="button"
            className="inline-button"
            onClick={() => {
              if (error) retry();
              if (history.error) history.retry();
            }}
          >
            다시 시도
          </button>
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
              aria-hidden={showSkeleton ? undefined : true}
            >
              {showSkeleton ? (
                <Skeleton width={80} height={14} />
              ) : (
                pageRange((current - 1) * PAGE_SIZE, problems.length, total)
              )}
            </span>
            {loading ? null : (
              <span className="sr-only">
                {pageRangeTitle((current - 1) * PAGE_SIZE, problems.length, total)}
              </span>
            )}
          </div>
          {showSkeleton ? (
            <SkeletonRows count={8} />
          ) : problems.length ? (
            <div
              className={`problem-list data-list list-problems${refreshing ? " is-refreshing" : ""}`}
              aria-busy={refreshing || undefined}
            >
              <div className="problem-head" aria-hidden="true">
                <span>문제</span>
                <span>난이도</span>
                <span>푼 사람</span>
                <span>정답률</span>
              </div>
              {problems.map((problem) => (
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
                    <DifficultyBadge difficulty={problem.difficulty} />
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
          ) : error ? null : (
            <div className="empty-state">
              {hasFilter ? (
                <>
                  <strong>조건에 맞는 문제가 없어요.</strong>
                  <p>
                    {keyword ? `‘${keyword}’ 검색어와 ` : ""}선택한
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
              {profileError}{" "}
              <button type="button" className="inline-button" onClick={retryProfile}>
                다시 시도
              </button>
            </p>
          ) : null}
          {session && rankError ? (
            <p className="error-message" role="alert">
              {rankError}{" "}
              <button type="button" className="inline-button" onClick={retryRank}>
                다시 시도
              </button>
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
                      <DifficultyBadge difficulty={continueDifficulty} />
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
          {canAuthor(session) ? (
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
