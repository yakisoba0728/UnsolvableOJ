import { Eye, ThumbsUp } from "lucide-react";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import guideArt from "../assets/community-guide.png";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { Select } from "../components/Select";
import { SlideToggle } from "../components/SlideToggle";
import {
  acceptedAnswerId,
  allPosts,
  answersOf,
  relativeTime,
  upvoteCount,
  useActivity,
} from "../community/store";
import {
  categories,
  categoryLabel,
  type CategoryKey,
  type CommunityPost,
} from "../community/types";
import {
  useDocumentTitle,
  useFlashNotice,
  useSlashFocus,
  useStickyTop,
  useUrlFilters,
} from "../hooks";
import { pageRange, pageRangeTitle } from "../pageRange";

const PAGE_SIZE = 10;

const sortOptions = [
  { value: "latest", label: "최신순" },
  { value: "views", label: "조회순" },
  { value: "votes", label: "추천순" },
  { value: "answers", label: "답변순" },
];

const statusOptions = [
  { value: "", label: "전체" },
  { value: "unaccepted", label: "채택 전" },
  { value: "accepted", label: "채택 완료" },
];

const isCategory = (value: string | null): value is CategoryKey =>
  categories.some((item) => item.key === value);

export function CommunityPage() {
  useDocumentTitle("커뮤니티");
  const { session } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useFlashNotice();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const activity = useActivity();
  // '#단어'는 Enter를 눌러 태그가 되기 전까지 검색어로 쓰지 않는다(입력 중에 목록이 비는 것을 막는다).
  const { params, update, urlQuery, queryText, setQueryText, page } =
    useUrlFilters((text) => text.trim().startsWith("#"));

  const selectedCategories = (params.get("c") ?? "")
    .split(",")
    .filter((value): value is CategoryKey => isCategory(value));
  const statuses = (params.get("s") ?? "")
    .split(",")
    .filter((value) => value === "unaccepted" || value === "accepted");
  const sort = params.get("sort") ?? "latest";
  // tag를 반복해 쉼표·공백이 든 태그도 보존한다. 기존 t=a,b 주소도 계속 읽는다.
  const selectedTags = [
    ...new Set([
      ...params.getAll("tag"),
      ...(params.get("t") ?? "").split(","),
    ].filter(Boolean)),
  ];
  const size = PAGE_SIZE;

  function setTags(next: string[]) {
    update({ t: null, tag: next });
  }

  /** 작성 화면처럼 Enter로 태그를 확정한다. 쉼표와 공백은 태그의 일부다. */
  function commitTag(raw: string) {
    if (!raw.trim().startsWith("#")) return false;
    const tag = raw.trim().replace(/^#+/, "").trim();
    if (!tag) return false;
    const next = selectedTags.some(
      (item) => item.toLowerCase() === tag.toLowerCase(),
    )
      ? selectedTags
      : [...selectedTags, tag];
    update({ t: null, tag: next, q: null });
    setQueryText("");
    return true;
  }

  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const sideRef = useRef<HTMLElement>(null);
  useStickyTop(sideRef);

  const posts = allPosts(activity);
  const answerCount = (post: CommunityPost) =>
    answersOf(activity, post.id).length;

  const keyword = urlQuery.trim().toLowerCase();
  // 분류·상태 조건을 바꿔 가며 "그 칩을 눌렀을 때의 결과 수"를 셀 수 있게 조건을 인자로 받는다.
  const matches = (
    post: CommunityPost,
    categoryFilter: CategoryKey[],
    statusFilter: string[],
  ) => {
    // 일반 검색어는 제목에서만 찾는다. 태그는 '#단어' + Enter로 만든 태그 알약으로만 거른다.
    const matchesKeyword =
      !keyword || post.title.toLowerCase().includes(keyword);
    // 고른 태그를 모두 가진 글만 보인다(대소문자 무시).
    const matchesTags = selectedTags.every((tag) =>
      post.tags.some((item) => item.toLowerCase() === tag.toLowerCase()),
    );
    // 고정 공지는 분류·상태 필터와 상관없이 항상 보인다(검색어·태그는 그대로 적용)
    if (post.pinned) return matchesKeyword && matchesTags;
    if (categoryFilter.length && !categoryFilter.includes(post.category))
      return false;
    if (statusFilter.length) {
      const accepted = acceptedAnswerId(activity, post.id) !== null;
      // 고른 상태 중 하나라도 맞으면 보인다(채택 전 + 채택 완료 = 전체).
      const ok = statusFilter.some((state) =>
        state === "accepted" ? accepted : !accepted,
      );
      if (!ok) return false;
    }
    return matchesKeyword && matchesTags;
  };
  // 고정 공지는 어떤 필터에서도 목록에 항상 보이지만, 개수는 "그 칩에 실제로 속하는 글"만 센다:
  // 분류는 공지 칩과 전체 칩에만 들어가고, 상태는 채택된 답변이 없으므로 "채택 전"과 전체에 들어간다(검색어·태그는 그대로 적용).
  const belongs = (
    post: CommunityPost,
    categoryFilter: CategoryKey[],
    statusFilter: string[],
  ) => {
    if (!post.pinned) return matches(post, categoryFilter, statusFilter);
    if (categoryFilter.length && !categoryFilter.includes(post.category))
      return false;
    if (
      statusFilter.length &&
      !statusFilter.some((state) => state !== "accepted")
    )
      return false;
    return matches(post, [], []);
  };
  const categoryCount = (value: CategoryKey | "") =>
    posts.filter((post) => belongs(post, value ? [value] : [], statuses))
      .length;
  const statusCount = (value: string) =>
    posts.filter((post) =>
      belongs(post, selectedCategories, value ? [value] : []),
    ).length;

  const filtered = useMemo(() => {
    const list = posts.filter((post) =>
      matches(post, selectedCategories, statuses),
    );
    list.sort((a, b) => {
      // 고정 공지는 항상 맨 위
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (sort === "views") return b.views - a.views;
      if (sort === "votes")
        return (
          upvoteCount(activity, b.id, b.upvotes) -
          upvoteCount(activity, a.id, a.upvotes)
        );
      if (sort === "answers") return answerCount(b) - answerCount(a);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
  }, [
    activity,
    selectedCategories.join(","),
    statuses.join(","),
    JSON.stringify(selectedTags),
    sort,
    urlQuery,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, totalPages);
  const first = (current - 1) * size;
  const visible = filtered.slice(first, first + size);
  const hasFilter = Boolean(
    selectedCategories.length ||
    statuses.length ||
    selectedTags.length ||
    urlQuery.trim(),
  );

  function write(initialCategory?: CategoryKey) {
    if (session)
      navigate("/community/new", { state: { category: initialCategory } });
    else navigate("/auth", { state: { from: "/community/new" } });
  }

  return (
    <div className="page-width community-page">
      <PageHeader
        title="막힌 문제, 같이 풀어요."
        description="막힌 코드는 물어보고, 나만의 풀이는 나눠 보세요."
      />

      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}

      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <div
              className="search-box"
              onClick={() => searchRef.current?.focus()}
            >
              {selectedTags.map((tag) => (
                <span className="search-tag" key={tag}>
                  <span aria-hidden="true">#</span>
                  {tag}
                  <button
                    type="button"
                    className="search-tag-remove"
                    aria-label={`태그 #${tag} 지우기`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setTags(selectedTags.filter((item) => item !== tag));
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                ref={searchRef}
                type="search"
                className="search-input"
                placeholder={
                  selectedTags.length
                    ? "더 검색하거나 #태그 추가"
                    : "질문·풀이 검색 (#태그 + Enter)"
                }
                aria-label="게시글 검색"
                aria-keyshortcuts="/"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                onKeyDown={(event) => {
                  // Safari는 한글 조합 확정 Enter를 isComposing=false, keyCode 229로 보낸다(Enter일 때만 막는다).
                  if (
                    event.nativeEvent.isComposing ||
                    (event.key === "Enter" && event.keyCode === 229)
                  )
                    return;
                  if (event.key === "Enter" && commitTag(queryText)) {
                    event.preventDefault();
                  } else if (
                    event.key === "Backspace" &&
                    !queryText &&
                    selectedTags.length
                  ) {
                    // 입력칸이 비어 있을 때 Backspace로 마지막 태그를 지운다.
                    setTags(selectedTags.slice(0, -1));
                  }
                }}
              />
            </div>
          </div>
          <Select
            ariaLabel="정렬"
            value={sort}
            options={sortOptions}
            onChange={(next) =>
              update({ sort: next === "latest" ? null : next })
            }
          />
        </div>
        <div className="filter-groups">
          <div className="filter-bar">
            <span className="filter-label">분류</span>
            <SlideToggle
              multiple
              ariaLabel="분류 필터"
              values={selectedCategories}
              options={[
                { value: "", label: "전체", count: categoryCount("") },
                ...categories.map((item) => ({
                  value: item.key,
                  label: item.label,
                  count: categoryCount(item.key),
                })),
              ]}
              defaultValue=""
              onChangeValues={(next) => update({ c: next.join(",") || null })}
            />
          </div>
          <div className="filter-bar">
            <span className="filter-label">상태</span>
            <SlideToggle
              multiple
              ariaLabel="채택 상태 필터"
              values={statuses}
              options={statusOptions.map((item) => ({
                ...item,
                count: statusCount(item.value),
              }))}
              defaultValue=""
              onChangeValues={(next) => update({ s: next.join(",") || null })}
            />
          </div>
        </div>
      </div>

      <div className="community-layout">
        <section aria-label="커뮤니티 글 목록">
          <div className="section-heading compact">
            <div className="title-line">
              <h2>{hasFilter ? "검색 결과" : "전체 글"}</h2>
              {urlQuery.trim() ? (
                <button
                  type="button"
                  className="inline-button"
                  onClick={() => {
                    setQueryText("");
                    update({ q: null });
                  }}
                >
                  “{urlQuery.trim()}” 지우기
                </button>
              ) : null}
            </div>
            <span
              className="total-count"
              aria-hidden="true"
              title={pageRangeTitle(first, visible.length, filtered.length)}
            >
              {pageRange(first, visible.length, filtered.length)}
            </span>
            <span className="sr-only">
              {pageRangeTitle(first, visible.length, filtered.length)}
            </span>
          </div>
          {visible.length ? (
            <ul className="post-list data-list list-posts">
              <li className="post-head" aria-hidden="true">
                <span>분류</span>
                <span>제목</span>
                <span>추천</span>
                <span>조회 수</span>
              </li>
              {visible.map((post) => {
                const count = answerCount(post);
                const accepted = acceptedAnswerId(activity, post.id) !== null;
                return (
                  <li key={post.id}>
                    <Link
                      className={`post-row ${post.pinned ? "pinned" : ""}`}
                      to={`/community/${post.id}`}
                      state={{
                        listSearch: params.toString()
                          ? `?${params.toString()}`
                          : "",
                      }}
                    >
                      <span className="post-category">
                        {categoryLabel(post.category)}
                      </span>
                      <span className="post-main">
                        <span className="post-title-line">
                          <strong className="post-title" title={post.title}>
                            {post.title}
                          </strong>
                          <span
                            className="post-answer-badge"
                            title="달린 답변의 수"
                          >
                            답변 {count}
                          </span>
                          {accepted ? (
                            <span
                              className="post-accepted-badge"
                              title="질문자가 답변을 채택했어요"
                            >
                              <span aria-hidden="true">✓</span> 채택 완료
                            </span>
                          ) : null}
                        </span>
                        <span className="post-meta">
                          <span className="post-author">
                            {post.author.name}
                            {activity.followed.includes(post.author.name) ? (
                              <span
                                className="post-follow-badge"
                                title="내가 팔로우한 사람이 쓴 글이에요"
                              >
                                팔로잉
                              </span>
                            ) : null}
                          </span>{" "}
                          · {relativeTime(post.createdAt)}
                          {post.pinned ? " · 고정" : ""}
                        </span>
                      </span>
                      <span
                        className="post-num post-num-up"
                        aria-label={`추천 ${upvoteCount(activity, post.id, post.upvotes)}`}
                      >
                        <ThumbsUp size={14} aria-hidden="true" />
                        {upvoteCount(activity, post.id, post.upvotes)}
                      </span>
                      <span
                        className="post-num post-num-view"
                        aria-label={`조회 ${post.views.toLocaleString()}`}
                      >
                        <Eye size={14} aria-hidden="true" />
                        {post.views.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty-state">
              {hasFilter ? (
                <>
                  <strong>조건에 맞는 글이 없어요.</strong>
                  <p>필터나 검색어를 바꿔 보세요.</p>
                </>
              ) : (
                <>
                  <strong>아직 올라온 글이 없어요.</strong>
                  <p>첫 글을 남겨 보세요.</p>
                  <button
                    type="button"
                    className="button"
                    onClick={() => write()}
                  >
                    글쓰기
                  </button>
                </>
              )}
            </div>
          )}

          {visible.length > 0 && visible.length < 4 ? (
            <div className="community-nudge">
              <span>찾는 글이 없나요? 궁금한 점을 직접 질문해 보세요.</span>
              <button
                type="button"
                className="button button-small"
                onClick={() => write()}
              >
                질문하기
              </button>
            </div>
          ) : null}

          {filtered.length > 0 ? (
            <div className="community-pager">
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
            </div>
          ) : null}
        </section>

        <aside className="side-stack" ref={sideRef}>
          <div className="community-guide">
            <div className="community-guide-head">
              <h2>질문하고 풀이를 나누면 막힌 곳이 풀려요.</h2>
              <img src={guideArt} alt="" width="232" height="186" />
            </div>
            <div className="community-guide-cols">
              <div className="guide-col">
                <h3>질문을 올리기 전 확인해 보세요.</h3>
                <ul>
                  <li>어떤 문제에서 막혔나요?</li>
                  <li>시도한 코드와 입력은 무엇인가요?</li>
                  <li>기대한 결과와 실제 결과가 다른가요?</li>
                </ul>
                <button
                  type="button"
                  className="button"
                  onClick={() => write()}
                >
                  질문 작성하기
                </button>
              </div>
              <div className="guide-col">
                <h3>풀이를 나누는 공간</h3>
                <ul>
                  <li>정답뿐 아니라 생각한 과정도 남겨요.</li>
                  <li>시간·메모리 복잡도를 함께 적어요.</li>
                  <li>다른 관점이 더 좋은 풀이로 이어져요.</li>
                </ul>
                <button
                  type="button"
                  className="button"
                  onClick={() => write("solution")}
                >
                  풀이 공유하기
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
