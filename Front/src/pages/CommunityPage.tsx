import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import guideArt from "../assets/community-guide.png";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
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
import { useDocumentTitle } from "../hooks";

const PAGE_SIZE = 10;

const sortOptions = [
  { value: "latest", label: "최신순" },
  { value: "votes", label: "추천순" },
  { value: "answers", label: "답변 많은 순" },
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
  const activity = useActivity();
  const [params, setParams] = useSearchParams();

  const categoryParam = params.get("c");
  const category = isCategory(categoryParam) ? categoryParam : null;
  const status = params.get("s") ?? "";
  const sort = params.get("sort") ?? "latest";
  const urlQuery = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = PAGE_SIZE;

  // 검색어는 입력 중에는 로컬 상태로 두고, 잠시 멈추면 주소에 반영한다.
  const [queryText, setQueryText] = useState(urlQuery);
  useEffect(() => setQueryText(urlQuery), [urlQuery]);
  useEffect(() => {
    if (queryText === urlQuery) return;
    const timer = window.setTimeout(() => {
      update({ q: queryText.trim() || null });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText]);

  function update(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 필터 메뉴: 버튼으로 열고, 바깥 클릭·Esc로 닫는다 (Esc는 버튼으로 포커스를 돌려준다).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const posts = allPosts(activity);
  const answerCount = (post: CommunityPost) =>
    answersOf(activity, post.id).length;

  const filtered = useMemo(() => {
    const keyword = urlQuery.trim().toLowerCase();
    const list = posts.filter((post) => {
      const matchesKeyword =
        !keyword ||
        post.title.toLowerCase().includes(keyword) ||
        post.body.toLowerCase().includes(keyword) ||
        post.tags.some((tag) => tag.toLowerCase().includes(keyword));
      // 고정 공지는 분류·상태 필터와 상관없이 항상 보인다(검색어는 그대로 적용)
      if (post.pinned) return matchesKeyword;
      if (category && post.category !== category) return false;
      if (status === "unaccepted" && acceptedAnswerId(activity, post.id) !== null)
        return false;
      if (status === "accepted" && acceptedAnswerId(activity, post.id) === null)
        return false;
      return matchesKeyword;
    });
    list.sort((a, b) => {
      // 고정 공지는 항상 맨 위
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (sort === "votes") return b.upvotes - a.upvotes;
      if (sort === "answers") return answerCount(b) - answerCount(a);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, category, status, sort, urlQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, totalPages);
  const first = (current - 1) * size;
  const visible = filtered.slice(first, first + size);
  const activeFilters = [
    category ? { key: "c", label: categoryLabel(category) } : null,
    status
      ? { key: "s", label: statusOptions.find((item) => item.value === status)?.label ?? status }
      : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
  const hasFilter = Boolean(activeFilters.length || urlQuery.trim());

  // 필터 태그: 추가는 나타나고, 삭제는 사라진 뒤에 목록에서 빼서 자연스럽게 보이게 한다.
  const [chips, setChips] = useState<
    { key: string; label: string; leaving: boolean }[]
  >(() => activeFilters.map((item) => ({ ...item, leaving: false })));
  const activeSignature = activeFilters
    .map((item) => `${item.key}:${item.label}`)
    .join("|");
  useEffect(() => {
    setChips((previous) => {
      const next = previous.map((chip) => {
        const active = activeFilters.find((item) => item.key === chip.key);
        return active
          ? { ...chip, label: active.label, leaving: false }
          : { ...chip, leaving: true };
      });
      for (const item of activeFilters)
        if (!next.some((chip) => chip.key === item.key))
          next.push({ ...item, leaving: false });
      return next;
    });
    const timer = window.setTimeout(
      () => setChips((previous) => previous.filter((chip) => !chip.leaving)),
      240,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSignature]);
  // 필터 개수 배지는 사라지는 동안에도 마지막 숫자를 보여 준다.
  const lastCount = useRef(activeFilters.length);
  if (activeFilters.length) lastCount.current = activeFilters.length;

  function write(initialCategory?: CategoryKey) {
    if (session) navigate("/community/new", { state: { category: initialCategory } });
    else navigate("/auth", { state: { from: "/community/new" } });
  }

  return (
    <div className="page-width community-page">
      <PageHeader
        title="막힌 문제, 같이 풀어요."
        description="막힌 코드는 물어보고, 나만의 풀이는 나눠 보세요."
      />

      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder="질문이나 풀이를 검색해 보세요"
              aria-label="게시글 검색"
              aria-keyshortcuts="/"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>
            <div className="filter-menu" ref={menuRef}>
              <button
                type="button"
                ref={menuButtonRef}
                className={`button button-outline filter-menu-button ${activeFilters.length ? "active" : ""}`}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-controls="community-filter-menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                필터
                <span
                  className={`filter-count ${activeFilters.length ? "show" : ""}`}
                  aria-hidden={!activeFilters.length}
                >
                  {lastCount.current}
                </span>
              </button>
              {menuOpen ? (
                <div className="filter-popover" id="community-filter-menu" role="group" aria-label="필터">
                  <div className="filter-group">
                    <strong>카테고리</strong>
                    <SlideToggle
                      ariaLabel="카테고리"
                      value={category ?? ""}
                      options={[
                        { value: "", label: "전체" },
                        ...categories.map((item) => ({ value: item.key, label: item.label })),
                      ]}
                      defaultValue=""
                      onChange={(next) => update({ c: next || null })}
                    />
                  </div>
                  <div className="filter-group">
                    <strong>상태</strong>
                    <SlideToggle
                      ariaLabel="상태"
                      value={status}
                      options={statusOptions}
                      defaultValue=""
                      onChange={(next) => update({ s: next || null })}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <SlideToggle
              className="sort-toggle"
              ariaLabel="정렬"
              value={sort}
              options={sortOptions}
              onChange={(next) => update({ sort: next === "latest" ? null : next })}
            />
        </div>
        <div className={`applied-wrap ${activeFilters.length ? "open" : ""}`}>
          <div className="applied-inner">
            <div className="filter-bar applied-bar" role="group" aria-label="적용된 필터">
              {chips.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`filter-chip selected ${item.leaving ? "leaving" : ""}`}
                  tabIndex={item.leaving ? -1 : 0}
                  onClick={() => update({ [item.key]: null })}
                >
                  {item.label} <span aria-hidden="true">✕</span>
                  <span className="sr-only">{item.label} 필터 해제</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="community-layout">
        <section aria-label="커뮤니티 글 목록">
          <div className="section-heading compact">
            <div className="title-line">
              <h2>{hasFilter ? "검색 결과" : "전체 글"}</h2>
              {urlQuery.trim() ? (
                <button type="button" className="inline-button" onClick={() => { setQueryText(""); update({ q: null }); }}>
                  “{urlQuery.trim()}” 지우기
                </button>
              ) : null}
            </div>
            <span className="total-count">{filtered.length}개</span>
          </div>
          {visible.length ? (
            <ul className="post-list">
              {visible.map((post) => {
                const count = answerCount(post);
                const accepted = acceptedAnswerId(activity, post.id) !== null;
                return (
                  <li key={post.id}>
                    <Link
                      className={`post-row ${post.pinned ? "pinned" : ""}`}
                      to={`/community/${post.id}`}
                      state={{ listSearch: params.toString() ? `?${params.toString()}` : "" }}
                    >
                      <span className="post-category">
                        {categoryLabel(post.category)}
                      </span>
                      <span className="post-main">
                        <span className="post-title-line">
                          <strong className="post-title">{post.title}</strong>
                          <span
                            className={`post-answer-badge ${accepted ? "accepted" : ""}`}
                            aria-label={`답변 ${count}개${accepted ? ", 채택 완료" : ""}`}
                          >
                            {accepted ? "✓ " : ""}답변 {count}
                          </span>
                        </span>
                        <span className="post-meta">
                          {post.author.name} · {relativeTime(post.createdAt)}
                          {post.pinned ? " · 고정" : ""}
                        </span>
                      </span>
                      <span className="post-stats-cols">
                        <span>
                          <b>{upvoteCount(activity, post.id, post.upvotes)}</b>
                          <small>추천</small>
                        </span>
                        <span>
                          <b>{post.views.toLocaleString()}</b>
                          <small>조회</small>
                        </span>
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
                  <button type="button" className="button" onClick={() => write()}>
                    글쓰기
                  </button>
                </>
              )}
            </div>
          )}

          {visible.length > 0 && visible.length < 4 ? (
            <div className="community-nudge">
              <span>찾는 글이 없나요? 궁금한 점을 직접 질문해 보세요.</span>
              <button type="button" className="button button-small" onClick={() => write()}>
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
                update({ page: next === 1 ? null : String(next) }, { resetPage: false })
              }
            />
          </div>
          ) : null}
        </section>

        <aside className="side-stack">
          <div className="community-guide">
            <div className="community-guide-head">
              <h2>질문을 주고 받으며 풀이를 공유하면 모두의 힘이 됩니다.</h2>
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
                <button type="button" className="button" onClick={() => write()}>
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
