import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
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
import {
  categoryLabel,
  categoryLongLabel,
  type CommunityAuthor,
} from "../community/types";
import { useDocumentTitle } from "../hooks";

import { api, isDemo } from "../api";
import {
  endpoint,
  errorMessage,
  getPost,
  getComments,
  listPosts,
  emptyInteraction,
  type Interaction,
  type Page,
} from "../community/api";
import type { CommunityPost, CommunityAnswer } from "../community/types";
import { Pagination } from "../components/Pagination";
const MIN_ANSWER = 1;

export function CommunityPostPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activity = useActivity();
  const [remotePost, setRemotePost] = useState<CommunityPost | null>(null);
  const [remoteAnswers, setRemoteAnswers] = useState<Page<CommunityAnswer>>({
    items: [],
    total: 0,
    page: 1,
    totalPages: 0,
  });
  const [interaction, setInteraction] = useState<Interaction>(emptyInteraction);
  const [remoteStats, setRemoteStats] = useState({
    posts: 0,
    acceptedAnswers: 0,
    reputation: 0,
  });
  const [remoteRelated, setRemoteRelated] = useState<CommunityPost[]>([]);
  const [answerPage, setAnswerPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(!isDemo);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const token = session?.accessToken;
  const viewedId = useRef<string | null>(null);
  const draftScope =
    (isDemo ? "demo" : (session?.user.id ?? "anonymous")) + ":" + id;
  const post = isDemo
    ? allPosts(activity).find((item) => item.id === id)
    : remotePost;
  useEffect(() => {
    setInteraction(emptyInteraction);
  }, [id, token]);
  useEffect(() => {
    setAnswerPage(1);
    setRemotePost(null);
    setEditing(null);
  }, [id]);
  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      getPost(id, controller.signal),
      getComments(id, answerPage, controller.signal),
      token
        ? api<Interaction>(
            endpoint + "/" + id + "/interaction",
            { signal: controller.signal },
            token,
          )
        : Promise.resolve(emptyInteraction),
      api<typeof remoteStats>(endpoint + "/" + id + "/author-stats", {
        signal: controller.signal,
      }),
    ])
      .then(([p, a, i, stats]) => {
        if (controller.signal.aborted) return;
        setRemotePost(p);
        setRemoteAnswers(a);
        setInteraction(i);
        setRemoteStats(stats);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, token, answerPage, revision]);
  useEffect(() => {
    if (isDemo || viewedId.current === id) return;
    viewedId.current = id;
    // Count a view once per navigation, not for vote/comment refreshes.
    void api(endpoint + "/" + id + "/view", { method: "POST" }).catch(() => {});
  }, [id]);
  const relatedCategory = post?.category;
  useEffect(() => {
    if (isDemo || !relatedCategory) return;
    const controller = new AbortController();
    listPosts(
      new URLSearchParams({
        category: relatedCategory.toUpperCase(),
        limit: "5",
      }),
      controller.signal,
    )
      .then((r) =>
        setRemoteRelated(r.items.filter((p) => p.id !== id).slice(0, 4)),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [id, relatedCategory]);
  useDocumentTitle(post ? post.title : "커뮤니티");

  const [draft, setDraft] = useState(() => readAnswerDraft(draftScope));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? "",
  );
  const answersRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorFormRef = useRef<HTMLFormElement>(null);

  // 다른 글로 옮기면 그 글의 작성 중 답변을 불러온다.
  useEffect(() => {
    setDraft(readAnswerDraft(draftScope));
    setError("");
  }, [draftScope]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!isDemo && !post && loading)
    return (
      <div className="page-width" role="status">
        게시글을 불러오는 중…
      </div>
    );
  if (!post && error)
    return (
      <div className="page-width" role="alert">
        {error}{" "}
        <button onClick={() => setRevision((n) => n + 1)}>다시 시도</button>
      </div>
    );
  if (!post)
    return (
      <div className="page-width empty-state">
        <strong>글을 찾을 수 없어요.</strong>
        <Link to="/community">커뮤니티로</Link>
      </div>
    );

  const answers = isDemo ? answersOf(activity, post.id) : remoteAnswers.items;
  const acceptedId = isDemo
    ? acceptedAnswerId(activity, post.id)
    : post.acceptedCommentId;
  const ordered = [...answers].sort((a, b) => {
    if (a.id === acceptedId) return -1;
    if (b.id === acceptedId) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const me: CommunityAuthor | null = session
    ? { name: session.user.username, tier: "Bronze I" }
    : null;
  const isMine = Boolean(
    session &&
    (isDemo
      ? post.author.name === session.user.username
      : post.authorId === session.user.id),
  );
  const authorStats = isDemo
    ? statsOf(activity, post.author.name)
    : remoteStats;
  const following = isDemo
    ? activity.followed.includes(post.author.name)
    : interaction.following;
  const related = isDemo
    ? allPosts(activity)
        .filter(
          (item) =>
            item.id !== post.id &&
            item.category !== "notice" &&
            (item.category === post.category ||
              item.tags.some((tag) => post.tags.includes(tag))),
        )
        .slice(0, 4)
    : remoteRelated;

  async function mutate(path: string, method: string, body?: object) {
    if (!token || pending || loading) return false;
    setPending(true);
    setError("");
    try {
      await api(
        endpoint + "/" + id + path,
        { method, ...(body ? { body: JSON.stringify(body) } : {}) },
        token,
      );
      setRevision((n) => n + 1);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  function requireLogin(action: () => void) {
    if (session) action();
    else navigate("/auth", { state: { from: `/community/${id}` } });
  }

  function focusEditor() {
    editorFormRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    editorRef.current?.focus({ preventScroll: true });
  }

  function onDraftChange(value: string) {
    setDraft(value);
    setError("");
    writeAnswerDraft(draftScope, value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !me) return;
    const body = draft.trim();
    if (body.length < MIN_ANSWER) {
      setError(`답변을 ${MIN_ANSWER}자 이상 입력해 주세요.`);
      editorRef.current?.focus();
      return;
    }
    setPending(true);
    let answer: { id: string };
    try {
      answer = isDemo
        ? communityActions.addAnswer(post!.id, body, me)
        : await api<{ id: string }>(
            endpoint + "/" + id + "/comments",
            { method: "POST", body: JSON.stringify({ body }) },
            token,
          );
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
      return;
    }
    setAnswerPage(Math.max(1, Math.ceil((remoteAnswers.total + 1) / 20)));
    setRevision((n) => n + 1);
    writeAnswerDraft(draftScope, "");
    setDraft("");
    setPending(false);
    setNotice("답변을 등록했어요.");
    window.setTimeout(() => {
      document
        .getElementById(answer.id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }

  return (
    <div className="post-page">
      <Link className="back-link" to={`/community?c=${post.category}`}>
        ← 커뮤니티 · {categoryLongLabel(post.category)}
      </Link>
      {notice ? (
        <p className="success-message" role="status">
          {notice}
        </p>
      ) : null}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="post-layout" aria-busy={pending}>
        <div className="post-column">
          <article className="post-card">
            <span className="post-chip">
              {categoryLabel(post.category)}
              {post.tags[0] ? ` · ${post.tags[0]}` : ""}
            </span>
            <h1>{post.title}</h1>
            <div className="post-byline">
              <div className="post-author-line">
                <span className="post-avatar" aria-hidden="true">
                  {post.author.name.slice(0, 1)}
                </span>
                <span>
                  {post.author.name} · {post.author.tier} ·{" "}
                  {relativeTime(post.createdAt)}
                </span>
              </div>
              <span className="post-stats">
                조회 {post.views.toLocaleString()}
                {acceptedId ? " · 채택 완료" : ""}
              </span>
            </div>
            {post.problem && (
              <Link className="back-link" to={"/problems/" + post.problem.slug}>
                연결 문제 · {post.problem.title}
              </Link>
            )}
            {post.category === "solution" ? (
              <details className="post-body">
                <summary>풀이 스포일러 펼치기</summary>
                <div className="markdown">
                  <Markdown skipHtml>{post.body}</Markdown>
                </div>
                {post.code && (
                  <pre>
                    <code>{post.code}</code>
                  </pre>
                )}
              </details>
            ) : (
              <>
                <div className="markdown post-body">
                  <Markdown skipHtml>{post.body}</Markdown>
                </div>
                {post.code && (
                  <div className="markdown">
                    <small>{post.language}</small>
                    <pre>
                      <code>{post.code}</code>
                    </pre>
                  </div>
                )}
              </>
            )}
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
            <div className="post-actions">
              {!isDemo && isMine && (
                <Link
                  className="button button-outline"
                  to={"/community/" + id + "/edit"}
                >
                  글 수정
                </Link>
              )}
              {!isDemo && (isMine || session?.user.role === "ADMIN") && (
                <button
                  className="button button-outline"
                  disabled={pending}
                  onClick={async () => {
                    if (!window.confirm("게시글과 답변을 삭제할까요?")) return;
                    setPending(true);
                    try {
                      await api(
                        endpoint + "/" + id,
                        { method: "DELETE" },
                        token,
                      );
                      navigate("/community");
                    } catch (e) {
                      setError(errorMessage(e));
                      setPending(false);
                    }
                  }}
                >
                  글 삭제
                </button>
              )}
              <button
                type="button"
                disabled={pending || loading}
                className={`button post-vote ${(isDemo ? activity.upvoted.includes(post.id) : interaction.voted) ? "" : "button-soft"}`}
                aria-pressed={
                  isDemo
                    ? activity.upvoted.includes(post.id)
                    : interaction.voted
                }
                onClick={() =>
                  requireLogin(() => {
                    if (isDemo) communityActions.toggleUpvote(post.id);
                    else
                      void mutate(
                        "/vote",
                        interaction.voted ? "DELETE" : "PUT",
                      );
                  })
                }
              >
                ▲ 추천{" "}
                {isDemo
                  ? upvoteCount(activity, post.id, post.upvotes)
                  : post.upvotes}
              </button>
              <button
                type="button"
                className="button button-outline"
                onClick={() =>
                  answersRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                답변 보기 ({isDemo ? answers.length : remoteAnswers.total})
              </button>
              <button
                type="button"
                className="button button-outline"
                onClick={() =>
                  requireLogin(() => {
                    if (isDemo) communityActions.toggleSaved(post.id);
                    else
                      void mutate(
                        "/saved",
                        interaction.saved ? "DELETE" : "PUT",
                      );
                  })
                }
              >
                {(isDemo ? activity.saved.includes(post.id) : interaction.saved)
                  ? "저장됨"
                  : "저장"}
              </button>
              {post.category !== "notice" ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => requireLogin(focusEditor)}
                >
                  답변 작성
                </button>
              ) : null}
            </div>
          </article>

          <section className="post-card" ref={answersRef} aria-label="답변">
            <h2 className="post-section-title">
              답변 {isDemo ? answers.length : remoteAnswers.total}
            </h2>
            {ordered.length ? (
              <ul className="answer-list">
                {ordered.map((answer) => {
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
                            aria-pressed={
                              isDemo
                                ? activity.upvoted.includes(answer.id)
                                : interaction.commentVotes.includes(answer.id)
                            }
                            onClick={() =>
                              requireLogin(() =>
                                isDemo
                                  ? communityActions.toggleUpvote(answer.id)
                                  : void mutate(
                                      "/comments/" + answer.id + "/vote",
                                      interaction.commentVotes.includes(
                                        answer.id,
                                      )
                                        ? "DELETE"
                                        : "PUT",
                                    ),
                              )
                            }
                          >
                            ▲{" "}
                            {isDemo
                              ? upvoteCount(activity, answer.id, answer.upvotes)
                              : answer.upvotes}
                          </button>
                          {isMine && post.category === "question" ? (
                            <button
                              type="button"
                              className="inline-button"
                              onClick={() =>
                                isDemo
                                  ? communityActions.setAccepted(
                                      post.id,
                                      accepted ? null : answer.id,
                                    )
                                  : void mutate(
                                      "/accepted-answer" +
                                        (accepted ? "" : "/" + answer.id),
                                      accepted ? "DELETE" : "PUT",
                                    )
                              }
                            >
                              {accepted ? "채택 취소" : "채택하기"}
                            </button>
                          ) : null}
                        </span>
                      </div>
                      <div className="markdown answer-body">
                        <Markdown skipHtml>{answer.body}</Markdown>
                      </div>
                      <small className="muted">
                        {relativeTime(answer.createdAt)}
                      </small>
                      {!isDemo && session?.user.id === answer.authorId && (
                        <button
                          className="inline-button"
                          onClick={() => {
                            setEditing(answer.id);
                            setEditBody(answer.body);
                          }}
                        >
                          답변 수정
                        </button>
                      )}
                      {!isDemo &&
                        (session?.user.id === answer.authorId ||
                          session?.user.role === "ADMIN") && (
                          <button
                            className="inline-button"
                            disabled={pending}
                            onClick={() => {
                              if (window.confirm("답변을 삭제할까요?"))
                                void mutate("/comments/" + answer.id, "DELETE");
                            }}
                          >
                            답변 삭제
                          </button>
                        )}
                      {editing === answer.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void mutate("/comments/" + answer.id, "PUT", {
                              body: editBody,
                            }).then((ok) => {
                              if (ok) setEditing(null);
                            });
                          }}
                        >
                          <textarea
                            aria-label="답변 수정 내용"
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            required
                            maxLength={10000}
                          />
                          <button className="button" disabled={pending}>
                            수정 저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            취소
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">
                아직 답변이 없어요. 첫 답변을 남겨 보세요.
              </p>
            )}
            {!isDemo && (
              <Pagination
                page={answerPage}
                totalPages={Math.max(1, remoteAnswers.totalPages)}
                onChange={setAnswerPage}
              />
            )}
          </section>

          {post.category !== "notice" || answers.length ? (
            <form
              className="post-card answer-editor"
              onSubmit={submit}
              noValidate
              ref={editorFormRef}
            >
              <h2 className="post-section-title">답변 작성</h2>
              <p className="muted">풀이 과정과 근거를 함께 설명해 주세요.</p>
              {session ? (
                <>
                  <textarea
                    ref={editorRef}
                    maxLength={10000}
                    rows={6}
                    aria-label="답변 내용"
                    aria-invalid={Boolean(error)}
                    placeholder="답변을 입력하세요."
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                  />

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
          ) : null}
        </div>

        <aside className="post-side">
          <section className="post-card author-card" aria-label="작성자">
            <span className="post-avatar large" aria-hidden="true">
              {post.author.name.slice(0, 1)}
            </span>
            <strong>{post.author.name}</strong>
            <span className="muted">
              {post.author.tier}
              {authorStats.reputation
                ? ` · 명성 ${authorStats.reputation.toLocaleString()}`
                : ""}
            </span>
            {!isMine ? (
              <button
                type="button"
                className="button button-outline button-full"
                onClick={() =>
                  requireLogin(() => {
                    if (isDemo) communityActions.toggleFollow(post.author.name);
                    else void mutate("/follow", following ? "DELETE" : "PUT");
                  })
                }
              >
                {following ? "✓ 팔로잉" : "+ 팔로우"}
              </button>
            ) : null}
            <small className="muted">
              채택 답변 {authorStats.acceptedAnswers} · 작성 글{" "}
              {authorStats.posts}
            </small>
          </section>
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
      </div>
    </div>
  );
}
