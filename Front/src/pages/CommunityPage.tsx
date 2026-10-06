import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import guideArt from "../assets/community-guide.png";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
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

import { isDemo } from "../api";
import { listPosts, errorMessage, type Page } from "../community/api";
const PAGE_SIZE = 5;

const sortOptions = [
  { value: "latest", label: "최신순" },
  { value: "votes", label: "추천순" },
  { value: "answers", label: "답변 많은 순" },
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
  const sort = params.get("sort") ?? "latest";
  const urlQuery = params.get("q") ?? "";
  const page = Math.min(
    100000,
    Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  );

  // 검색어는 입력 중에는 로컬 상태로 두고, 잠시 멈추면 주소에 반영한다.
  const [queryText, setQueryText] = useState(urlQuery);
  useEffect(() => setQueryText(urlQuery), [urlQuery]);
  useEffect(() => {
    if (queryText.trim() === urlQuery) return;
    const timer = window.setTimeout(() => {
      update({ q: queryText.trim() || null });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText, urlQuery, params]);

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

  const [remote, setRemote] = useState<Page<CommunityPost>>({
    items: [],
    total: 0,
    page: 1,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(!isDemo);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const problemId = params.get("problemId");
  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    const query = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort: ["latest", "votes", "answers"].includes(sort) ? sort : "latest",
    });
    if (category) query.set("category", category.toUpperCase());
    if (urlQuery) query.set("q", urlQuery);
    if (problemId) query.set("problemId", problemId);
    listPosts(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRemote(result);
        if (result.totalPages > 0 && page > result.totalPages)
          update({ page: String(result.totalPages) }, { resetPage: false });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, sort, urlQuery, page, problemId, retry]);
  const posts = allPosts(activity);
  const answerCount = (post: CommunityPost) =>
    answersOf(activity, post.id).length;

  const filtered = useMemo(() => {
    const keyword = urlQuery.trim().toLowerCase();
    const list = posts.filter(
      (post) =>
        (!category || post.category === category) &&
        (!keyword ||
          post.title.toLowerCase().includes(keyword) ||
          post.body.toLowerCase().includes(keyword) ||
          post.tags.some((tag) => tag.toLowerCase().includes(keyword))),
    );
    list.sort((a, b) => {
      // 고정 공지는 항상 맨 위
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (sort === "votes") return b.upvotes - a.upvotes;
      if (sort === "answers") return answerCount(b) - answerCount(a);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, category, sort, urlQuery]);

  const totalPages = isDemo
    ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    : Math.max(1, remote.totalPages);
  const current = Math.min(page, totalPages);
  const visible = isDemo
    ? filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
    : remote.items;
  const hasFilter = Boolean(category || urlQuery.trim());

  function write() {
    if (session)
      navigate(
        `/community/new?${new URLSearchParams({ ...(category ? { c: category } : {}), ...(problemId ? { problemId } : {}) })}`,
      );
    else navigate("/auth", { state: { from: "/community/new" } });
  }

  return (
    <div className="page-width community-page">
      <PageHeader
        title="함께 풀면, 더 멀리."
        description="궁금한 코드는 질문하고, 발견한 풀이는 나누세요."
        aside={
          <button type="button" className="button" onClick={write}>
            글쓰기
          </button>
        }
      />

      <div className="community-layout">
        <section aria-label="커뮤니티 글 목록">
          <div className="community-toolbar">
            <div className="community-tabs" role="group" aria-label="카테고리">
              <button
                type="button"
                className={`community-tab ${category === null ? "selected" : ""}`}
                aria-pressed={category === null}
                onClick={() => update({ c: null })}
              >
                전체
              </button>
              {categories.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`community-tab ${category === item.key ? "selected" : ""}`}
                  aria-pressed={category === item.key}
                  onClick={() => update({ c: item.key })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="community-find">
              <input
                type="search"
                className="community-search"
                placeholder="글 검색"
                aria-label="커뮤니티 검색"
                maxLength={100}
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
              />
              <select
                aria-label="정렬"
                value={sort}
                onChange={(event) =>
                  update({
                    sort:
                      event.target.value === "latest"
                        ? null
                        : event.target.value,
                  })
                }
              >
                {sortOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {problemId && (
            <p className="notice-inline">
              문제에 연결된 글{" "}
              <button
                className="inline-button"
                onClick={() => update({ problemId: null })}
              >
                문제 필터 해제
              </button>
            </p>
          )}
          {loading ? (
            <p role="status">게시글을 불러오는 중…</p>
          ) : loadError ? (
            <div role="alert">
              {loadError}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>다시 시도</button>
            </div>
          ) : visible.length ? (
            <ul className="post-list">
              {visible.map((post) => {
                const count = isDemo
                  ? answerCount(post)
                  : (post.commentCount ?? 0);
                const accepted = isDemo
                  ? acceptedAnswerId(activity, post.id) !== null
                  : Boolean(post.acceptedCommentId);
                return (
                  <li key={post.id}>
                    <Link
                      className={`post-row ${post.pinned ? "pinned" : ""}`}
                      to={`/community/${post.id}`}
                    >
                      <span className="post-category">
                        {categoryLabel(post.category)}
                      </span>
                      <span className="post-main">
                        <strong className="post-title">{post.title}</strong>
                        <span className="post-meta">
                          {post.author.name} · {relativeTime(post.createdAt)}
                          {post.pinned
                            ? " · 고정"
                            : ` · 추천 ${isDemo ? upvoteCount(activity, post.id, post.upvotes) : post.upvotes}`}
                          {accepted ? (
                            <span className="post-accepted"> · 채택 완료</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="post-answers">
                        <small>답변</small>
                        <b>{count}</b>
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
                  <p>카테고리나 검색어를 바꿔 보세요.</p>
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => {
                      setQueryText("");
                      setParams(new URLSearchParams(), { replace: true });
                    }}
                  >
                    필터 초기화
                  </button>
                </>
              ) : (
                <>
                  <strong>아직 올라온 글이 없어요.</strong>
                  <p>첫 글을 남겨 보세요.</p>
                </>
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

        <aside className="side-stack">
          <div className="community-guide">
            <h2>
              좋은 질문은
              <br />
              함께 풀 실마리가 됩니다.
            </h2>
            <img src={guideArt} alt="" width="232" height="186" />
            <h3>질문을 올리기 전 확인해 보세요.</h3>
            <ul>
              <li>어떤 문제에서 막혔나요?</li>
              <li>시도한 코드와 입력은 무엇인가요?</li>
              <li>기대한 결과와 실제 결과가 다른가요?</li>
            </ul>
          </div>
          <div className="community-about">
            <h2>풀이를 나누는 공간</h2>
            <p>
              정답뿐 아니라 생각한 과정도 함께 남겨주세요.
              <br />
              다른 관점이 더 좋은 풀이로 이어집니다.
            </p>
            <div className="community-about-chips">
              <button type="button" onClick={() => update({ c: "question" })}>
                질문
              </button>
              <button type="button" onClick={() => update({ c: "solution" })}>
                풀이 공유
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
