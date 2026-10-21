import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { MarkdownField } from "../components/MarkdownField";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { savedTime, useDocumentTitle } from "../hooks";
import { useUnsavedChanges } from "../useUnsavedChanges";
import { problemPath } from "../paths";
import { CaseEditor } from "../problems/CaseEditor";
import {
  SLUG_PATTERN,
  blankCase,
  blankForm,
  clearProblemDraft,
  composeStatement,
  editCases,
  isPristine,
  problemDraftScope,
  readProblemDraft,
  reviewForm,
  slugify,
  splitStatement,
  validate,
  writeProblemDraft,
  type CaseAction,
  type FormErrors,
  type ProblemForm,
} from "../problems/editor";
import type { Difficulty, Problem } from "../types";
import { difficultyOptions } from "../difficulty";

interface ManagedProblem extends Problem {
  testCases: {
    input: string;
    expectedOutput: string;
    isSample: boolean;
    score: number;
  }[];
}

const sections = [
  { id: "sec-basic", label: "기본 정보" },
  { id: "sec-statement", label: "문제 설명" },
  { id: "sec-cases", label: "테스트케이스" },
  { id: "sec-review", label: "확인·저장" },
];

const snapshot = (form: ProblemForm) =>
  JSON.stringify({
    ...form,
    cases: form.cases.map(({ collapsed: _c, key: _k, ...rest }) => rest),
  });

function toForm(problem: ManagedProblem): ProblemForm {
  const parts = splitStatement(problem.statementMarkdown);
  return {
    title: problem.title,
    slug: problem.slug,
    difficulty: problem.difficulty as Difficulty,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    statement: parts.statement,
    inputDescription: problem.inputDescriptionMarkdown,
    outputDescription: problem.outputDescriptionMarkdown,
    hint: parts.hint,
    source: parts.source,
    cases: problem.testCases.length
      ? problem.testCases.map((item) => ({ ...blankCase(), ...item }))
      : [blankCase()],
  };
}

function jumpTo(target: string) {
  const el =
    document.getElementById(`f-${target}`) ?? document.getElementById(target);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  window.setTimeout(
    () => {
      el.querySelector<HTMLElement>("input:not([readonly]), textarea")?.focus({
        preventScroll: true,
      });
    },
    reduce ? 0 : 250,
  );
}

export function CreateProblemPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  useDocumentTitle(editing ? "문제 수정" : "새 문제 만들기");
  const { session } = useAuth();
  const navigate = useNavigate();
  const canPublish = session?.user.role === "ADMIN";

  const [draftScope] = useState(() => problemDraftScope(session!.user.id, id));
  const [recovery] = useState(() => readProblemDraft(draftScope));
  const restored = recovery.draft;
  const [form, setForm] = useState<ProblemForm>(restored?.form ?? blankForm());
  const [slugTouched, setSlugTouched] = useState(
    restored?.slugTouched ?? false,
  );
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [showErrors, setShowErrors] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);
  const [serverSlugError, setServerSlugError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState("");
  const [loadedStatus, setLoadedStatus] = useState("");
  const [createdDraft, setCreatedDraft] = useState<Problem | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(
    restored?.savedAt ?? null,
  );
  const [saveFailed, setSaveFailed] = useState(recovery.failed);
  const [activeSection, setActiveSection] = useState(sections[0].id);
  const initialRef = useRef(snapshot(form));
  const initialFormRef = useRef(form);
  const doneRef = useRef(false);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);

  const errors: FormErrors = useMemo(
    () => validate(form, !editing),
    [form, editing],
  );
  const shown: FormErrors = showErrors ? errors : { cases: {} };
  const dirty = editing
    ? snapshot(form) !== initialRef.current
    : !isPristine(form);
  const draft = useMemo(
    () => ({
      form,
      slugTouched,
      savedAt: Date.now(),
      // randomUUID는 보안 컨텍스트(HTTPS·localhost)에만 있다. 사설 IP의 HTTP 접속에서도 열리게 한다.
      revision:
        crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
    [form, slugTouched],
  );
  const latestRef = useRef({ draft, dirty, loading });
  latestRef.current = { draft, dirty, loading };
  useUnsavedChanges(dirty && !loading, doneRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const latest = latestRef.current;
      if (!doneRef.current && latest.dirty && !latest.loading)
        writeProblemDraft(draftScope, latest.draft);
    };
  }, [draftScope]);

  function patch(next: Partial<ProblemForm>) {
    doneRef.current = false;
    setForm((previous) => ({ ...previous, ...next }));
  }

  // 수정 화면: 기존 문제를 불러온다.
  useEffect(() => {
    if (!id || !session) return;
    let cancelled = false;
    api<ManagedProblem>(`/problems/${id}/manage`, {}, session.accessToken)
      .then((problem) => {
        if (cancelled) return;
        const loaded = toForm(problem);
        initialRef.current = snapshot(loaded);
        initialFormRef.current = loaded;
        setForm(restored?.form ?? loaded);
        setLoadedStatus(problem.status);
      })
      .catch((cause) => {
        if (!cancelled)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "문제를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, session?.user.id]);

  // 확정된 입력은 바로 저장한다: 화면을 벗어날 때의 복구가 지연 저장에 기대면 안 된다.
  function saveDraft() {
    if (doneRef.current || loading) return;
    const ok = writeProblemDraft(draftScope, draft);
    setSaveFailed(!ok);
    setSavedAt(ok ? draft.savedAt : null);
  }
  useLayoutEffect(() => {
    if (loading || doneRef.current) return;
    if (!dirty) {
      const previous = readProblemDraft(draftScope).draft;
      if (previous) {
        setSaveFailed(!clearProblemDraft(draftScope, previous));
        setSavedAt(null);
      }
      return;
    }
    saveDraft();
  }, [draft, dirty, loading]);

  // 이미 공개된 주소인지 잠시 뒤에 확인한다(초안 주소는 저장할 때 서버가 알려 준다).
  useEffect(() => {
    setServerSlugError("");
    setSlugTaken(false);
    if (editing || form.slug.length < 3 || !SLUG_PATTERN.test(form.slug))
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<Problem>(`/problems/by-slug/${form.slug}`)
        .then(() => !cancelled && setSlugTaken(true))
        .catch(() => undefined);
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.slug, editing]);

  // 화면 위 단계 막대: 지금 보고 있는 구역을 강조한다.
  useEffect(() => {
    const targets = sections
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading, createdDraft]);

  function changeCases(action: CaseAction) {
    doneRef.current = false;
    setForm((previous) => {
      const cases = editCases(previous.cases, action);
      return cases === previous.cases ? previous : { ...previous, cases };
    });
  }

  const {
    sampleCount,
    hiddenCount,
    firstCaseError,
    checklist,
    warnings,
    stepDone,
    firstErrorTarget,
  } = reviewForm(form, errors, editing, slugTaken);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || pendingRef.current || doneRef.current) return;
    setShowErrors(true);
    setError("");
    if (firstErrorTarget) {
      // 접혀 있던 케이스는 펼쳐서 오류 칸이 보이게 한다.
      if (firstCaseError)
        setForm((previous) => ({
          ...previous,
          cases: editCases(previous.cases, { type: "reveal", errors: errors.cases }),
        }));
      window.setTimeout(() => jumpTo(firstErrorTarget), 50);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    saveDraft();
    const submittedDraft = draft;
    const content = {
      title: form.title.trim(),
      statementMarkdown: composeStatement(form),
      inputDescriptionMarkdown: form.inputDescription,
      outputDescriptionMarkdown: form.outputDescription,
      difficulty: form.difficulty,
      timeLimitMs: form.timeLimitMs,
      memoryLimitMb: form.memoryLimitMb,
      testCases: form.cases.map(
        ({ input, expectedOutput, isSample, score }) => ({
          input,
          expectedOutput,
          isSample,
          score,
        }),
      ),
    };
    try {
      if (editing) {
        await api<Problem>(
          `/problems/${id}`,
          { method: "PATCH", body: JSON.stringify(content) },
          session.accessToken,
        );
        if (
          !mountedRef.current ||
          latestRef.current.draft.revision !== submittedDraft.revision
        ) return;
        doneRef.current = true;
        clearProblemDraft(draftScope, submittedDraft);
        navigate("/my-problems", {
          state: {
            notice:
              !canPublish && loadedStatus === "PUBLISHED"
                ? "수정했어요. 공개 중이던 문제는 초안으로 돌아가며, 관리자 검수 후 다시 공개돼요."
                : "문제를 수정했어요.",
          },
        });
        return;
      }
      const problem = await api<Problem>(
        "/problems",
        {
          method: "POST",
          body: JSON.stringify({
            slug: form.slug,
            ...content,
            status: canPublish ? "PUBLISHED" : "DRAFT",
          }),
        },
        session.accessToken,
      );
      if (
        !mountedRef.current ||
        latestRef.current.draft.revision !== submittedDraft.revision
      ) return;
      doneRef.current = true;
      clearProblemDraft(draftScope, submittedDraft);
      if (problem.status === "PUBLISHED") navigate(problemPath(problem.slug));
      else setCreatedDraft(problem);
    } catch (cause) {
      if (!mountedRef.current) return;
      const message =
        cause instanceof Error ? cause.message : "문제를 저장하지 못했습니다.";
      if (cause instanceof ApiError && cause.status === 409) {
        setServerSlugError(message);
        window.setTimeout(() => jumpTo("slug"), 50);
      } else setError(message);
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }

  function cancel() {
    navigate(editing ? "/my-problems" : "/problems");
  }

  if (loading)
    return (
      <div className="page-width create-page">
        <SkeletonRegion label="문제를 불러오는 중입니다">
          <Skeleton width={220} height={32} style={{ margin: "8px 0 24px" }} />
          <Skeleton height={56} radius={10} />
          <Skeleton height={240} radius={10} style={{ marginTop: 16 }} />
          <Skeleton height={160} radius={10} style={{ marginTop: 16 }} />
        </SkeletonRegion>
      </div>
    );
  if (loadError)
    return (
      <div className="page-width create-page">
        <PageHeader
          back={{ to: "/my-problems", label: "내 문제" }}
          title="문제를 열 수 없어요."
          description={loadError}
        />
      </div>
    );

  if (createdDraft)
    return (
      <div className="page-width create-page">
        <PageHeader
          back={{ to: "/problems", label: "문제 목록" }}
          title="초안을 저장했습니다."
          description={`“${createdDraft.title}” 문제는 관리자 검수 후 공개됩니다.`}
        />
        <div className="card-actions">
          <Link className="button" to="/my-problems">
            내 문제 보기
          </Link>
          <Link className="button button-outline" to="/problems">
            문제 목록으로
          </Link>
        </div>
      </div>
    );

  const statusText = saveFailed
    ? "임시 저장소를 읽거나 저장하지 못했어요. 현재 내용은 메모리에만 남아 있어 새로고침·탭 닫기 후 복구되지 않을 수 있어요."
    : savedAt
      ? `이 탭에 임시 저장됨 · ${savedTime(savedAt)}`
      : editing
        ? "변경 사항이 없어요."
        : "작성한 내용은 이 탭이 열려 있는 동안 임시 저장돼요.";

  const slugError =
    shown.slug ||
    serverSlugError ||
    (slugTaken ? "이미 공개된 문제가 쓰고 있는 주소예요." : "");

  return (
    <div className="page-width create-page">
      <PageHeader
        back={{
          to: editing ? "/my-problems" : "/problems",
          label: editing ? "내 문제" : "문제 목록",
        }}
        title={editing ? "문제 수정" : "새 문제 만들기"}
        description={
          editing
            ? `${
                canPublish
                  ? "저장하면 바로 반영됩니다."
                  : "공개된 문제를 수정하면 초안으로 돌아가 관리자 검수를 다시 거칩니다."
              } 주소(slug)는 바꿀 수 없어요.`
            : `${
                canPublish
                  ? "저장하면 문제가 바로 공개됩니다."
                  : "초안으로 저장한 뒤 관리자 검수를 거쳐 공개됩니다."
              } 예제만 문제 페이지에 표시되고, 나머지 테스트케이스는 채점에만 사용됩니다.`
        }
        aside={
          <Link className="button button-outline" to="/my-problems">
            내 문제
          </Link>
        }
      />
      {showRestored ? (
        <p className="notice-inline" role="status">
          작성 중이던 문제를 불러왔어요.{" "}
          <button
            type="button"
            className="inline-button"
            disabled={pending}
            onClick={() => {
              doneRef.current = true;
              const previous = readProblemDraft(draftScope).draft;
              if (previous) setSaveFailed(!clearProblemDraft(draftScope, previous));
              setForm(editing ? initialFormRef.current : blankForm());
              setSlugTouched(false);
              setSavedAt(null);
              setShowRestored(false);
            }}
          >
            {editing ? "복구 내용 버리기" : "지우고 새로 시작"}
          </button>
        </p>
      ) : null}

      <nav className="step-nav" aria-label="작성 단계">
        {sections.map((item, index) => (
          <button
            type="button"
            key={item.id}
            className={`${activeSection === item.id ? "active" : ""} ${stepDone[item.id] ? "done" : ""}`}
            aria-current={activeSection === item.id ? "step" : undefined}
            onClick={() => jumpTo(item.id)}
          >
            <span className="step-dot" aria-hidden="true">
              {stepDone[item.id] ? "✓" : index + 1}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <form onSubmit={submit} className="create-form" noValidate>
        <fieldset disabled={pending} style={{ display: "contents" }}>
        <section className="form-card" id="sec-basic">
          <h2>
            <span className="step-num" aria-hidden="true">
              1
            </span>
            기본 정보
          </h2>
          <div className="form-grid">
            <div className="field-group span-2" id="f-title">
              <div className="label-row">
                <label htmlFor="problem-title" className="field-label">
                  제목
                </label>
                <span className="required-mark" aria-hidden="true">
                  필수
                </span>
              </div>
              <input
                id="problem-title"
                value={form.title}
                maxLength={150}
                placeholder="예: 두 수의 합"
                aria-required="true"
                aria-invalid={Boolean(shown.title)}
                onChange={(event) => {
                  const title = event.target.value;
                  patch({
                    title,
                    ...(!editing && !slugTouched
                      ? { slug: slugify(title) }
                      : {}),
                  });
                }}
              />
              {shown.title ? (
                <span className="field-error" role="alert">
                  {shown.title}
                </span>
              ) : null}
            </div>
            <div className="field-group span-2" id="f-slug">
              <div className="label-row">
                <label htmlFor="problem-slug" className="field-label">
                  주소용 slug
                </label>
                <span className="required-mark" aria-hidden="true">
                  필수
                </span>
              </div>
              <input
                id="problem-slug"
                value={form.slug}
                readOnly={editing}
                maxLength={80}
                placeholder="a-plus-b"
                aria-required="true"
                aria-invalid={Boolean(slugError)}
                onChange={(event) => {
                  setSlugTouched(true);
                  patch({ slug: event.target.value.toLowerCase() });
                }}
              />
              {slugError ? (
                <span className="field-error" role="alert">
                  {slugError}
                </span>
              ) : (
                <span className="field-help">
                  {editing
                    ? "주소는 만든 뒤에 바꿀 수 없어요."
                    : form.slug
                      ? `문제 주소: /problems/${form.slug}`
                      : "제목이 영문이면 자동으로 채워져요. 한글 제목은 직접 입력해 주세요."}
                </span>
              )}
            </div>
            <div className="field-group">
              <span className="field-label">난이도</span>
              <Select
                ariaLabel="난이도"
                value={form.difficulty}
                options={difficultyOptions}
                onChange={(next) => patch({ difficulty: next as Difficulty })}
              />
            </div>
            <div className="field-group" id="f-limits">
              <div className="limit-row">
                <div className="field-group">
                  <label htmlFor="problem-time" className="field-label">
                    시간 제한 (ms)
                  </label>
                  <input
                    id="problem-time"
                    type="number"
                    min={100}
                    max={60000}
                    value={
                      Number.isNaN(form.timeLimitMs) ? "" : form.timeLimitMs
                    }
                    aria-invalid={Boolean(shown.timeLimitMs)}
                    onChange={(event) =>
                      patch({ timeLimitMs: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="problem-memory" className="field-label">
                    메모리 제한 (MB)
                  </label>
                  <input
                    id="problem-memory"
                    type="number"
                    min={16}
                    max={4096}
                    value={
                      Number.isNaN(form.memoryLimitMb) ? "" : form.memoryLimitMb
                    }
                    aria-invalid={Boolean(shown.memoryLimitMb)}
                    onChange={(event) =>
                      patch({ memoryLimitMb: Number(event.target.value) })
                    }
                  />
                </div>
              </div>
              {shown.timeLimitMs || shown.memoryLimitMb ? (
                <span className="field-error" role="alert">
                  {shown.timeLimitMs ?? shown.memoryLimitMb}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="form-card" id="sec-statement">
          <h2>
            <span className="step-num" aria-hidden="true">
              2
            </span>
            문제 설명
          </h2>
          <div className="form-stack">
            <MarkdownField
              id="statement"
              label="문제 본문 (Markdown)"
              required
              rows={8}
              value={form.statement}
              onChange={(statement) => patch({ statement })}
              error={shown.statement}
              placeholder="두 정수 A와 B가 주어질 때, A+B를 출력하는 프로그램을 작성하세요."
              help="`코드`, **굵게**, 목록, 표를 쓸 수 있어요. 미리보기에서 풀이 화면과 같은 모양을 확인하세요."
            />
            <MarkdownField
              id="input-desc"
              label="입력 설명"
              required
              rows={4}
              value={form.inputDescription}
              onChange={(inputDescription) => patch({ inputDescription })}
              error={shown.inputDescription}
              placeholder="첫째 줄에 A와 B가 공백으로 구분되어 주어진다."
            />
            <MarkdownField
              id="output-desc"
              label="출력 설명"
              required
              rows={4}
              value={form.outputDescription}
              onChange={(outputDescription) => patch({ outputDescription })}
              error={shown.outputDescription}
              placeholder="첫째 줄에 A+B를 출력한다."
            />
            <details
              className="optional-box"
              open={Boolean(form.hint || form.source)}
            >
              <summary>힌트·출처 (선택)</summary>
              <div className="form-stack">
                <MarkdownField
                  id="hint"
                  label="힌트"
                  rows={3}
                  value={form.hint}
                  onChange={(hint) => patch({ hint })}
                  help="문제 본문 아래 ‘힌트’ 구역으로 보여요."
                />
                <div className="field-group">
                  <label htmlFor="problem-source" className="field-label">
                    출처
                  </label>
                  <input
                    id="problem-source"
                    value={form.source}
                    maxLength={200}
                    placeholder="예: 직접 출제, 2026 교내 대회"
                    onChange={(event) => patch({ source: event.target.value })}
                  />
                </div>
              </div>
            </details>
          </div>
        </section>

        <section className="form-card" id="sec-cases">
          <div className="section-heading">
            <div>
              <h2>
                <span className="step-num" aria-hidden="true">
                  3
                </span>
                테스트케이스
              </h2>
              <p className="case-summary" id="f-cases" aria-live="polite">
                <span className="case-pill sample">예제 {sampleCount}개</span>
                <span className="case-pill hidden">숨김 {hiddenCount}개</span>
                <span className="muted">
                  예제는 문제 화면에 보이고, 숨김은 채점에만 사용돼요.
                </span>
              </p>
            </div>
            <div className="case-tools">
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  changeCases({
                    type: "collapseAll",
                    collapsed: !form.cases.every((item) => item.collapsed),
                  })
                }
              >
                {form.cases.every((item) => item.collapsed)
                  ? "모두 펼치기"
                  : "모두 접기"}
              </button>
            </div>
          </div>
          {shown.testCases ? (
            <p className="field-error" role="alert">
              {shown.testCases}
            </p>
          ) : null}
          {form.cases.map((testCase, index) => (
            <CaseEditor
              key={testCase.key}
              testCase={testCase}
              index={index}
              total={form.cases.length}
              error={shown.cases[testCase.key]}
              onEdit={changeCases}
            />
          ))}
          <div className="case-add">
            <button
              type="button"
              className="button button-outline"
              onClick={() => changeCases({ type: "add", isSample: true })}
            >
              + 예제 추가
            </button>
            <button
              type="button"
              className="button button-outline"
              onClick={() => changeCases({ type: "add", isSample: false })}
            >
              + 숨김 케이스 추가
            </button>
          </div>
        </section>

        <section className="form-card" id="sec-review">
          <h2>
            <span className="step-num" aria-hidden="true">
              4
            </span>
            확인·저장
          </h2>
          <ul className="checklist" aria-label="저장 전 확인 목록">
            {checklist.map((item) => (
              <li key={item.label} className={item.ok ? "ok" : "todo"}>
                <span className="check-mark" aria-hidden="true">
                  {item.ok ? "✓" : "!"}
                </span>
                <span>{item.label}</span>
                {item.ok ? (
                  <span className="check-state">완료</span>
                ) : (
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => jumpTo(item.target)}
                  >
                    입력하러 가기
                  </button>
                )}
              </li>
            ))}
          </ul>
          {warnings.length ? (
            <ul className="check-warnings" aria-label="권장 사항">
              {warnings.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <div className="editor-bar">
          <p className="editor-status" role="status">
            {statusText}
          </p>
          <div className="editor-actions">
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
            <button className="button" disabled={pending}>
              {pending
                ? "저장 중…"
                : editing
                  ? "수정 저장하기 →"
                  : canPublish
                    ? "문제 게시하기 →"
                    : "초안 저장하기 →"}
            </button>
          </div>
        </div>
        </fieldset>
      </form>
    </div>
  );
}
