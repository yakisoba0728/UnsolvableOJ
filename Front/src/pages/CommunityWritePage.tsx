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
import { categories, type CategoryKey } from "../community/types";
import { useDocumentTitle } from "../hooks";

const MAX_TAGS = 5;
const TITLE_MAX = 100;

type FieldErrors = { title?: string; body?: string };

export function CommunityWritePage() {
  const { id: editingId } = useParams();
  const editing = Boolean(editingId);
  useDocumentTitle(editing ? "글 수정" : "글 작성");
  const { session } = useAuth();
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

  // 이전에 임시 저장한 초안이 있으면 한 번만 복원한다.
  // (수정 모드에서는 새 글 초안을 건드리지 않는다.)
  const [restored] = useState(() => (editing ? null : readDraft()));
  // 배너에서 "풀이 공유하기"로 들어오면 그 카테고리로 시작한다.
  const [category, setCategory] = useState<CategoryKey>(
    original && options.some((item) => item.key === original.category)
      ? original.category
      : requestedCategory &&
          options.some((item) => item.key === requestedCategory)
        ? requestedCategory
        : restored && options.some((item) => item.key === restored.category)
          ? restored.category
          : "question",
  );
  const [title, setTitle] = useState(original?.title ?? restored?.title ?? "");
  const [tags, setTags] = useState<string[]>(
    original?.tags ?? restored?.tags ?? [],
  );
  const [tagText, setTagText] = useState("");
  const [body, setBody] = useState(original?.body ?? restored?.body ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
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

  const dirty = original
    ? title !== original.title ||
      body !== original.body ||
      category !== original.category ||
      tags.join("\n") !== original.tags.join("\n")
    : Boolean(title.trim() || body.trim() || tags.length);

  function saveDraft() {
    if (editing) return false;
    const now = Date.now();
    const ok = writeDraft({ category, title, tags, body, savedAt: now });
    setSaveState(ok ? "saved" : "failed");
    if (ok) setSavedAt(now);
    return ok;
  }

  // 입력하면 잠시 뒤 자동으로 임시 저장한다.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(saveDraft, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, title, tags, body]);

  // 작성 중에 탭을 닫거나 새로고침하면 브라우저가 확인한다.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 비로그인 접근은 App의 라우트에서 로그인 화면(또는 로그아웃 직후 홈)으로 보낸다.
  if (!session) return null;
  if (editing && (!original || original.author.name !== session.user.username))
    return (
      <Navigate
        to={editingId ? `/community/${editingId}` : "/community"}
        replace
      />
    );

  function addTag(raw: string) {
    const value = raw.trim().replace(/^#+/, "");
    if (!value) return;
    setTags((previous) =>
      previous.includes(value) || previous.length >= MAX_TAGS
        ? previous
        : [...previous, value],
    );
    setTagText("");
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한국어 입력 조합 중의 Enter는 글자 확정이므로 태그로 등록하지 않는다.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(tagText);
    } else if (event.key === "Backspace" && !tagText && tags.length) {
      setTags((previous) => previous.slice(0, -1));
    }
  }

  function cancel() {
    if (
      dirty &&
      !window.confirm(
        editing
          ? "수정한 내용이 저장되지 않아요. 나갈까요?"
          : "작성 중인 내용이 임시 저장되지 않은 채로 사라질 수 있어요. 나갈까요?",
      )
    ) {
      return;
    }
    navigate(editingId ? `/community/${editingId}` : "/community");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !session) return;
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "제목을 입력해 주세요.";
    if (!body.trim()) next.body = "본문을 입력해 주세요.";
    setErrors(next);
    if (next.title) return titleRef.current?.focus();
    if (next.body) return bodyRef.current?.focus();

    setPending(true);
    if (editingId) {
      communityActions.updatePost(editingId, {
        category,
        title: title.trim(),
        body: body.trim(),
        tags,
      });
      setPending(false);
      navigate(`/community/${editingId}`, {
        state: { notice: "글을 수정했어요." },
      });
      return;
    }
    const post = communityActions.addPost({
      category,
      title: title.trim(),
      body: body.trim(),
      tags,
      author: { name: session.user.username, tier: "Bronze I" },
    });
    clearDraft();
    // 입력 중이던 내용은 등록과 함께 비우므로 이탈 경고가 뜨지 않게 한다.
    setTitle("");
    setBody("");
    setTags([]);
    navigate(`/community/${post.id}`, {
      state: { notice: "글을 등록했어요." },
    });
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
              clearDraft();
              setTitle("");
              setBody("");
              setTags([]);
              setShowRestored(false);
              setSaveState("idle");
              setSavedAt(null);
            }}
          >
            초안 지우기
          </button>
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
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "title-error" : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (errors.title)
                  setErrors((prev) => ({ ...prev, title: undefined }));
              }}
            />
            {errors.title ? (
              <span id="title-error" className="field-error" role="alert">
                {errors.title}
              </span>
            ) : null}
          </label>
          <div className="field-row">
            <div className="field-group">
              <label htmlFor="tag-input">태그</label>
              <div
                className="tag-input"
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
                  onChange={(event) => setTagText(event.target.value)}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => addTag(tagText)}
                />
              </div>
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
                  label: item.key === "question" ? "질문과 답변" : item.label,
                }))}
                onChange={(next) => setCategory(next as CategoryKey)}
              />
            </div>
          </div>
          <label>
            <span className="label-row">
              본문<span className="required-mark">필수</span>
            </span>
            <textarea
              ref={bodyRef}
              rows={10}
              value={body}
              placeholder={
                "어떤 문제를 풀고 있나요?\n\n시도한 코드와 기대한 결과를 함께 적어주세요.\n코드는 ```로 감싸면 읽기 쉽습니다."
              }
              aria-invalid={Boolean(errors.body)}
              aria-describedby={errors.body ? "body-error" : undefined}
              onChange={(event) => {
                setBody(event.target.value);
                if (errors.body)
                  setErrors((prev) => ({ ...prev, body: undefined }));
              }}
            />
            {errors.body ? (
              <span id="body-error" className="field-error" role="alert">
                {errors.body}
              </span>
            ) : null}
          </label>
        </div>
      </form>
      <div className="write-bar">
        <p className="write-hint" role="status" hidden={editing}>
          {saveState === "failed"
            ? "임시 저장에 실패했어요. 입력한 내용은 그대로 남아 있습니다."
            : saveState === "saved" && savedAt
              ? `임시 저장됨 · ${new Date(savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
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
          {editing ? null : (
            <button
              type="button"
              className="button button-outline"
              onClick={saveDraft}
            >
              임시 저장
            </button>
          )}
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
