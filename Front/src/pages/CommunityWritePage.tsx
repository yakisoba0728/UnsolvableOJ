import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Markdown from "react-markdown";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import {
  allPosts,
  clearDraft,
  communityActions,
  readDraft,
  useActivity,
  writeDraft,
} from "../community/store";
import {
  categories,
  categoryLongLabel,
  type CategoryKey,
} from "../community/types";
import { savedTime, useDocumentTitle } from "../hooks";
import { useUnsavedChanges } from "../useUnsavedChanges";

const MAX_TAGS = 5;
const TITLE_MAX = 100;
const TAG_MAX = 20;

type Field = "title" | "body" | "tag";

/** 입력 규칙. 문제가 없으면 빈 문자열. 태그는 Enter로 확정하며 쉼표와 공백도 태그의 일부다. */
function fieldProblem(field: Field, value: string) {
  if (field === "title") {
    if (!value.trim()) return "제목을 입력해 주세요.";
    if (value.length > TITLE_MAX)
      return `제목은 ${TITLE_MAX}자 이하로 입력해 주세요.`;
  } else if (field === "body") {
    if (!value.trim()) return "본문을 입력해 주세요.";
  } else if (tagValue(value).length > TAG_MAX) {
    return `태그는 ${TAG_MAX}자 이하로 입력해 주세요.`;
  }
  return "";
}

/** 입력 칸의 글에서 앞의 '#'과 앞뒤 공백을 뗀 태그. */
function tagValue(value: string) {
  return value.trim().replace(/^#+/, "").trim();
}

export function CommunityWritePage() {
  const { id: editingId } = useParams();
  const editing = Boolean(editingId);
  useDocumentTitle(editing ? "글 수정" : "글 작성");
  const { session } = useAuth();
  const ownerId = session?.user.id ?? "";
  const activity = useActivity();
  // 수정 모드: 내가 쓴 글만 열 수 있다.
  const original = editingId
    ? allPosts(activity).find((post) => post.id === editingId)
    : undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const requestedCategory = (
    location.state as { category?: CategoryKey } | null
  )?.category;
  const isAdmin = session?.user.role === "ADMIN";
  const options = categories.filter(
    (item) =>
      item.key !== "notice" || isAdmin || item.key === original?.category,
  );

  // 새 글과 각 글의 수정 초안은 계정별로 따로 복원한다.
  const [restored] = useState(() =>
    !editing || original?.author.name === session?.user.username
      ? readDraft(ownerId, editingId)
      : null,
  );
  // 배너에서 "풀이 공유하기"로 들어오면 그 카테고리로 시작한다.
  const [category, setCategory] = useState<CategoryKey>(
    restored && options.some((item) => item.key === restored.category)
      ? restored.category
      : original && options.some((item) => item.key === original.category)
        ? original.category
        : requestedCategory &&
          options.some((item) => item.key === requestedCategory)
          ? requestedCategory
          : "question",
  );
  const [title, setTitle] = useState(restored?.title ?? original?.title ?? "");
  const [tags, setTags] = useState<string[]>(
    restored?.tags ?? original?.tags ?? [],
  );
  const [tagText, setTagText] = useState(restored?.tagText ?? "");
  const [body, setBody] = useState(restored?.body ?? original?.body ?? "");
  const [submitError, setSubmitError] = useState("");
  // 입력을 시작한 칸은 바로, 건드리고 떠난 칸은 비어 있어도 안내한다(회원가입과 같은 방식).
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    title: false,
    body: false,
    tag: false,
  });
  const [bodyMode, setBodyMode] = useState<"write" | "preview">("write");
  // 본문 오류로 입력 칸에 포커스를 주어야 하는데 미리보기 탭이 열려 있는 경우, 칸이 다시 나타난 뒤에 포커스한다.
  const [focusBody, setFocusBody] = useState(false);
  // 직전 렌더에서 내용이 있었는지(내용이 있다가 비워진 순간만 초안을 지우려고 기억한다).
  const wasDirtyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">(
    restored ? "saved" : "idle",
  );
  const [savedAt, setSavedAt] = useState<number | null>(
    restored?.savedAt ?? null,
  );
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const bypass = useRef(false);

  const dirty = original
    ? title !== original.title ||
      body !== original.body ||
      category !== original.category ||
      JSON.stringify(tags) !== JSON.stringify(original.tags) ||
      Boolean(tagText.trim())
    : Boolean(title.trim() || body.trim() || tags.length || tagText.trim());
  useUnsavedChanges(dirty && Boolean(session), bypass);
  const latest = useRef({ category, title, tags, tagText, body, dirty });
  latest.current = { category, title, tags, tagText, body, dirty };

  function saveDraft() {
    if (bypass.current) return false;
    const now = Date.now();
    const ok = writeDraft(
      ownerId,
      { category, title, tags, tagText, body, savedAt: now },
      editingId,
    );
    setSaveState(ok ? "saved" : "failed");
    if (ok) setSavedAt(now);
    return ok;
  }

  useEffect(() => {
    if (!focusBody || bodyMode !== "write") return;
    bodyRef.current?.focus();
    setFocusBody(false);
  }, [focusBody, bodyMode]);

  // 입력하면 잠시 뒤 자동으로 임시 저장한다.
  useEffect(() => {
    if (!ownerId || bypass.current) return;
    const emptied = wasDirtyRef.current && !dirty;
    wasDirtyRef.current = dirty;
    if (!dirty) {
      // 내용이 있다가 전부 지워졌을 때만 지운다. 처음부터 비어 있던 화면(빈 초안을 직접 저장한 경우 포함)은 건드리지 않는다.
      if (emptied) {
        const cleared = clearDraft(ownerId, editingId);
        setSaveState(cleared ? "idle" : "failed");
        if (cleared) setSavedAt(null);
      }
      return;
    }
    const timer = window.setTimeout(saveDraft, 1200);
    return () => window.clearTimeout(timer);
  }, [category, title, tags, tagText, body, dirty, ownerId, editingId]);

  // 자동 저장을 기다리지 않고 이탈·세션 만료 직전의 입력까지 보관한다.
  useEffect(() => {
    const persistLatest = () => {
      if (bypass.current || !ownerId || !latest.current.dirty) return;
      const { dirty: _dirty, ...draft } = latest.current;
      writeDraft(ownerId, { ...draft, savedAt: Date.now() }, editingId);
    };
    window.addEventListener("beforeunload", persistLatest);
    return () => {
      window.removeEventListener("beforeunload", persistLatest);
      persistLatest();
    };
  }, [ownerId, editingId]);

  // 비로그인 접근은 App의 라우트에서 로그인 화면(또는 로그아웃 직후 홈)으로 보낸다.
  if (!session) return null;
  if (editing && (!original || original.author.name !== session.user.username))
    return (
      <Navigate
        to={editingId ? `/community/${editingId}` : "/community"}
        replace
      />
    );

  const values: Record<Field, string> = { title, body, tag: tagText };
  const problems: Record<Field, string> = {
    title: fieldProblem("title", title),
    body: fieldProblem("body", body),
    tag: tagText ? fieldProblem("tag", tagText) : "",
  };
  const shown = (field: Field) =>
    touched[field] || values[field] !== "" ? problems[field] : "";
  const touch = (field: Field) =>
    setTouched((previous) => ({ ...previous, [field]: true }));

  function addTag(raw: string) {
    // 규칙에 어긋나면 입력은 그대로 두고(안내가 보인다) 등록하지 않는다.
    if (fieldProblem("tag", raw)) return;
    const value = tagValue(raw);
    if (value)
      setTags((previous) =>
        previous.some((tag) => tag.toLowerCase() === value.toLowerCase()) ||
        previous.length >= MAX_TAGS
          ? previous
          : [...previous, value],
      );
    // '#'만 입력했거나 이미 있는 태그라면 등록할 것이 없으니 입력 칸만 비운다.
    setTagText("");
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한국어 입력 조합 중의 Enter는 글자 확정이므로 태그로 등록하지 않는다.
    // (Safari는 조합이 끝난 뒤 Enter keydown을 isComposing=false, keyCode=229로 보낸다. 일반 입력까지 막지 않도록 Enter일 때만 본다.)
    if (
      event.nativeEvent.isComposing ||
      (event.key === "Enter" && event.keyCode === 229)
    )
      return;
    if (event.key === "Enter") {
      event.preventDefault();
      addTag(tagText);
    } else if (event.key === "Backspace" && !tagText && tags.length) {
      setTags((previous) => previous.slice(0, -1));
    }
  }

  function cancel() {
    if (bypass.current) return;
    if (
      dirty &&
      !window.confirm(
        editing
          ? "수정한 내용이 저장되지 않아요. 나갈까요?"
          : "작성 중인 초안을 버리고 나갈까요?",
      )
    ) {
      return;
    }
    if (!clearDraft(ownerId, editingId)) {
      setSubmitError(
        "초안을 지우지 못했어요. 내용을 유지했으니 다시 시도해 주세요.",
      );
      return;
    }
    bypass.current = true;
    navigate(editingId ? `/community/${editingId}` : "/community");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bypass.current || pending || !session) return;
    setTouched({ title: true, body: true, tag: true });
    if (problems.title) return titleRef.current?.focus();
    if (problems.body) {
      setBodyMode("write");
      return setFocusBody(true);
    }
    if (problems.tag) return document.getElementById("tag-input")?.focus();

    saveDraft();
    setPending(true);
    setSubmitError("");
    try {
      const input = { category, title: title.trim(), body: body.trim(), tags };
      let postId = editingId;
      if (postId) communityActions.updatePost(postId, input);
      else {
        postId = communityActions.addPost({
          ...input,
          author: { name: session.user.username, tier: "Bronze I" },
        }).id;
      }
      const cleared = clearDraft(ownerId, editingId);
      bypass.current = true;
      navigate(`/community/${postId}`, {
        state: {
          notice: `${editing ? "글을 수정했어요." : "글을 등록했어요."}${cleared ? "" : " 임시 초안을 지우지 못했어요."}`,
        },
      });
    } catch {
      setSubmitError(
        "글을 저장하지 못했어요. 입력한 내용과 초안을 유지했으니 다시 시도해 주세요.",
      );
    } finally {
      if (!bypass.current) setPending(false);
    }
  }

  return (
    <div className="write-page">
      <PageHeader
        back={{
          to: editingId ? `/community/${editingId}` : "/community",
          label: editing ? "글로 돌아가기" : "커뮤니티",
        }}
        title={editing ? "글 수정" : "글 작성"}
        description={
          editing
            ? "내용을 고친 뒤 저장해 주세요."
            : "질문과 풀이를 남기면 다른 사람이 함께 답할 수 있어요."
        }
      />
      {showRestored ? (
        <p className="notice-inline" role="status">
          작성 중이던 초안을 불러왔어요.{" "}
          <button
            type="button"
            className="inline-button"
            onClick={() => {
              if (!clearDraft(ownerId, editingId)) {
                setSubmitError(
                  "초안을 지우지 못했어요. 입력한 내용은 그대로 남아 있습니다.",
                );
                return;
              }
              setCategory(original?.category ?? "question");
              setTitle(original?.title ?? "");
              setBody(original?.body ?? "");
              setTags(original?.tags ?? []);
              setTagText("");
              setShowRestored(false);
              setSaveState("idle");
              setSavedAt(null);
              setSubmitError("");
            }}
          >
            초안 지우기
          </button>
        </p>
      ) : null}
      {submitError ? (
        <p className="error-message" role="alert">
          {submitError}
        </p>
      ) : null}
      <form className="form-card write-form" onSubmit={submit} noValidate>
        <div className="form-stack">
          <label>
            <span className="label-row">
              제목<span className="required-mark">필수</span>
            </span>
            <input
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX}
              placeholder="예: 다익스트라에서 방문 처리는 언제 하나요?"
              aria-invalid={shown("title") ? true : undefined}
              aria-describedby={shown("title") ? "title-error" : undefined}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => touch("title")}
            />
            {shown("title") ? (
              <span id="title-error" className="field-error" aria-live="polite">
                {shown("title")}
              </span>
            ) : null}
          </label>
          <div className="field-row">
            <div className="field-group">
              <label htmlFor="tag-input">태그</label>
              <div
                className="tag-input"
                aria-invalid={shown("tag") ? true : undefined}
                onClick={() => document.getElementById("tag-input")?.focus()}
              >
                {tags.map((tag) => (
                  <span className="tag-chip" key={tag}>
                    #{tag}
                    <button
                      type="button"
                      aria-label={`${tag} 태그 삭제`}
                      onClick={() =>
                        setTags((previous) =>
                          previous.filter((value) => value !== tag),
                        )
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <input
                  id="tag-input"
                  value={tagText}
                  disabled={tags.length >= MAX_TAGS}
                  placeholder={
                    tags.length >= MAX_TAGS
                      ? `태그는 ${MAX_TAGS}개까지`
                      : "태그 입력 후 Enter"
                  }
                  aria-describedby={shown("tag") ? "tag-error" : undefined}
                  onChange={(event) => setTagText(event.target.value)}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => {
                    touch("tag");
                    addTag(tagText);
                  }}
                />
              </div>
              {shown("tag") ? (
                <span id="tag-error" className="field-error" aria-live="polite">
                  {shown("tag")}
                </span>
              ) : null}
            </div>
            <div className="field-group field-category">
              <span className="field-label" id="category-label">
                카테고리
              </span>
              <Select
                ariaLabel="카테고리"
                value={category}
                options={options.map((item) => ({
                  value: item.key,
                  label: categoryLongLabel(item.key),
                }))}
                onChange={(next) => setCategory(next as CategoryKey)}
              />
            </div>
          </div>
          <div className="md-field write-body">
            <div className="md-field-head">
              <div className="label-row">
                <label htmlFor="body-input" className="field-label">
                  본문
                </label>
                <span className="required-mark" aria-hidden="true">
                  필수
                </span>
              </div>
              <div
                className="md-tabs"
                role="tablist"
                aria-label="작성·미리보기 전환"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={bodyMode === "write"}
                  className={bodyMode === "write" ? "active" : ""}
                  onClick={() => setBodyMode("write")}
                >
                  작성
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bodyMode === "preview"}
                  className={bodyMode === "preview" ? "active" : ""}
                  onClick={() => {
                    touch("body");
                    setBodyMode("preview");
                  }}
                >
                  미리보기
                </button>
              </div>
            </div>
            {bodyMode === "write" ? (
              <textarea
                id="body-input"
                ref={bodyRef}
                className="write-body-input"
                value={body}
                placeholder={
                  "어떤 문제를 풀고 있나요?\n\n시도한 코드와 기대한 결과를 함께 적어주세요.\n코드는 ```로 감싸면 읽기 쉽습니다."
                }
                aria-required="true"
                aria-invalid={shown("body") ? true : undefined}
                aria-describedby={shown("body") ? "body-error" : undefined}
                onChange={(event) => setBody(event.target.value)}
                onBlur={() => touch("body")}
              />
            ) : (
              // 글 상세 화면과 같은 방식(.markdown.post-body, react-markdown)으로 그려서, 올렸을 때의 모습을 그대로 보여 준다.
              <div className="md-preview write-body-preview">
                {body.trim() ? (
                  <div className="markdown post-body">
                    <Markdown>{body}</Markdown>
                  </div>
                ) : (
                  <p className="muted">
                    미리볼 내용이 없어요. 작성 탭에서 입력해 보세요.
                  </p>
                )}
              </div>
            )}
            {shown("body") ? (
              <span id="body-error" className="field-error" aria-live="polite">
                {shown("body")}
              </span>
            ) : null}
          </div>
        </div>
      </form>
      <div className="write-bar">
        <p className="write-hint" role="status">
          {saveState === "failed"
            ? "임시 저장에 실패했어요. 입력한 내용은 그대로 남아 있습니다."
            : saveState === "saved" && savedAt
              ? `임시 저장됨 · ${savedTime(savedAt)}`
              : "작성한 내용은 임시 저장할 수 있습니다."}
        </p>
        <div className="write-footer">
          <button
            type="button"
            className="button button-ghost"
            onClick={cancel}
          >
            취소
          </button>
          <button
            type="button"
            className="button button-outline"
            onClick={saveDraft}
          >
            임시 저장
          </button>
          <button
            type="button"
            className="button"
            disabled={pending}
            onClick={() =>
              (
                document.querySelector(".write-form") as HTMLFormElement | null
              )?.requestSubmit()
            }
          >
            {pending
              ? editing
                ? "저장 중…"
                : "등록 중…"
              : editing
                ? "수정 저장"
                : "글 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
