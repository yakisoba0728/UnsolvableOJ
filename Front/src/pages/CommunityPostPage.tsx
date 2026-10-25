import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { ApiError, api } from "../api";
import { ActionMenu } from "../components/ActionMenu";
import { Pagination } from "../components/Pagination";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { useAuth } from "../auth";
import {
  errorMessage,
  getPostPage,
  postAction,
  postUrl,
} from "../community/api";
import {
  clearDraft,
  readAnswerDraft,
  relativeTime,
  writeAnswerDraft,
} from "../community/store";
import { categoryLabel } from "../community/types";
import { useDocumentTitle, useFlashNotice } from "../hooks";
import { problemPath } from "../paths";

const MIN_ANSWER = 5;
const ANSWER_PAGE_SIZE = 20;

export function CommunityPostPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const ownerId = session?.user.id ?? "";
  const token = session?.accessToken;
  const navigate = useNavigate();
  const location = useLocation();
  const [answerPage, setAnswerPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getPostPage>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // 추천·답변 뒤 다시 불러오는 동안에도 보던 글은 그대로 둔다(다른 글로 옮길 때만 비운다).
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getPostPage(id, answerPage, token, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLoadError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, answerPage, token, revision]);
  const post = data?.post.id === id ? data.post : undefined;
  // 조회 수는 글을 처음 받은 뒤 한 번만 올린다(화면에는 내 방문 전 값이 보이고, 다시 불러올 때는 세지 않는다).
  const viewed = useRef("");
  useEffect(() => {
    if (!post || viewed.current === id) return;
    viewed.current = id;
    void api(`${postUrl(id)}/view`, { method: "POST" }).catch(() => {});
  }, [id, post]);
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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useFlashNotice();
  const [answersOpen, setAnswersOpen] = useState(false);
  // 한 번에 답변 하나만 고친다.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [editError, setEditError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // 새 답변은 다시 불러온 뒤에야 화면에 생기므로, 그때 그 답변으로 스크롤한다.
  const scrollTarget = useRef("");
  useEffect(() => {
    const element = scrollTarget.current
      ? document.getElementById(scrollTarget.current)
      : null;
    if (!element) return;
    scrollTarget.current = "";
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [data]);

  // 다른 글로 옮기면 그 글의 작성 중 답변을 불러온다.
  useEffect(() => {
    setAnswerDraft({ ownerId, postId: id, text: readAnswerDraft(ownerId, id) });
    setError("");
    setActionError("");
    setAnswersOpen(false);
    setEditing(null);
  }, [id, ownerId]);
  useEffect(() => {
    setData(null);
    setAnswerPage(1);
  }, [id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!post) {
    // 잘못된 주소(400)와 없는 글(404)은 같은 안내를 보인다.
    const missing =
      loadError instanceof ApiError &&
      (loadError.status === 404 || loadError.status === 400);
    if (loading || (!loadError && !data))
      return (
        <div className="post-page">
          <SkeletonRegion label="글을 불러오는 중입니다">
            <Skeleton width={120} height={16} style={{ marginBottom: 16 }} />
            <Skeleton height={320} radius={14} />
          </SkeletonRegion>
        </div>
      );
    return (
      <div
        className="page-width empty-state"
        role={missing ? undefined : "alert"}
      >
        <strong>
          {missing ? "글을 찾을 수 없어요." : "글을 불러오지 못했어요."}
        </strong>
        {missing ? null : <p>{errorMessage(loadError)}</p>}
        {missing ? null : (
          <button
            type="button"
            className="button"
            onClick={() => setRevision((count) => count + 1)}
          >
            다시 시도
          </button>
        )}
        <Link to="/community">커뮤니티로</Link>
      </div>
    );
  }

  const listSearch =
    (location.state as { listSearch?: string } | null)?.listSearch ?? "";
  const { answers, stats: authorStats, interaction } = data!;
  const acceptedId = post.acceptedCommentId ?? null;
  // 서버가 채택된 답변을 첫 쪽 맨 앞에 두므로 접혀 있을 때는 그 답변만 보인다.
  const shown = answersOpen
    ? answers.items
    : answers.items.filter((answer) => answer.id === acceptedId);
  const isMine = Boolean(session && post.authorId === session.user.id);
  const isAdmin = session?.user.role === "ADMIN";
  const canDelete = isMine || isAdmin;
  const following = interaction.following;

  /** 로그인하지 않았으면 로그인 화면으로 보낸다. 성공하면 글을 다시 불러온다. */
  async function act(
    path: string,
    method: "PUT" | "DELETE",
    body?: object,
  ): Promise<boolean> {
    if (!session) {
      navigate("/auth", { state: { from: `/community/${id}` } });
      return false;
    }
    if (pending) return false;
    setPending(true);
    setActionError("");
    try {
      await postAction(id, path, method, session.accessToken, body);
      setRevision((count) => count + 1);
      return true;
    } catch {
      setNotice("");
      setActionError("변경 내용을 저장하지 못했어요. 다시 시도해 주세요.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function deletePost() {
    if (!canDelete || !session || pending) return;
    if (
      !window.confirm(
        "이 글을 삭제할까요? 달린 답변도 함께 삭제되고 되돌릴 수 없어요.",
      )
    )
      return;
    setPending(true);
    setActionError("");
    try {
      await postAction(id, "", "DELETE", session.accessToken);
    } catch {
      setPending(false);
      setNotice("");
      setActionError("글을 삭제하지 못했어요. 다시 시도해 주세요.");
      return;
    }
    const answerCleared = writeAnswerDraft(ownerId, id, "");
    const editCleared = clearDraft(ownerId, id);
    navigate(`/community${listSearch}`, {
      state: {
        notice: `글을 삭제했어요.${answerCleared && editCleared ? "" : " 임시 초안을 지우지 못했어요."}`,
      },
    });
  }

  async function saveAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const body = editing.text.trim();
    if (body.length < MIN_ANSWER) {
      setEditError(`답변을 ${MIN_ANSWER}자 이상 입력해 주세요.`);
      return;
    }
    setEditError("");
    if (await act(`/comments/${editing.id}`, "PUT", { body })) {
      setEditing(null);
      setNotice("답변을 수정했어요.");
    }
  }

  async function deleteAnswer(answerId: string) {
    if (!window.confirm("이 답변을 삭제할까요? 되돌릴 수 없어요.")) return;
    if (!(await act(`/comments/${answerId}`, "DELETE"))) return;
    if (editing?.id === answerId) setEditing(null);
    setNotice("답변을 삭제했어요.");
    // 쪽의 마지막 답변을 지우면 그 쪽이 비므로 앞 쪽으로 간다.
    if (answers.items.length === 1 && answerPage > 1)
      setAnswerPage(answerPage - 1);
  }

  function onDraftChange(value: string) {
    setAnswerDraft({ ownerId, postId: id, text: value });
    setError(
      writeAnswerDraft(ownerId, id, value)
        ? ""
        : "답변을 임시 저장하지 못했어요. 입력한 내용은 그대로 남아 있습니다.",
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || pending) return;
    const body = draft.trim();
    if (body.length < MIN_ANSWER) {
      setError(`답변을 ${MIN_ANSWER}자 이상 입력해 주세요.`);
      editorRef.current?.focus();
      return;
    }
    setError("");
    setPending(true);
    try {
      const answer = await postAction<{ id: string }>(
        id,
        "/comments",
        "POST",
        session.accessToken,
        { body },
      );
      const cleared = writeAnswerDraft(ownerId, id, "");
      setAnswerDraft({ ownerId, postId: id, text: "" });
      setNotice(
        `답변을 등록했어요.${cleared ? "" : " 임시 초안을 지우지 못했어요."}`,
      );
      setAnswersOpen(true);
      // 새 답변은 마지막 쪽에 붙는다.
      scrollTarget.current = answer.id;
      setAnswerPage(Math.ceil((answers.total + 1) / ANSWER_PAGE_SIZE));
      setRevision((count) => count + 1);
    } catch {
      setNotice("");
      setError(
        "답변을 저장하지 못했어요. 입력한 내용과 초안을 유지했으니 다시 시도해 주세요.",
      );
    } finally {
      setPending(false);
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
              {canDelete ? (
                <ActionMenu
                  label="글 관리"
                  items={[
                    // 관리자는 남의 글을 지울 수만 있고 고칠 수는 없다.
                    ...(isMine
                      ? [
                          {
                            label: "수정",
                            icon: <Pencil size={15} aria-hidden="true" />,
                            onSelect: () =>
                              navigate(`/community/${post.id}/edit`),
                          },
                        ]
                      : []),
                    {
                      label: "삭제",
                      icon: <Trash2 size={15} aria-hidden="true" />,
                      danger: true,
                      onSelect: () => void deletePost(),
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
                    disabled={pending}
                    onClick={() =>
                      void act("/follow", following ? "DELETE" : "PUT")
                    }
                  >
                    {following ? "✓ 팔로잉" : "+ 팔로우"}
                  </button>
                ) : null}
              </div>
            </div>
            <h1>{post.title}</h1>
            {post.problem ? (
              <p className="muted">
                연결 문제 ·{" "}
                <Link to={problemPath(post.problem.slug)}>
                  {post.problem.title}
                </Link>
              </p>
            ) : null}
            {post.category === "solution" ? (
              // 풀이는 아직 풀고 있는 사람을 위해 접어 둔다.
              <details className="post-spoiler">
                <summary>풀이 펼치기</summary>
                <PostContent {...post} />
              </details>
            ) : (
              <PostContent {...post} />
            )}
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
                className={`button post-vote ${interaction.voted ? "" : "button-soft"}`}
                aria-pressed={interaction.voted}
                disabled={pending}
                onClick={() =>
                  void act("/vote", interaction.voted ? "DELETE" : "PUT")
                }
              >
                <ThumbsUp size={15} aria-hidden="true" /> 추천 {post.upvotes}
              </button>
              <button
                type="button"
                className={`button ${interaction.saved ? "" : "button-soft"}`}
                aria-pressed={interaction.saved}
                disabled={pending}
                onClick={() =>
                  void act("/saved", interaction.saved ? "DELETE" : "PUT")
                }
              >
                <Bookmark
                  size={15}
                  aria-hidden="true"
                  fill={interaction.saved ? "currentColor" : "none"}
                />{" "}
                저장
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
                    maxLength={10_000}
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
          </section>

          <section className="post-card answers-card" aria-label="답변">
            <h2 className="post-section-title">
              <button
                type="button"
                className="answers-toggle"
                aria-expanded={answersOpen}
                aria-controls={shown.length ? "answer-list" : undefined}
                onClick={() => {
                  // 접으면 채택된 답변이 있는 첫 쪽으로 돌아간다.
                  if (answersOpen) setAnswerPage(1);
                  setAnswersOpen((open) => !open);
                }}
              >
                <span>답변 {answers.total}</span>
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
                  const voted = interaction.commentVotes.includes(answer.id);
                  const mineAnswer = Boolean(
                    session && answer.authorId === session.user.id,
                  );
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
                            aria-pressed={voted}
                            disabled={pending}
                            onClick={() =>
                              void act(
                                `/comments/${answer.id}/vote`,
                                voted ? "DELETE" : "PUT",
                              )
                            }
                          >
                            <ThumbsUp size={13} aria-hidden="true" />{" "}
                            {answer.upvotes}
                          </button>
                          {isMine && post.category === "question" ? (
                            <button
                              type="button"
                              className="inline-button"
                              disabled={pending}
                              onClick={() =>
                                void act(
                                  accepted
                                    ? "/accepted-answer"
                                    : `/accepted-answer/${answer.id}`,
                                  accepted ? "DELETE" : "PUT",
                                )
                              }
                            >
                              {accepted ? "채택 취소" : "채택하기"}
                            </button>
                          ) : null}
                          {mineAnswer || isAdmin ? (
                            <ActionMenu
                              label="답변 관리"
                              items={[
                                // 관리자는 남의 답변을 지울 수만 있고 고칠 수는 없다.
                                ...(mineAnswer
                                  ? [
                                      {
                                        label: "수정",
                                        icon: (
                                          <Pencil size={15} aria-hidden="true" />
                                        ),
                                        onSelect: () => {
                                          setEditError("");
                                          setEditing({
                                            id: answer.id,
                                            text: answer.body,
                                          });
                                        },
                                      },
                                    ]
                                  : []),
                                {
                                  label: "삭제",
                                  icon: <Trash2 size={15} aria-hidden="true" />,
                                  danger: true,
                                  onSelect: () => void deleteAnswer(answer.id),
                                },
                              ]}
                            />
                          ) : null}
                        </span>
                      </div>
                      {editing?.id === answer.id ? (
                        <form
                          className="answer-edit"
                          onSubmit={saveAnswer}
                          noValidate
                        >
                          <textarea
                            rows={6}
                            maxLength={10_000}
                            aria-label="답변 수정"
                            aria-invalid={Boolean(editError)}
                            autoFocus
                            value={editing.text}
                            onChange={(event) =>
                              setEditing({
                                id: answer.id,
                                text: event.target.value,
                              })
                            }
                          />
                          {editError ? (
                            <p className="error-message" role="alert">
                              {editError}
                            </p>
                          ) : null}
                          <div className="answer-footer">
                            <button
                              type="button"
                              className="button button-outline button-small"
                              onClick={() => setEditing(null)}
                            >
                              취소
                            </button>
                            <button
                              className="button button-small"
                              disabled={pending}
                            >
                              {pending ? "저장 중…" : "저장"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="markdown answer-body">
                          <Markdown>{answer.body}</Markdown>
                        </div>
                      )}
                      <small className="muted">
                        {relativeTime(answer.createdAt)}
                      </small>
                    </li>
                  );
                })}
              </ul>
            ) : answers.total ? null : (
              <p className="muted">
                아직 답변이 없어요. 첫 답변을 남겨 보세요.
              </p>
            )}
            {answersOpen && answers.totalPages > 1 ? (
              <Pagination
                page={answerPage}
                totalPages={answers.totalPages}
                onChange={setAnswerPage}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** 본문과, 있으면 공유한 코드 */
function PostContent({
  body,
  code,
  language,
}: {
  body: string;
  code?: string;
  language?: string;
}) {
  return (
    <>
      <div className="markdown post-body">
        <Markdown>{body}</Markdown>
      </div>
      {code ? (
        <div className="markdown post-body post-code">
          {language ? <small className="muted">{language}</small> : null}
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      ) : null}
    </>
  );
}
