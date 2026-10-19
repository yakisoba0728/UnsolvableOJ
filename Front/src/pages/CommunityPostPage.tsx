import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { ActionMenu } from "../components/ActionMenu";
import { useAuth } from "../auth";
import {
  acceptedAnswerId,
  allPosts,
  answersOf,
  communityActions,
  readAnswerDraft,
  relativeTime,
  statsOf,
  upvoteCount,
  useActivity,
  writeAnswerDraft,
} from "../community/store";
import { categoryLabel, type CommunityAuthor } from "../community/types";
import { useDocumentTitle } from "../hooks";

const MIN_ANSWER = 5;

export function CommunityPostPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activity = useActivity();
  const post = allPosts(activity).find((item) => item.id === id);
  useDocumentTitle(post ? post.title : "커뮤니티");

  const [draft, setDraft] = useState(() => readAnswerDraft(id));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? "",
  );
  const [answersOpen, setAnswersOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // 다른 글로 옮기면 그 글의 작성 중 답변을 불러온다.
  useEffect(() => {
    setDraft(readAnswerDraft(id));
    setError("");
    setAnswersOpen(false);
  }, [id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!post)
    return (
      <div className="page-width empty-state">
        <strong>글을 찾을 수 없어요.</strong>
        <Link to="/community">커뮤니티로</Link>
      </div>
    );

  const listSearch =
    (location.state as { listSearch?: string } | null)?.listSearch ?? "";
  const answers = answersOf(activity, post.id);
  const acceptedId = acceptedAnswerId(activity, post.id);
  const ordered = [...answers].sort((a, b) => {
    if (a.id === acceptedId) return -1;
    if (b.id === acceptedId) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const shown = answersOpen
    ? ordered
    : ordered.filter((answer) => answer.id === acceptedId);
  const me: CommunityAuthor | null = session
    ? { name: session.user.username, tier: "Bronze I" }
    : null;
  const isMine = Boolean(me && post.author.name === me.name);
  const authorStats = statsOf(activity, post.author.name);
  const following = activity.followed.includes(post.author.name);
  const related = allPosts(activity)
    .filter(
      (item) =>
        item.id !== post.id &&
        item.category !== "notice" &&
        (item.category === post.category ||
          item.tags.some((tag) => post.tags.includes(tag))),
    )
    .slice(0, 4);

  function requireLogin(action: () => void) {
    if (session) action();
    else navigate("/auth", { state: { from: `/community/${id}` } });
  }

  function deleteMyPost() {
    if (!isMine) return;
    if (
      !window.confirm(
        "이 글을 삭제할까요? 달린 답변도 함께 삭제되고 되돌릴 수 없어요.",
      )
    )
      return;
    writeAnswerDraft(id, "");
    // 먼저 목록으로 이동시킨 뒤 지워서, 지워진 글 화면이 잠깐 보이지 않게 한다.
    navigate(`/community${listSearch}`, {
      state: { notice: "글을 삭제했어요." },
    });
    communityActions.deletePost(post!.id);
  }

  function onDraftChange(value: string) {
    setDraft(value);
    setError("");
    writeAnswerDraft(id, value);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !me) return;
    const body = draft.trim();
    if (body.length < MIN_ANSWER) {
      setError(`답변을 ${MIN_ANSWER}자 이상 입력해 주세요.`);
      editorRef.current?.focus();
      return;
    }
    setPending(true);
    const answer = communityActions.addAnswer(post!.id, body, me);
    writeAnswerDraft(id, "");
    setDraft("");
    setPending(false);
    setNotice("답변을 등록했어요.");
    setAnswersOpen(true);
    window.setTimeout(() => {
      document
        .getElementById(answer.id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }

  return (
    <div className="post-page">
      <Link className="back-link" to={`/community${listSearch}`}>
        ← 커뮤니티
      </Link>
      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}
      <div className={`post-layout ${related.length ? "" : "no-side"}`}>
        <div className="post-column">
          <article className="post-card">
            <div className="post-card-head">
              <span className="post-chip">
                {categoryLabel(post.category)}
                {post.tags[0] ? ` · ${post.tags[0]}` : ""}
              </span>
              {isMine ? (
                <ActionMenu
                  label="글 관리"
                  items={[
                    {
                      label: "수정",
                      icon: <Pencil size={15} aria-hidden="true" />,
                      onSelect: () => navigate(`/community/${post.id}/edit`),
                    },
                    {
                      label: "삭제",
                      icon: <Trash2 size={15} aria-hidden="true" />,
                      danger: true,
                      onSelect: deleteMyPost,
                    },
                  ]}
                />
              ) : null}
            </div>
            <h1>{post.title}</h1>
            <div className="post-byline">
              <div className="post-author-line">
                <span className="post-avatar" aria-hidden="true">
                  {post.author.name.slice(0, 1)}
                </span>
                <span className="post-author-text">
                  <strong>{post.author.name}</strong>
                  <span className="muted">
                    {post.author.tier}
                    {authorStats.reputation
                      ? ` · 명성 ${authorStats.reputation.toLocaleString()}`
                      : ""}{" "}
                    · {relativeTime(post.createdAt)}
                  </span>
                  <small className="muted">
                    채택 답변 {authorStats.acceptedAnswers} · 작성 글{" "}
                    {authorStats.posts}
                  </small>
                </span>
              </div>
              <div className="post-byline-side">
                {acceptedId ? (
                  <span className="post-stats">채택 완료</span>
                ) : null}
                {!isMine ? (
                  <button
                    type="button"
                    className="button button-outline button-small"
                    aria-pressed={following}
                    onClick={() =>
                      requireLogin(() =>
                        communityActions.toggleFollow(post.author.name),
                      )
                    }
                  >
                    {following ? "✓ 팔로잉" : "+ 팔로우"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="markdown post-body">
              <Markdown>{post.body}</Markdown>
            </div>
            {post.tags.length ? (
              <ul className="post-tags" aria-label="태그">
                {post.tags.map((tag) => (
                  <li key={tag}>
                    <Link to={`/community?q=${encodeURIComponent(tag)}`}>
                      #{tag}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <p
              className="post-views icon-count"
              aria-label={`조회 ${post.views.toLocaleString()}`}
              title="조회수"
            >
              <Eye size={15} aria-hidden="true" />
              {post.views.toLocaleString()}
            </p>
            <div className="post-actions">
              <button
                type="button"
                className={`button post-vote ${activity.upvoted.includes(post.id) ? "" : "button-soft"}`}
                aria-pressed={activity.upvoted.includes(post.id)}
                onClick={() =>
                  requireLogin(() => communityActions.toggleUpvote(post.id))
                }
              >
                <ThumbsUp size={15} aria-hidden="true" /> 추천{" "}
                {upvoteCount(activity, post.id, post.upvotes)}
              </button>
            </div>
          </article>

          <section className="post-card answers-card" aria-label="답변">
            <h2 className="post-section-title">
              <button
                type="button"
                className="answers-toggle"
                aria-expanded={answersOpen}
                aria-controls="answer-list"
                onClick={() => setAnswersOpen((open) => !open)}
              >
                <span>답변 {answers.length}</span>
                <span className="answers-chevron" aria-hidden="true">
                  {answersOpen ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </span>
              </button>
            </h2>
            <form className="answer-editor" onSubmit={submit} noValidate>
              <h3 className="answer-editor-title">답변 작성</h3>
              <p className="muted">풀이 과정과 근거를 함께 설명해 주세요.</p>
              {session ? (
                <>
                  <textarea
                    ref={editorRef}
                    rows={6}
                    aria-label="답변 내용"
                    aria-invalid={Boolean(error)}
                    placeholder="답변을 입력하세요."
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                  />
                  {error ? (
                    <p className="error-message" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="answer-footer">
                    <span className="muted">
                      등록 전까지 작성 내용을 유지합니다.
                    </span>
                    <button className="button" disabled={pending}>
                      {pending ? "등록 중…" : "답변 등록"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="login-prompt">
                  답변을 남기려면 로그인해 주세요.{" "}
                  <Link to="/auth" state={{ from: `/community/${id}` }}>
                    로그인하기
                  </Link>
                </p>
              )}
            </form>
            {shown.length ? (
              <ul className="answer-list" id="answer-list">
                {shown.map((answer) => {
                  const accepted = answer.id === acceptedId;
                  return (
                    <li
                      key={answer.id}
                      id={answer.id}
                      className={`answer ${accepted ? "accepted" : ""}`}
                    >
                      <div className="answer-head">
                        <span>
                          {answer.author.name} · {answer.author.tier}
                          {accepted ? (
                            <span className="answer-accepted">채택된 답변</span>
                          ) : null}
                        </span>
                        <span className="answer-tools">
                          <button
                            type="button"
                            className="answer-vote"
                            aria-pressed={activity.upvoted.includes(answer.id)}
                            onClick={() =>
                              requireLogin(() =>
                                communityActions.toggleUpvote(answer.id),
                              )
                            }
                          >
                            <ThumbsUp size={13} aria-hidden="true" />{" "}
                            {upvoteCount(activity, answer.id, answer.upvotes)}
                          </button>
                          {isMine && post.category === "question" ? (
                            <button
                              type="button"
                              className="inline-button"
                              onClick={() =>
                                communityActions.setAccepted(
                                  post.id,
                                  accepted ? null : answer.id,
                                )
                              }
                            >
                              {accepted ? "채택 취소" : "채택하기"}
                            </button>
                          ) : null}
                        </span>
                      </div>
                      <div className="markdown answer-body">
                        <Markdown>{answer.body}</Markdown>
                      </div>
                      <small className="muted">
                        {relativeTime(answer.createdAt)}
                      </small>
                    </li>
                  );
                })}
              </ul>
            ) : answers.length ? null : (
              <p className="muted">
                아직 답변이 없어요. 첫 답변을 남겨 보세요.
              </p>
            )}
          </section>
        </div>

        {related.length ? (
          <aside className="post-side">
            {related.length ? (
              <section className="post-card related-card" aria-label="관련 글">
                <h2>관련 질문</h2>
                <ul>
                  {related.map((item) => (
                    <li key={item.id}>
                      <Link to={`/community/${item.id}`}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
