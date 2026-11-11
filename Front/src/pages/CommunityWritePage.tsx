import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { errorMessage, getPost, savePost } from "../community/api";
import {
  clearDraft,
  readDraft,
  writeDraft,
  type PostDraft,
} from "../community/store";
import {
  categories,
  categoryLongLabel,
  normalizeTag,
  type CategoryKey,
  type CommunityPost,
} from "../community/types";
import { useRequestOwner } from "../community/useRequestOwner";
import { savedTime, useDocumentTitle, useRequest } from "../hooks";
import { isImeEnter } from "../keyboard";
import { useUnsavedChanges } from "../useUnsavedChanges";

const MAX_TAGS = 5;
const TITLE_MAX = 100;
const TAG_MAX = 20;
const BODY_MAX = 20_000;
const CODE_MAX = 30_000;
const LANGUAGE_MAX = 40;
const AUTOSAVE_MS = 1200;

type Field = "title" | "body" | "tag";

/** 폼이 편집하는 값. 임시 초안에는 저장 시각(savedAt)을 붙여 그대로 남긴다. */
interface PostFields {
  category: CategoryKey;
  title: string;
  tags: string[];
  tagText: string;
  body: string;
  code: string;
  language: string;
  problemId: string | null;
}

/** 입력 규칙. 문제가 없으면 빈 문자열. 태그는 Enter로 확정하며 쉼표와 공백도 태그의 일부다. */
function fieldProblem(field: Field, value: string) {
  if (field === "title") {
    if (!value.trim()) return "제목을 입력해 주세요.";
    if (value.length > TITLE_MAX)
      return `제목은 ${TITLE_MAX}자 이하로 입력해 주세요.`;
  } else if (field === "body") {
    if (!value.trim()) return "본문을 입력해 주세요.";
  } else if (normalizeTag(value).length > TAG_MAX) {
    return `태그는 ${TAG_MAX}자 이하로 입력해 주세요.`;
  }
  return "";
}

/** 문제 화면 주소(/problems/view/slug)나 slug를 받아 slug만 돌려준다. */
function problemSlugOf(value: string) {
  const text = value.trim();
  const path = text.split("/problems/")[1];
  if (path === undefined) return text;
  return decodeURIComponent(path.replace(/^view\//, "").split(/[/?#]/)[0]);
}

/** 처음 여는 폼의 값: 복원한 초안 → 고칠 글 → 들어온 링크의 순서로 고른다. */
function initialFields(
  restored: PostDraft | null,
  original: CommunityPost | undefined,
  requested: { category: CategoryKey | null; problemId: string | null },
  allowed: (category: CategoryKey) => boolean,
): PostFields {
  const category =
    [restored?.category, original?.category, requested.category].find(
      (value): value is CategoryKey => Boolean(value && allowed(value)),
    ) ?? "question";
  return {
    category,
    title: restored?.title ?? original?.title ?? "",
    tags: restored?.tags ?? original?.tags ?? [],
    tagText: restored?.tagText ?? "",
    body: restored?.body ?? original?.body ?? "",
    code: restored?.code ?? original?.code ?? "",
    language: restored?.language ?? original?.language ?? "",
    problemId: restored
      ? (restored.problemId ?? null)
      : (original?.problemId ?? requested.problemId),
  };
}

/** 초안을 지웠을 때 돌아갈 값: 고칠 글(없으면 빈 새 글) */
function baseFields(
  original: CommunityPost | undefined,
  problemId: string | null,
): PostFields {
  return {
    category: original?.category ?? "question",
    title: original?.title ?? "",
    tags: original?.tags ?? [],
    tagText: "",
    body: original?.body ?? "",
    code: original?.code ?? "",
    language: original?.language ?? "",
    problemId: original?.problemId ?? problemId ?? null,
  };
}

/** 저장할 만한 변경이 있는지. 새 글은 내용을 하나라도 적었는지 본다. */
function isDirty(fields: PostFields, original?: CommunityPost) {
  const { category, title, tags, tagText, body, code, language, problemId } =
    fields;
  if (original)
    return (
      title !== original.title ||
      body !== original.body ||
      category !== original.category ||
      JSON.stringify(tags) !== JSON.stringify(original.tags) ||
      Boolean(tagText.trim()) ||
      code !== (original.code ?? "") ||
      language !== (original.language ?? "") ||
      problemId !== (original.problemId ?? null)
    );
  return Boolean(
    title.trim() ||
      body.trim() ||
      tags.length ||
      tagText.trim() ||
      code.trim() ||
      language.trim(),
  );
}

const sameFields = (a: PostFields, b: PostFields) =>
  (Object.keys(a) as (keyof PostFields)[]).every((key) => a[key] === b[key]);

export function CommunityWritePage({
  getNavigationVersion,
}: {
  getNavigationVersion: () => number;
}) {
  const { id: editingId } = useParams();
  useDocumentTitle(editingId ? "글 수정" : "글 작성");
  const { session } = useAuth();
  // 수정 모드: 글을 받아 온 뒤 폼을 연다. 내가 쓴 글만 고칠 수 있다.
  const { data: original, loading, error } = useRequest<CommunityPost | null>(
    editingId ? (signal) => getPost(editingId, signal, session?.accessToken) : null,
    null,
    "글을 불러오지 못했어요.",
    [editingId],
  );
  // 비로그인 접근은 App의 라우트에서 로그인 화면(또는 로그아웃 직후 홈)으로 보낸다.
  if (!session) return null;
  if (!editingId)
    return <WriteForm getNavigationVersion={getNavigationVersion} />;
  if (loading)
    return (
      <div className="write-page">
        <SkeletonRegion label="글을 불러오는 중입니다">
          <Skeleton width={160} height={30} style={{ margin: "16px 0 20px" }} />
          <Skeleton height={420} radius={14} />
        </SkeletonRegion>
      </div>
    );
  if (error)
    return (
      <div className="page-width empty-state" role="alert">
        <strong>글을 불러오지 못했어요.</strong>
        <p>{error}</p>
        <Link to={`/community/${editingId}`}>글로 돌아가기</Link>
      </div>
    );
  if (!original || original.authorId !== session.user.id)
    return <Navigate to={`/community/${editingId}`} replace />;
  return (
    <WriteForm original={original} getNavigationVersion={getNavigationVersion} />
  );
}

function WriteForm({
  original,
  getNavigationVersion,
}: {
  original?: CommunityPost;
  getNavigationVersion: () => number;
}) {
  const editingId = original?.id;
  const editing = Boolean(original);
  const { session } = useAuth();
  const ownerId = session?.user.id ?? "";
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const beginRequest = useRequestOwner(getNavigationVersion);
  const linkState = location.state as {
    category?: CategoryKey;
    problem?: { id: string; title: string };
  } | null;
  const isAdmin = session?.user.role === "ADMIN";
  // 공지는 관리자만 쓴다. 이미 공지인 글을 고칠 때는 그대로 둔다.
  const options = categories.filter(
    (item) =>
      item.key !== "notice" || isAdmin || item.key === original?.category,
  );

  // 새 글과 각 글의 수정 초안은 계정별로 따로 복원한다.
  const [restored] = useState(() => readDraft(ownerId, editingId));
  // 배너·문제 화면에서 들어오면 그 카테고리(c)와 문제(problemId)로 시작한다.
  const [fields, setFields] = useState(() =>
    initialFields(
      restored,
      original,
      {
        category:
          linkState?.category ?? (params.get("c") as CategoryKey | null),
        problemId: params.get("problemId"),
      },
      (category) => options.some((item) => item.key === category),
    ),
  );
  const { category, title, tags, tagText, body, code, language, problemId } =
    fields;
  /** 바뀐 값만 고친다. 실제로 바뀐 것이 없으면 다시 그리지 않는다(자동 저장 타이머도 그대로). */
  const patch = (
    change: Partial<PostFields> | ((previous: PostFields) => Partial<PostFields>),
  ) =>
    setFields((previous) => {
      const next = {
        ...previous,
        ...(typeof change === "function" ? change(previous) : change),
      };
      return sameFields(previous, next) ? previous : next;
    });

  // 문제 제목은 초안에 남기지 않는다. 모르면 "연결한 문제"로 보인다.
  const [problemTitle, setProblemTitle] = useState(
    original?.problem?.title ?? linkState?.problem?.title ?? "",
  );
  const [linking, setLinking] = useState(false);
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
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  // 저장·취소로 떠나는 중이면 참: 이탈 확인과 초안 보관을 건너뛴다.
  const bypass = useRef(false);
  const pendingRef = useRef(false);

  const dirty = isDirty(fields, original);
  useUnsavedChanges(dirty && Boolean(session), bypass);
  const latest = useRef({ ...fields, dirty });
  latest.current = { ...fields, dirty };

  function saveDraft() {
    if (bypass.current || pendingRef.current) return false;
    const now = Date.now();
    const draft = { ...fields, savedAt: now };
    const ok = writeDraft(ownerId, draft, editingId);
    setSaveState(ok ? "saved" : "failed");
    if (ok) setSavedAt(now);
    return draft;
  }

  useEffect(() => {
    if (!focusBody || bodyMode !== "write") return;
    bodyRef.current?.focus();
    setFocusBody(false);
  }, [focusBody, bodyMode]);

  // 입력하면 잠시 뒤 자동으로 임시 저장한다.
  useEffect(() => {
    if (!ownerId || bypass.current || pending) return;
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
    const timer = window.setTimeout(saveDraft, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [fields, dirty, ownerId, editingId, pending]);

  // 자동 저장을 기다리지 않고 이탈·세션 만료 직전의 입력까지 보관한다.
  useEffect(() => {
    const persistLatest = () => {
      if (
        bypass.current ||
        pendingRef.current ||
        !ownerId ||
        !latest.current.dirty
      )
        return;
      const { dirty: _dirty, ...draft } = latest.current;
      writeDraft(ownerId, { ...draft, savedAt: Date.now() }, editingId);
    };
    window.addEventListener("beforeunload", persistLatest);
    return () => {
      window.removeEventListener("beforeunload", persistLatest);
      persistLatest();
    };
  }, [ownerId, editingId]);

  if (!session) return null;

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
    const value = normalizeTag(raw);
    // '#'만 입력했거나 이미 있는 태그라면 등록할 것이 없으니 입력 칸만 비운다.
    patch((previous) => ({
      tagText: "",
      tags:
        !value ||
        previous.tags.length >= MAX_TAGS ||
        previous.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())
          ? previous.tags
          : [...previous.tags, value],
    }));
  }

  function cancel() {
    if (bypass.current || pendingRef.current) return;
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

  function discardDraft() {
    if (!clearDraft(ownerId, editingId)) {
      setSubmitError(
        "초안을 지우지 못했어요. 입력한 내용은 그대로 남아 있습니다.",
      );
      return;
    }
    setFields(baseFields(original, params.get("problemId")));
    setShowRestored(false);
    setSaveState("idle");
    setSavedAt(null);
    setSubmitError("");
  }

  /** 서버에 보내기 전 확인. 문제가 있으면 그 칸에 포커스하고 false를 돌려준다. */
  function validate() {
    setTouched({ title: true, body: true, tag: true });
    if (problems.title) {
      titleRef.current?.focus();
      return false;
    }
    if (problems.body) {
      setBodyMode("write");
      setFocusBody(true);
      return false;
    }
    if (problems.tag) {
      tagRef.current?.focus();
      return false;
    }
    // 서버 규칙: 풀이 공유는 문제를, 코드 리뷰는 코드와 언어를 함께 올린다.
    if (category === "solution" && !problemId) {
      setSubmitError("풀이를 공유할 문제를 연결해 주세요.");
      document.getElementById("problem-input")?.focus();
      return false;
    }
    if (category === "review" && (!code.trim() || !language.trim())) {
      setSubmitError("코드 리뷰에는 코드와 언어를 함께 입력해 주세요.");
      document
        .getElementById(language.trim() ? "code-input" : "language-input")
        ?.focus();
      return false;
    }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bypass.current || pendingRef.current || linking || !session) return;
    if (!validate()) return;

    const submittedDraft = saveDraft();
    const ownsRequest = beginRequest();
    pendingRef.current = true;
    setPending(true);
    setSubmitError("");
    try {
      const post = await savePost(
        {
          category,
          title: title.trim(),
          body: body.trim(),
          tags,
          code,
          language: language.trim(),
          problemId,
        },
        session.accessToken,
        editingId,
      );
      if (!ownsRequest()) return;
      const cleared = clearDraft(ownerId, editingId, submittedDraft || null);
      bypass.current = true;
      navigate(`/community/${post.id}`, {
        state: {
          notice: `${editing ? "글을 수정했어요." : "글을 등록했어요."}${cleared ? "" : " 임시 초안을 지우지 못했어요."}`,
        },
      });
    } catch (cause) {
      if (!ownsRequest()) return;
      setSubmitError(
        `글을 저장하지 못했어요. ${errorMessage(cause)} 입력한 내용과 초안은 그대로 남아 있어요.`,
      );
    } finally {
      // 늦게 온 응답이 언마운트 때의 초안 보관을 다시 켜지 않도록, 이 요청의 주인일 때만 잠금을 푼다.
      if (ownsRequest()) {
        pendingRef.current = false;
        if (!bypass.current) setPending(false);
      }
    }
  }

  const submitLabel = pending
    ? editing
      ? "저장 중…"
      : "등록 중…"
    : editing
      ? "수정 저장"
      : "글 등록";

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
            disabled={pending}
            onClick={discardDraft}
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
      <form
        ref={formRef}
        className="form-card write-form"
        onSubmit={submit}
        noValidate
      >
        <fieldset
          className="form-stack"
          disabled={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
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
              onChange={(event) => patch({ title: event.target.value })}
              onBlur={() => touch("title")}
            />
            <FieldError id="title-error" message={shown("title")} />
          </label>
          <div className="field-row">
            <TagField
              inputRef={tagRef}
              tags={tags}
              text={tagText}
              error={shown("tag")}
              onTextChange={(value) => patch({ tagText: value })}
              onAdd={addTag}
              onRemove={(tag) =>
                patch((previous) => ({
                  tags: previous.tags.filter((value) => value !== tag),
                }))
              }
              onRemoveLast={() =>
                patch((previous) => ({ tags: previous.tags.slice(0, -1) }))
              }
              onBlur={() => {
                touch("tag");
                addTag(tagText);
              }}
            />
            <div className="field-group field-category">
              <span className="field-label" id="category-label">
                카테고리
              </span>
              <Select
                ariaLabel="카테고리"
                // 서버는 글을 올린 뒤 게시판을 바꾸지 못하게 한다.
                disabled={editing || pending}
                value={category}
                options={options.map((item) => ({
                  value: item.key,
                  label: categoryLongLabel(item.key),
                }))}
                onChange={(next) => patch({ category: next as CategoryKey })}
              />
            </div>
          </div>
          <BodyField
            inputRef={bodyRef}
            mode={bodyMode}
            value={body}
            error={shown("body")}
            onModeChange={(mode) => {
              if (mode === "preview") touch("body");
              setBodyMode(mode);
            }}
            onChange={(value) => patch({ body: value })}
            onBlur={() => touch("body")}
          />
          <ProblemField
            problemId={problemId}
            problemTitle={problemTitle}
            required={category === "solution"}
            linking={linking}
            onLinkingChange={setLinking}
            onLink={(problem) => {
              patch({ problemId: problem.id });
              setProblemTitle(problem.title);
            }}
            onUnlink={() => {
              patch({ problemId: null });
              setProblemTitle("");
            }}
          />
          <label>
            <span className="label-row">
              코드 언어
              {category === "review" ? (
                <span className="required-mark">필수</span>
              ) : null}
            </span>
            <input
              id="language-input"
              value={language}
              maxLength={LANGUAGE_MAX}
              placeholder="Python, C++, Java…"
              onChange={(event) => patch({ language: event.target.value })}
            />
          </label>
          <label>
            <span className="label-row">
              공유할 코드
              {category === "review" ? (
                <span className="required-mark">필수</span>
              ) : null}
            </span>
            <textarea
              id="code-input"
              rows={8}
              value={code}
              maxLength={CODE_MAX}
              spellCheck={false}
              onChange={(event) => patch({ code: event.target.value })}
            />
          </label>
        </fieldset>
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
            disabled={pending}
            onClick={cancel}
          >
            취소
          </button>
          <button
            type="button"
            className="button button-outline"
            disabled={pending}
            onClick={saveDraft}
          >
            임시 저장
          </button>
          <button
            type="button"
            className="button"
            disabled={pending || linking}
            onClick={() => formRef.current?.requestSubmit()}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return message ? (
    <span id={id} className="field-error" aria-live="polite">
      {message}
    </span>
  ) : null;
}

/** 태그 칩과 입력 칸. Enter(또는 칸을 떠나면)로 확정하고, 빈 칸에서 Backspace로 마지막 태그를 지운다. */
function TagField({
  inputRef,
  tags,
  text,
  error,
  onTextChange,
  onAdd,
  onRemove,
  onRemoveLast,
  onBlur,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  tags: string[];
  text: string;
  error: string;
  onTextChange: (value: string) => void;
  onAdd: (raw: string) => void;
  onRemove: (tag: string) => void;
  onRemoveLast: () => void;
  onBlur: () => void;
}) {
  const full = tags.length >= MAX_TAGS;
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isImeEnter(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onAdd(text);
    } else if (event.key === "Backspace" && !text && tags.length) {
      onRemoveLast();
    }
  }
  return (
    <div className="field-group">
      <label htmlFor="tag-input">태그</label>
      <div
        className="tag-input"
        aria-invalid={error ? true : undefined}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            #{tag}
            <button
              type="button"
              aria-label={`${tag} 태그 삭제`}
              onClick={() => onRemove(tag)}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id="tag-input"
          value={text}
          disabled={full}
          placeholder={full ? `태그는 ${MAX_TAGS}개까지` : "태그 입력 후 Enter"}
          aria-describedby={error ? "tag-error" : undefined}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
      <FieldError id="tag-error" message={error} />
    </div>
  );
}

/** 본문 입력과, 글 상세 화면과 같은 모습의 미리보기 */
function BodyField({
  inputRef,
  mode,
  value,
  error,
  onModeChange,
  onChange,
  onBlur,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mode: "write" | "preview";
  value: string;
  error: string;
  onModeChange: (mode: "write" | "preview") => void;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const tabs = [
    { key: "write", label: "작성" },
    { key: "preview", label: "미리보기" },
  ] as const;
  return (
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
        <div className="md-tabs" role="tablist" aria-label="작성·미리보기 전환">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mode === tab.key}
              className={mode === tab.key ? "active" : ""}
              onClick={() => onModeChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {mode === "write" ? (
        <textarea
          id="body-input"
          ref={inputRef}
          className="write-body-input"
          value={value}
          placeholder={
            "어떤 문제를 풀고 있나요?\n\n시도한 코드와 기대한 결과를 함께 적어주세요.\n코드는 ```로 감싸면 읽기 쉽습니다."
          }
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "body-error" : undefined}
          maxLength={BODY_MAX}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      ) : (
        // 글 상세 화면과 같은 방식(.markdown.post-body, 문제와 같은 ProblemMarkdown)으로 그려서, 올렸을 때의 모습을 그대로 보여 준다.
        <div className="md-preview write-body-preview">
          {value.trim() ? (
            <div className="markdown post-body">
              <ProblemMarkdown>{value}</ProblemMarkdown>
            </div>
          ) : (
            <p className="muted">
              미리볼 내용이 없어요. 작성 탭에서 입력해 보세요.
            </p>
          )}
        </div>
      )}
      <FieldError id="body-error" message={error} />
    </div>
  );
}

/** 문제 주소나 slug로 문제를 찾아 연결한다. */
function ProblemField({
  problemId,
  problemTitle,
  required,
  linking,
  onLinkingChange,
  onLink,
  onUnlink,
}: {
  problemId: string | null;
  problemTitle: string;
  required: boolean;
  linking: boolean;
  onLinkingChange: (linking: boolean) => void;
  onLink: (problem: { id: string; title: string }) => void;
  onUnlink: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  async function link() {
    const slug = problemSlugOf(text);
    if (!slug) return setError("문제 주소를 입력해 주세요.");
    onLinkingChange(true);
    setError("");
    try {
      const problem = await api<{ id: string; title: string }>(
        `/problems/by-slug/${encodeURIComponent(slug)}`,
      );
      onLink(problem);
      setText("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      onLinkingChange(false);
    }
  }

  return (
    <div className="field-group">
      <label htmlFor="problem-input">
        연결 문제
        {required ? <span className="required-mark">필수</span> : null}
      </label>
      {problemId ? (
        <p className="muted" role="status">
          연결됨 · {problemTitle || "연결한 문제"}{" "}
          <button type="button" className="inline-button" onClick={onUnlink}>
            연결 해제
          </button>
        </p>
      ) : (
        <div className="field-row">
          <input
            id="problem-input"
            value={text}
            placeholder="문제 화면 주소를 붙여 넣으세요"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "problem-error" : undefined}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || isImeEnter(event)) return;
              event.preventDefault();
              void link();
            }}
          />
          <button
            type="button"
            className="button button-outline"
            disabled={linking}
            onClick={() => void link()}
          >
            문제 연결
          </button>
        </div>
      )}
      <FieldError id="problem-error" message={error} />
    </div>
  );
}
