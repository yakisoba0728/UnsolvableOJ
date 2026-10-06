import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../auth";
import {
  clearDraft,
  communityActions,
  readDraft,
  writeDraft,
} from "../community/store";
import { categories, type CategoryKey } from "../community/types";
import { useDocumentTitle } from "../hooks";

import { api, isDemo } from "../api";
import { savePost, getPost, errorMessage } from "../community/api";
const MAX_TAGS = 5;
const TITLE_MAX = 100;

type FieldErrors = { title?: string; body?: string };

export function CommunityWritePage() {
  const { session } = useAuth();
  const { id } = useParams();
  return (
    <CommunityWriteForm
      key={(session?.user.id ?? "anonymous") + ":" + (id ?? "new")}
    />
  );
}
function CommunityWriteForm() {
  useDocumentTitle("글 작성");
  const { session } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const scope = isDemo
    ? "demo"
    : (session?.user.id ?? "anonymous") + ":" + (id ?? "new");
  const [problemSlug, setProblemSlug] = useState("");
  const [problemLabel, setProblemLabel] = useState("");
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const isAdmin = session?.user.role === "ADMIN";
  const options = categories.filter((item) => item.key !== "notice" || isAdmin);

  // 이전에 임시 저장한 초안이 있으면 한 번만 복원한다.
  const [restored] = useState(() => readDraft(scope));
  const [code, setCode] = useState(restored?.code ?? "");
  const [language, setLanguage] = useState(restored?.language ?? "");
  const [problemId, setProblemId] = useState<string | null>(
    restored?.problemId ?? params.get("problemId"),
  );
  const [editable, setEditable] = useState(!id);
  const [category, setCategory] = useState<CategoryKey>(
    restored && options.some((item) => item.key === restored.category)
      ? restored.category
      : categories.some((c) => c.key === params.get("c")) &&
          params.get("c") !== "notice"
        ? (params.get("c") as CategoryKey)
        : "question",
  );
  const [title, setTitle] = useState(restored?.title ?? "");
  const [tags, setTags] = useState<string[]>(restored?.tags ?? []);
  const [tagText, setTagText] = useState("");
  const [body, setBody] = useState(restored?.body ?? "");
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

  useEffect(() => {
    if (!id || isDemo) return;
    const controller = new AbortController();
    setLoading(true);
    getPost(id, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        if (p.authorId !== session?.user.id)
          throw new Error("작성자만 수정할 수 있습니다.");
        setEditable(true);
        setCategory(p.category);
        if (!restored) {
          setTitle(p.title);
          setBody(p.body);
          setTags(p.tags);
          setCode(p.code ?? "");
          setLanguage(p.language ?? "");
          setProblemId(p.problemId ?? null);
        }
        setProblemLabel(p.problem?.title ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setApiError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, scope]);
  const dirty = Boolean(
    title.trim() || body.trim() || tags.length || code.trim(),
  );

  function saveDraft() {
    const now = Date.now();
    const ok = writeDraft(
      { category, title, tags, body, code, language, problemId, savedAt: now },
      scope,
    );
    setSaveState(ok ? "saved" : "failed");
    if (ok) setSavedAt(now);
    return ok;
  }

  // 입력할 때 계정별 초안을 저장해 새로고침 직전의 내용도 복원한다.
  useEffect(() => {
    if (loading || pending || !editable) return;
    if (!dirty) {
      clearDraft(scope);
      return;
    }
    saveDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    category,
    title,
    tags,
    body,
    code,
    language,
    problemId,
    loading,
    pending,
  ]);

  // 작성 중에 탭을 닫거나 새로고침하면 브라우저가 확인한다.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!session)
      navigate("/auth", {
        replace: true,
        state: {
          from: id ? `/community/${id}/edit` : `/community/new?${params}`,
        },
      });
  }, [session, navigate]);
  if (!session) return null;

  function addTag(raw: string) {
    const value = raw.trim().replace(/^#+/, "");
    if (!value || value.length > 30) return;
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
        "작성 중인 내용이 임시 저장되지 않은 채로 사라질 수 있어요. 나갈까요?",
      )
    ) {
      return;
    }
    navigate("/community");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || !editable || !session) return;
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "제목을 입력해 주세요.";
    if (!body.trim()) next.body = "본문을 입력해 주세요.";
    setErrors(next);
    if (next.title) return titleRef.current?.focus();
    if (next.body) return bodyRef.current?.focus();

    if (category === "review" && (!code.trim() || !language.trim())) {
      setApiError("코드 리뷰에는 코드와 언어를 입력해 주세요.");
      return;
    }
    if (!isDemo && category === "solution" && !problemId) {
      setApiError("풀이를 공유할 문제를 연결해 주세요.");
      return;
    }
    setPending(true);
    setApiError("");
    try {
      const post = isDemo
        ? communityActions.addPost({
            category,
            title: title.trim(),
            body: body.trim(),
            tags,
            code,
            language,
            author: { name: session.user.username, tier: "Bronze I" },
          })
        : await savePost(
            {
              category,
              title: title.trim(),
              body: body.trim(),
              tags,
              code,
              language,
              problemId,
            },
            session.accessToken,
            id,
          );
      clearDraft(scope);
      // 입력 중이던 내용은 등록과 함께 비우므로 이탈 경고가 뜨지 않게 한다.
      setTitle("");
      setBody("");
      setTags([]);
      navigate("/community/" + post.id, {
        state: { notice: id ? "글을 수정했어요." : "글을 등록했어요." },
      });
    } catch (e) {
      setApiError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <div className="write-page">
      <Link
        className="back-link"
        to="/community"
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm(
              "작성 중인 내용이 임시 저장되지 않은 채로 사라질 수 있어요. 나갈까요?",
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        ← 커뮤니티
      </Link>
      <h1>{id ? "글 수정" : "글 작성"}</h1>
      {loading && <p role="status">게시글을 불러오는 중…</p>}
      {apiError && (
        <p className="error-message" role="alert">
          {apiError}
        </p>
      )}
      {showRestored ? (
        <p className="notice-inline" role="status">
          작성 중이던 초안을 불러왔어요.{" "}
          <button
            type="button"
            className="inline-button"
            onClick={() => {
              clearDraft(scope);
              setCode("");
              setLanguage("");
              setProblemId(params.get("problemId"));
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
          {!isDemo && (
            <div className="field-group">
              <label htmlFor="linked-problem">
                연결할 문제 주소 또는 식별자
                {category === "solution" ? " · 필수" : ""}
              </label>
              <input
                id="linked-problem"
                value={problemSlug}
                onChange={(e) => setProblemSlug(e.target.value)}
                placeholder="문제 페이지의 주소를 붙여넣으세요"
              />
              <button
                type="button"
                className="button button-outline"
                disabled={pending || loading}
                onClick={async () => {
                  setApiError("");
                  setPending(true);
                  try {
                    let slug = problemSlug.trim();
                    if (slug.includes("/problems/"))
                      slug = decodeURIComponent(
                        slug.split("/problems/")[1].split(/[?#]/)[0],
                      );
                    if (!slug) throw new Error("문제 주소를 입력하세요.");
                    const p = await api<{ id: string; title: string }>(
                      "/problems/by-slug/" + encodeURIComponent(slug),
                    );
                    setProblemId(p.id);
                    setProblemLabel(p.title);
                  } catch (e) {
                    setApiError(errorMessage(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                문제 연결
              </button>
              {problemId && (
                <p role="status">
                  연결됨 · {problemLabel || problemId}{" "}
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => {
                      setProblemId(null);
                      setProblemLabel("");
                    }}
                  >
                    연결 해제
                  </button>
                </p>
              )}
            </div>
          )}
          <label>
            카테고리
            <select
              disabled={Boolean(id)}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as CategoryKey)
              }
            >
              {options.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key === "question" ? "질문과 답변" : item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            제목 · 필수
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
                maxLength={30}
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
          <label>
            본문 · 필수
            <textarea
              ref={bodyRef}
              rows={10}
              maxLength={20000}
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
          <label>
            코드 언어{category === "review" ? " · 필수" : ""}
            <input
              maxLength={40}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Python, C++, Java…"
            />
          </label>
          <label>
            공유할 코드{category === "review" ? " · 필수" : ""}
            <textarea
              rows={8}
              maxLength={30000}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        </div>
      </form>
      <p className="write-hint" role="status">
        {saveState === "failed"
          ? "임시 저장에 실패했어요. 입력한 내용은 그대로 남아 있습니다."
          : saveState === "saved" && savedAt
            ? `임시 저장됨 · ${new Date(savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
            : "작성한 내용은 임시 저장할 수 있습니다."}
      </p>
      <div className="write-footer">
        <button type="button" className="button button-ghost" onClick={cancel}>
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
          disabled={pending || loading || !editable}
          onClick={() =>
            (
              document.querySelector(".write-form") as HTMLFormElement | null
            )?.requestSubmit()
          }
        >
          {pending ? "저장 중…" : id ? "수정 완료" : "글 등록"}
        </button>
      </div>
    </div>
  );
}
