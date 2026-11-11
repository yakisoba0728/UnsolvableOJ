import { Eye, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import guideArt from "../assets/community-guide.png";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { Select } from "../components/Select";
import { RangeCount } from "../components/RangeCount";
import { SkeletonRows } from "../components/Skeleton";
import { SlideToggle } from "../components/SlideToggle";
import { listPosts, type Page } from "../community/api";
import { relativeTime } from "../community/store";
import {
  categories,
  categoryLabel,
  normalizeTag,
  type CategoryKey,
  type CommunityPost,
} from "../community/types";
import {
  useDocumentTitle,
  useFlashNotice,
  useMyCommunityPosts,
  useRequest,
  useSlashFocus,
  useStickyTop,
  useUrlFilters,
} from "../hooks";
import { isImeEnter } from "../keyboard";

const PAGE_SIZE = 10;
/** 서버가 받는 쪽 번호의 상한 */
const MAX_PAGE = 100_000;
const NOTICE_MS = 4000;

const sortOptions = [
  { value: "latest", label: "최신순" },
  { value: "views", label: "조회순" },
  { value: "votes", label: "추천순" },
  { value: "answers", label: "답변순" },
];

type AcceptStatus = "unaccepted" | "accepted";

const statusOptions = [
  { value: "", label: "전체" },
  { value: "unaccepted", label: "채택 전" },
  { value: "accepted", label: "채택 완료" },
];

const emptyPage: Page<CommunityPost> = {
  items: [],
  total: 0,
  page: 1,
  totalPages: 0,
};

const isCategory = (value: string): value is CategoryKey =>
  categories.some((item) => item.key === value);

const isAcceptStatus = (value: string): value is AcceptStatus =>
  value === "unaccepted" || value === "accepted";

/** 쉼표로 이은 URL 값 */
const listParam = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? "").split(",");

// tag를 반복해 쉼표·공백이 든 태그도 보존한다. 기존 t=a,b 주소도 계속 읽는다.
const tagsOf = (params: URLSearchParams) => [
  ...new Set([...params.getAll("tag"), ...listParam(params, "t")].filter(Boolean)),
];

/** URL에 저장된 목록 조건. 알 수 없는 값은 버린다. */
function readFilters(params: URLSearchParams) {
  const sort = params.get("sort") ?? "";
  return {
    categories: listParam(params, "c").filter(isCategory),
    statuses: listParam(params, "s").filter(isAcceptStatus),
    sort: sortOptions.some((item) => item.value === sort) ? sort : "latest",
    problemId: params.get("problemId"),
    tags: tagsOf(params),
  };
}

type Filters = ReturnType<typeof readFilters>;

/** 서버에 보낼 목록 조건 */
function listQuery(filters: Filters, keyword: string, page: number) {
  // 고정 공지는 분류·상태 필터와 상관없이 항상 목록 맨 위에 보인다(검색어·태그는 그대로 적용).
  const query = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
    sort: filters.sort,
    includePinned: "true",
  });
  if (filters.categories.length)
    query.set("categories", filters.categories.join(",").toUpperCase());
  if (filters.statuses.length) query.set("status", filters.statuses.join(","));
  if (keyword) query.set("q", keyword);
  filters.tags.forEach((tag) => query.append("tag", tag));
  if (filters.problemId) query.set("problemId", filters.problemId);
  return query;
}

/** 1쪽은 주소에 남기지 않는다. */
const pageParam = (page: number) => (page === 1 ? null : String(page));

export function CommunityPage() {
  useDocumentTitle("커뮤니티");
  const { session } = useAuth();
  const navigate = useNavigate();
  const [notice] = useFlashNotice(NOTICE_MS);
  // '#단어'는 Enter를 눌러 태그가 되기 전까지 검색어로 쓰지 않는다(입력 중에 목록이 비는 것을 막는다).
  const { params, update, urlQuery, queryText, setQueryText, page } =
    useUrlFilters((text) => text.trim().startsWith("#"));
  const filters = readFilters(params);
  const { problemId, tags: selectedTags } = filters;
  // 팔로잉 필터는 로그인했을 때만 쓴다(서버가 내 팔로우 목록으로 거른다).
  const followingOnly = Boolean(session) && params.get("following") === "1";

  function setTags(next: string[]) {
    update({ t: null, tag: next });
  }

  /** 작성 화면처럼 Enter로 태그를 확정한다. 쉼표와 공백은 태그의 일부다. */
  function commitTag(raw: string) {
    if (!raw.trim().startsWith("#")) return false;
    const tag = normalizeTag(raw);
    if (!tag) return false;
    // 빠르게 이어서 확정해도 앞 태그를 잃지 않도록 최신 조건에서 계산한다.
    update((latest) => {
      const current = tagsOf(latest);
      const exists = current.some(
        (item) => item.toLowerCase() === tag.toLowerCase(),
      );
      return { t: null, tag: exists ? current : [...current, tag], q: null };
    });
    setQueryText("");
    return true;
  }

  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const sideRef = useRef<HTMLElement>(null);
  useStickyTop(sideRef);

  const [retry, setRetry] = useState(0);
  const keyword = urlQuery.trim();
  // 서버의 쪽 번호 상한을 넘는 주소는 상한까지만 보내고, 아래에서 마지막 쪽으로 옮긴다.
  const requestedPage = Math.min(page, MAX_PAGE);
  const query = listQuery(filters, keyword, requestedPage);
  if (followingOnly) query.set("following", "true");
  const {
    data: remote,
    loading,
    error: loadError,
  } = useRequest<Page<CommunityPost>>(
    (signal) =>
      listPosts(query, signal, followingOnly ? session?.accessToken : undefined),
    emptyPage,
    "글 목록을 불러오지 못했어요.",
    [query.toString(), retry],
  );
  // 없는 쪽을 열면 마지막 쪽으로 옮긴다.
  useEffect(() => {
    if (remote.totalPages > 0 && requestedPage > remote.totalPages)
      update({ page: pageParam(remote.totalPages) }, { resetPage: false });
  }, [remote]);

  const followed = new Set(useMyCommunityPosts(session).data.following);

  // 칩 개수는 "그 칩을 눌렀을 때의 결과 수"다. 고정 공지는 공지·전체 칩과 '채택 전'·전체 칩에 들어간다.
  const categoryCount = (value: CategoryKey | "") =>
    remote.facets?.categories[value.toUpperCase()] ?? 0;
  const statusCount = (value: string) => remote.facets?.statuses[value] ?? 0;

  const totalPages = Math.max(1, remote.totalPages);
  const current = Math.min(requestedPage, totalPages);
  const first = (current - 1) * PAGE_SIZE;
  const ready = !loading && !loadError;
  const visible = ready ? remote.items : [];
  const total = ready ? remote.total : 0;
  const hasFilter = Boolean(
    filters.categories.length ||
      filters.statuses.length ||
      selectedTags.length ||
      keyword ||
      problemId ||
      followingOnly,
  );
  const listSearch = params.toString() ? `?${params.toString()}` : "";

  function write(initialCategory?: CategoryKey) {
    // 문제 화면에서 들어왔으면 새 글에도 그 문제를 이어 붙인다.
    const target = problemId
      ? `/community/new?${new URLSearchParams({ problemId })}`
      : "/community/new";
    if (session) navigate(target, { state: { category: initialCategory } });
    else navigate("/auth", { state: { from: target } });
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
          <TagSearch
            inputRef={searchRef}
            tags={selectedTags}
            text={queryText}
            onTextChange={setQueryText}
            onCommit={commitTag}
            onTagsChange={setTags}
          />
          <Select
            ariaLabel="정렬"
            value={filters.sort}
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
              values={filters.categories}
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
              values={filters.statuses}
              options={statusOptions.map((item) => ({
                ...item,
                count: statusCount(item.value),
              }))}
              defaultValue=""
              onChangeValues={(next) => update({ s: next.join(",") || null })}
            />
          </div>
          {session ? (
            <div className="filter-bar">
              <span className="filter-label">작성자</span>
              <SlideToggle
                ariaLabel="작성자 필터"
                value={followingOnly ? "following" : ""}
                options={[
                  { value: "", label: "전체" },
                  { value: "following", label: "팔로잉" },
                ]}
                defaultValue=""
                onChange={(next) =>
                  update({ following: next === "following" ? "1" : null })
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="community-layout">
        <section aria-label="커뮤니티 글 목록">
          <div className="section-heading compact">
            <div className="title-line">
              <h2>{hasFilter ? "검색 결과" : "전체 글"}</h2>
              {keyword ? (
                <button
                  type="button"
                  className="inline-button"
                  onClick={() => {
                    setQueryText("");
                    update({ q: null });
                  }}
                >
                  “{keyword}” 지우기
                </button>
              ) : null}
            </div>
            <RangeCount
              loading={loading}
              first={first}
              count={visible.length}
              total={total}
              withTitle
            />
          </div>
          {problemId ? (
            <p className="muted">
              문제에 연결된 글만 보고 있어요.{" "}
              <button
                type="button"
                className="inline-button"
                onClick={() => update({ problemId: null })}
              >
                문제 필터 해제
              </button>
            </p>
          ) : null}
          {loading ? (
            <SkeletonRows count={6} />
          ) : loadError ? (
            <div className="empty-state" role="alert">
              <strong>글 목록을 불러오지 못했어요.</strong>
              <p>{loadError}</p>
              <button
                type="button"
                className="button"
                onClick={() => setRetry((count) => count + 1)}
              >
                다시 시도
              </button>
            </div>
          ) : visible.length ? (
            <ul className="post-list data-list list-posts">
              <li className="post-head" aria-hidden="true">
                <span>분류</span>
                <span>제목</span>
                <span>추천</span>
                <span>조회 수</span>
              </li>
              {visible.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  listSearch={listSearch}
                  followed={Boolean(post.authorId && followed.has(post.authorId))}
                />
              ))}
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

          {total > 0 ? (
            <div className="community-pager">
              <Pagination
                page={current}
                totalPages={totalPages}
                onChange={(next) =>
                  update({ page: pageParam(next) }, { resetPage: false })
                }
              />
            </div>
          ) : null}
        </section>

        <aside className="side-stack" ref={sideRef}>
          <CommunityGuide onWrite={write} />
        </aside>
      </div>
    </div>
  );
}

/** 검색칸: 확정한 태그 칩과 검색어 입력. '#단어' + Enter로 태그를 더한다. */
function TagSearch({
  inputRef,
  tags,
  text,
  onTextChange,
  onCommit,
  onTagsChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  tags: string[];
  text: string;
  onTextChange: (value: string) => void;
  onCommit: (raw: string) => boolean;
  onTagsChange: (next: string[]) => void;
}) {
  return (
    <div className="search-field">
      <div className="search-box" onClick={() => inputRef.current?.focus()}>
        {tags.map((tag) => (
          <span className="search-tag" key={tag}>
            <span aria-hidden="true">#</span>
            {tag}
            <button
              type="button"
              className="search-tag-remove"
              aria-label={`태그 #${tag} 지우기`}
              onClick={(event) => {
                event.stopPropagation();
                onTagsChange(tags.filter((item) => item !== tag));
                inputRef.current?.focus();
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder={
            tags.length
              ? "더 검색하거나 #태그 추가"
              : "질문·풀이 검색 (#태그 + Enter)"
          }
          aria-label="게시글 검색"
          aria-keyshortcuts="/"
          maxLength={100}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (isImeEnter(event)) return;
            if (event.key === "Enter" && onCommit(text)) {
              event.preventDefault();
            } else if (event.key === "Backspace" && !text && tags.length) {
              // 입력칸이 비어 있을 때 Backspace로 마지막 태그를 지운다.
              onTagsChange(tags.slice(0, -1));
            }
          }}
        />
      </div>
    </div>
  );
}

function PostRow({
  post,
  listSearch,
  followed,
}: {
  post: CommunityPost;
  listSearch: string;
  followed: boolean;
}) {
  const views = post.views.toLocaleString();
  return (
    <li>
      <Link
        className={`post-row ${post.pinned ? "pinned" : ""}`}
        to={`/community/${post.id}`}
        state={{ listSearch }}
      >
        <span className="post-category">{categoryLabel(post.category)}</span>
        <span className="post-main">
          <span className="post-title-line">
            <strong className="post-title" title={post.title}>
              {post.title}
            </strong>
            <span className="post-answer-badge" title="달린 답변의 수">
              답변 {post.commentCount ?? 0}
            </span>
            {post.acceptedCommentId ? (
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
              {followed ? (
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
          aria-label={`추천 ${post.upvotes}`}
        >
          <ThumbsUp size={14} aria-hidden="true" />
          {post.upvotes}
        </span>
        <span className="post-num post-num-view" aria-label={`조회 ${views}`}>
          <Eye size={14} aria-hidden="true" />
          {views}
        </span>
      </Link>
    </li>
  );
}

const guideColumns: {
  title: string;
  points: string[];
  action: string;
  category?: CategoryKey;
}[] = [
  {
    title: "질문을 올리기 전 확인해 보세요.",
    points: [
      "어떤 문제에서 막혔나요?",
      "시도한 코드와 입력은 무엇인가요?",
      "기대한 결과와 실제 결과가 다른가요?",
    ],
    action: "질문 작성하기",
  },
  {
    title: "풀이를 나누는 공간",
    points: [
      "정답뿐 아니라 생각한 과정도 남겨요.",
      "시간·메모리 복잡도를 함께 적어요.",
      "다른 관점이 더 좋은 풀이로 이어져요.",
    ],
    action: "풀이 공유하기",
    category: "solution",
  },
];

function CommunityGuide({
  onWrite,
}: {
  onWrite: (category?: CategoryKey) => void;
}) {
  return (
    <div className="community-guide">
      <div className="community-guide-head">
        <h2>질문하고 풀이를 나누면 막힌 곳이 풀려요.</h2>
        <img src={guideArt} alt="" width="232" height="186" />
      </div>
      <div className="community-guide-cols">
        {guideColumns.map((column) => (
          <div className="guide-col" key={column.action}>
            <h3>{column.title}</h3>
            <ul>
              {column.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <button
              type="button"
              className="button"
              onClick={() => onWrite(column.category)}
            >
              {column.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
