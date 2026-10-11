import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { answersOf, relativeTime, upvoteCount } from "../community/store";
import { categoryLabel, type CommunityPost } from "../community/types";

/** 한 글이 차지하는 세로 길이(글 높이 + 간격). */
const slideStep = (slide: HTMLElement) =>
  slide.offsetHeight + parseFloat(getComputedStyle(slide).marginBottom);

type ActivityState = Parameters<typeof answersOf>[0];

interface PostScrollerProps {
  title: string;
  posts: CommunityPost[];
  activity: ActivityState;
  emptyText: string;
}

/**
 * 글을 두 편씩 세로로 넘겨 보는 카드. 스크롤이 멈추면 항상 글 경계에 맞춰 정렬되고,
 * 위/아래 버튼으로도 한 편씩 이동한다.
 */
export function PostScroller({
  title,
  posts,
  activity,
  emptyText,
}: PostScrollerProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const VISIBLE = 2;
  const maxIndex = Math.max(0, posts.length - VISIBLE);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onScroll = () => {
      const slide = view.querySelector<HTMLElement>(".scroller-slide");
      if (!slide) return;
      const next = Math.round(view.scrollTop / slideStep(slide));
      setIndex(Math.min(maxIndex, Math.max(0, next)));
    };
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => view.removeEventListener("scroll", onScroll);
  }, [posts.length, maxIndex]);

  function go(step: number) {
    const view = viewRef.current;
    if (!view) return;
    const slide = view.querySelector<HTMLElement>(".scroller-slide");
    if (!slide) return;
    const target = Math.min(maxIndex, Math.max(0, index + step));
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    view.scrollTo({
      top: target * slideStep(slide),
      behavior: reduced ? "auto" : "smooth",
    });
  }

  return (
    <section className="panel post-scroller" aria-label={title}>
      <div className="section-heading compact">
        <div>
          <h2>{title}</h2>
        </div>
        {posts.length ? (
          <div className="scroller-controls">
            <span className="scroller-count" aria-live="polite">
              {posts.length > VISIBLE
                ? `${index + 1}–${index + VISIBLE} / ${posts.length}`
                : `${posts.length} / ${posts.length}`}
            </span>
            <button
              type="button"
              className="scroller-button"
              aria-label="이전 글"
              disabled={index <= 0}
              onClick={() => go(-1)}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="m6 15 6-6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="scroller-button"
              aria-label="다음 글"
              disabled={index >= maxIndex}
              onClick={() => go(1)}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="m6 9 6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      {posts.length ? (
        <div
          className="scroller-view"
          ref={viewRef}
          tabIndex={0}
          aria-label={`${title} 목록`}
        >
          {posts.map((post) => (
            <article className="scroller-slide" key={post.id}>
              <div className="scroller-head">
                <span className="post-chip">
                  {categoryLabel(post.category)}
                </span>
                <span className="muted">
                  {post.author.name} · {relativeTime(post.createdAt)}
                </span>
              </div>
              <Link className="scroller-title" to={`/community/${post.id}`}>
                {post.title}
              </Link>
              <div className="scroller-stats muted">
                <span>추천 {upvoteCount(activity, post.id, post.upvotes)}</span>
                <span>조회 {post.views.toLocaleString()}</span>
                <span>답변 {answersOf(activity, post.id).length}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted scroller-empty">{emptyText}</p>
      )}
    </section>
  );
}
