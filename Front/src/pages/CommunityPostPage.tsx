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
  clearDraft,
  communityActions,
  readAnswerDraft,
  relativeTime,
  statsOf,
  isFollowing,
  upvoteCount,
  upvotedIds,
  useActivity,
  writeAnswerDraft,
} from "../community/store";
import { categoryLabel, type CommunityAuthor } from "../community/types";
import { useDocumentTitle, useFlashNotice } from "../hooks";

const MIN_ANSWER = 5;

export function CommunityPostPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const ownerId = session?.user.id ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const activity = useActivity();
  const post = allPosts(activity).find((item) => item.id === id);
  useDocumentTitle(post ? post.title : "커뮤니티");

  const [answerDraft, setAnswerDraft] = useState(() => ({
    ownerId,
    postId: id,
    text: readAnswerDraft(ownerId, id),
  }));
  const draft =
    answerDraft.ownerId === ownerId && answerDraft.postId === id
      ? answerDraft.text
      : "";
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useFlashNotice();
  const [answersOpen, setAnswersOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // 다른 글로 옮기면 그 글의 작성 중 답변을 불러온다.
  useEffect(() => {
    setAnswerDraft({ ownerId, postId: id, text: readAnswerDraft(ownerId, id) });
    setError("");
    setActionError("");
    setAnswersOpen(false);
  }, [id, ownerId]);

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
  const following = isFollowing(activity, session?.user.id, post.author.name);
  const upvoted = upvotedIds(activity, session?.user.id);

  function requireLogin(action: (userId: string) => void) {
    if (!session) {
      navigate("/auth", { state: { from: `/community/${id}` } });
      return;
    }
    setActionError("");
    try {
      action(session.user.id);
    } catch {
      setNotice("");
      setActionError("변경 내용을 저장하지 못했어요. 다시 시도해 주세요.");
    }
  }

  function deleteMyPost() {
    if (!isMine) return;
    if (
      !window.confirm(
        "이 글을 삭제할까요? 달린 답변도 함께 삭제되고 되돌릴 수 없어요.",
      )
    )
      return;
    requireLogin(() => {
      communityActions.deletePost(post!.id);
      const answerCleared = writeAnswerDraft(ownerId, id, "");
      const editCleared = clearDraft(ownerId, id);
      navigate(`/community${listSearch}`, {
        state: {
          notice: `글을 삭제했어요.${answerCleared && editCleared ? "" : " 임시 초안을 지우지 못했어요."}`,
        },
      });
    });
  }

  function onDraftChange(value: string) {
    setAnswerDraft({ ownerId, postId: id, text: value });
    setError(
      writeAnswerDraft(ownerId, id, value)
        ? ""
        : "답변을 임시 저장하지 못했어요. 입력한 내용은 그대로 남아 있습니다.",
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me) return;
    const body = draft.trim();
    if (body.length < MIN_ANSWER) {
      setError(`답변을 ${MIN_ANSWER}자 이상 입력해 주세요.`);
      editorRef.current?.focus();
      return;
    }
    setError("");
    try {
      const answer = communityActions.addAnswer(post!.id, body, me);
      const cleared = writeAnswerDraft(ownerId, id, "");
      setAnswerDraft({ ownerId, postId: id, text: "" });
      setNotice(
        `답변을 등록했어요.${cleared ? "" : " 임시 초안을 지우지 못했어요."}`,
      );
      setAnswersOpen(true);
      window.setTimeout(() => {
        document
          .getElementById(answer.id)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 50);
    } catch {
      setNotice("");
      setError(
        "답변을 저장하지 못했어요. 입력한 내용과 초안을 유지했으니 다시 시도해 주세요.",
      );
    }
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
      {actionError ? (
        <p className="error-message" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="post-layout no-side">
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
            <div className="post-byline">
              <div className="post-author-line">
                <span className="post-avatar" aria-hidden="true">
                  {post.author.name.slice(0, 1)}
                </span>
                <span className="post-author-text">
                  <strong>{post.author.name}</strong>
                  <span className="muted">
                    {post.author.tier} · {relativeTime(post.createdAt)}
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
                      requireLogin((userId) =>
                        communityActions.toggleFollow(userId, post.author.name),
                      )
                    }
                  >
                    {following ? "✓ 팔로잉" : "+ 팔로우"}
                  </button>
                ) : null}
              </div>
            </div>
            <h1>{post.title}</h1>
            <div className="markdown post-body">
              <Markdown>{post.body}</Markdown>
            </div>
            {post.tags.length ? (
              <ul className="post-tags" aria-label="태그">
                {post.tags.map((tag) => (
                  <li key={tag}>
                    <Link to={`/community?${new URLSearchParams({ tag })}`}>
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
                className={`button post-vote ${upvoted.includes(post.id) ? "" : "button-soft"}`}
                aria-pressed={upvoted.includes(post.id)}
                onClick={() =>
                  requireLogin((userId) => communityActions.toggleUpvote(userId, post.id))
                }
              >
                <ThumbsUp size={15} aria-hidden="true" /> 추천{" "}
                {upvoteCount(activity, post.id, post.upvotes)}
              </button>
            </div>
          </article>

          <section className="post-card answer-write-card" aria-label="답변 작성">
            <form className="answer-editor" onSubmit={submit} noValidate>
              <h2 className="answer-editor-title">답변 작성</h2>
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
                    <button className="button">답변 등록</button>
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
          </section>

          <section className="post-card answers-card" aria-label="답변">
            <h2 className="post-section-title">
              <button
                type="button"
                className="answers-toggle"
                aria-expanded={answersOpen}
                aria-controls={shown.length ? "answer-list" : undefined}
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
                            aria-pressed={upvoted.includes(answer.id)}
                            onClick={() =>
                              requireLogin((userId) =>
                                communityActions.toggleUpvote(userId, answer.id),
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
                                requireLogin(() =>
                                  communityActions.setAccepted(
                                    post.id,
                                    accepted ? null : answer.id,
                                  ),
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
      </div>
    </div>
  );
}
