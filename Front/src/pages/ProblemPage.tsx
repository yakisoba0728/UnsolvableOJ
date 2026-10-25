import { useEffect, useRef, useState, type FormEvent } from "react";
import { verdictLabel } from "../verdict";
import { savedTime, useDocumentTitle } from "../hooks";
import { Select } from "../components/Select";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { Link, useParams } from "react-router-dom";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { isJudging, useSubmissionResult } from "../components/JudgeResult";
import { CodeEditor, type CodeEditorHandle } from "../components/CodeEditor";
import { JudgePanel, readPanelHeight } from "../components/JudgePanel";
import { addUnits, remapUnits } from "../editor/codeEditing";
import { languages, starter } from "../editor/languages";
import {
  readSourceDraft,
  resetSourceDraft,
  writeSourceDraft,
} from "../editor/sourceDrafts";
import {
  LANGUAGE_LABELS,
  type Language,
  type Page,
  type Problem,
  type Submission,
} from "../types";
import { problemPath } from "../paths";
import {
  DEFAULT_SPLIT,
  HANDLE_WIDTH,
  resolveSplit,
  splitFromKey,
  splitFromPointer,
  type SplitMode,
  type SplitState,
} from "../solveSplit";
import { difficultyLabel } from "../difficulty";

type Tab = "statement" | "history";

const fontKey = "unsolvable-oj-editor-font-v1";
const FONT_MIN = 11;
const FONT_MAX = 20;

/** Tab으로 넣은 들여쓰기 한 단계의 위치 목록(초안 옆에 저장해, 새로고침 뒤에도 Backspace가 한 단계씩 지운다). */
function unitsKey(problemId: string, language: Language) {
  return `unsolvable-oj-draft-units-v1:${problemId}:${language}`;
}

function readUnits(problemId: string, language: Language): number[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(unitsKey(problemId, language)) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === "number")
      : [];
  } catch {
    return [];
  }
}

export function ProblemPage() {
  const { slug } = useParams();
  const [problem, setProblem] = useState<Problem | null>(null);
  useDocumentTitle(problem?.title);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<Language>("PYTHON");
  const [source, setSource] = useState(languages[0].starter);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // 이 화면에서 채점 중이거나 방금 채점한 제출(결과는 코드 창 아래에 바로 보여 준다)
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);
  // 문제 설명·코드 작성 폭은 저장하지 않는다: 화면을 열 때마다 기본 비율로 시작한다.
  const [split, setSplit] = useState<SplitState>(DEFAULT_SPLIT);
  const splitRef = useRef(split);
  const [gridWidth, setGridWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 끌던 중 손잡이가 사라져도(다른 문제로 이동 등) 끌기 상태가 남지 않게 정리하는 함수
  const endDragRef = useRef<(() => void) | null>(null);
  // 패널은 결과를 닫거나 다른 문제로 옮기면 사라지지만, 조절한 높이는 이 화면에 있는 동안 유지한다.
  const [panelHeight, setPanelHeight] = useState(readPanelHeight);
  const [tab, setTab] = useState<Tab>("statement");
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // 불러온 초안은 저장 시각을 모른다(이번에 저장하기 전까지 시각 없이 표시).
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  // 편집기는 문제를 불러올 때마다 새로 그려지므로, 화면에 있는 동안 이어지는 커서 표시는 페이지가 갖는다.
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  // Tab으로 넣은 들여쓰기 한 단계(공백 네 칸)의 시작 위치. 공백만으로는 직접 친 공백과 구분할 수 없어 따로 기억하고,
  // 값이 바뀔 때마다(입력·붙여넣기·실행 취소 포함) 따라 움직이게 하며, Backspace·Delete가 한 단계씩 지우는 데 쓴다.
  const unitsRef = useRef<number[]>([]);
  const unitsBaseRef = useRef("");
  // 글꼴 크기: 이 브라우저에 기억한다.
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(fontKey));
      return saved >= FONT_MIN && saved <= FONT_MAX ? saved : 13;
    } catch {
      return 13;
    }
  });
  function changeFont(step: number) {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + step));
    setFontSize(next);
    try {
      localStorage.setItem(fontKey, String(next));
    } catch {
      /* 저장소를 쓸 수 없어도 이번 방문에는 적용한다 */
    }
  }
  const { session } = useAuth();
  const { submission: result, error: resultError } = useSubmissionResult(
    submissionId,
    session,
  );
  const submittingRef = useRef(false);
  const currentProblemId = useRef<string | null>(null);
  currentProblemId.current = problem?.id ?? null;
  // 로그아웃·세션 만료 시 이전 채점 결과 패널을 닫는다.
  useEffect(() => {
    if (!session) setSubmissionId(null);
  }, [session]);
  const finishedId = result && !isJudging(result) ? result.id : null;

  // 두 패널을 담은 영역의 폭을 지켜봐서, 창이 줄어 한쪽이 너무 좁아지면 그 패널을 숨긴다.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => setGridWidth(grid.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [problem?.id]);

  // 다른 문제로 옮겨 가면 폭을 기본으로 되돌리고, 끌던 중이었다면 끌기를 끝낸다.
  useEffect(() => {
    endDragRef.current?.();
    splitRef.current = DEFAULT_SPLIT;
    setSplit(DEFAULT_SPLIT);
    return () => endDragRef.current?.();
  }, [problem?.id]);

  // 문제가 바뀌거나 불러와지면 저장된 초안을 복원한다.
  useEffect(() => {
    if (!problem) return;
    const draft = readSourceDraft(problem.id, language);
    const restored = draft.value ?? starter(language);
    setSource(restored);
    setSavedAt(draft.savedAt);
    setDraftLoaded(draft.value !== null);
    setSaveFailed(draft.failed);
    // 복원한 글에 맞는 Tab 단위만 이어받는다(글자가 공백 네 칸이 아니면 버려진다). 시작 코드의 들여쓰기는 기억하지 않는다.
    unitsRef.current = remapUnits(
      draft.value === null ? [] : readUnits(problem.id, language),
      restored,
      restored,
    );
    unitsBaseRef.current = restored;
  }, [problem?.id, language]);

  // 문제는 새 탭으로 열린다. 각 탭은 열린 시점의 초안만 가져오고, 같은 문제의 다른 탭과 실시간으로 동기화하지 않는다.
  // (다른 탭이 나중에 저장한 내용은 이 탭을 새로고침하거나 새 탭으로 열 때 반영된다.)

  // 전환·이탈 직전 입력도 남기고, 초안 복원은 다른 언어의 저장 내용을 덮어쓰지 않는다.
  function updateSource(next: string) {
    setSource(next);
    if (!problem) return;
    const draft = writeSourceDraft(problem.id, language, next);
    setSavedAt(draft.savedAt);
    setSaveFailed(draft.failed);
  }

  /** 값이 바뀐 만큼 기억한 Tab 단위를 옮기고, 이번 편집으로 새로 들어간 단위를 더한다. */
  function syncUnits(value: string, added: readonly number[] = []) {
    unitsRef.current = addUnits(
      remapUnits(unitsRef.current, unitsBaseRef.current, value),
      added,
      value,
    );
    unitsBaseRef.current = value;
    return unitsRef.current;
  }

  // 어떤 경로로 값이 바뀌어도(입력·붙여넣기·실행 취소·초기화) 기억한 단위가 글자와 어긋나지 않게 맞추고 저장한다.
  useEffect(() => {
    syncUnits(source);
    if (!problem) return;
    try {
      localStorage.setItem(
        unitsKey(problem.id, language),
        JSON.stringify(unitsRef.current),
      );
    } catch {
      /* 저장할 수 없어도 편집은 그대로 동작한다 */
    }
  }, [source]);

  useEffect(() => {
    if (tab !== "history" || !session || !problem) return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryFailed(false);
    api<Page<Submission>>(
      `/submissions?problemId=${problem.id}&page=1&limit=20`,
      { signal: controller.signal },
      session.accessToken,
    )
      .then((data) => setHistory(data.items))
      .catch(() => {
        if (!controller.signal.aborted) setHistoryFailed(true);
      });
    return () => controller.abort();
  }, [tab, session, problem, finishedId]);

  useEffect(() => {
    setSubmissionId(null);
    const controller = new AbortController();
    setError("");
    setProblem(null);
    setLoading(true);
    void api<Problem>(`/problems/by-slug/${encodeURIComponent(slug ?? "")}`, {
      signal: controller.signal,
    })
      .then(setProblem)
      .catch((cause) => {
        // 404만 '없는 문제'(오류 없이 빈 문제)로 두고, 나머지 실패는 이유를 보여 준다.
        if (
          !controller.signal.aborted &&
          !(cause instanceof ApiError && cause.status === 404)
        )
          setError(
            cause instanceof Error
              ? cause.message
              : "문제를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Ctrl/⌘+Enter로도 제출되므로 버튼 비활성화만으로는 중복·빈 코드 제출을 막을 수 없다.
    if (!problem || !session || submittingRef.current || !source.trim()) return;
    submittingRef.current = true;
    const requestedFor = problem.id;
    setSubmitting(true);
    setSubmitError("");
    try {
      const submitted = await api<Submission>(
        `/problems/${problem.id}/submissions`,
        {
          method: "POST",
          body: JSON.stringify({ language, sourceCode: source }),
        },
        session.accessToken,
      );
      // 응답을 기다리는 사이 다른 문제로 옮겼다면 그 화면에는 결과를 보이지 않는다.
      if (currentProblemId.current === requestedFor) {
        setSubmissionId(submitted.id);
        setPanelOpen(true);
      }
    } catch (cause) {
      if (currentProblemId.current === requestedFor)
        setSubmitError(
          cause instanceof Error ? cause.message : "제출하지 못했습니다.",
        );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <div className="solve-page">
        <SkeletonRegion label="문제를 불러오는 중입니다">
          <Skeleton width={320} height={34} style={{ margin: "16px 0 20px" }} />
          <div className="solve-skeleton-grid">
            <Skeleton height={520} radius={14} />
            <Skeleton height={520} radius={14} />
          </div>
        </SkeletonRegion>
      </div>
    );
  if (error || !problem)
    return (
      <div className="page-width empty-state not-found-state" role="alert">
        <strong>
          {error ? "문제를 불러오지 못했어요" : "문제를 찾을 수 없어요"}
        </strong>
        <p>
          {error || "주소가 바뀌었거나 아직 공개되지 않은 문제일 수 있어요."}
        </p>
        <Link className="button" to="/problems">
          문제 목록으로
        </Link>
      </div>
    );

  // 지금 화면 폭에서 실제로 보이는 모습(둘 다 / 문제 설명만 / 코드 작성만)과 그에 맞는 열 크기.
  // 열 크기는 CSS 변수로 넘기고, 1100px 이하의 위아래 쌓이는 배치에서는 CSS가 이 값을 무시한다.
  const splitMode: SplitMode =
    gridWidth > 0
      ? resolveSplit(split, gridWidth)
      : split.collapsed === "statement"
        ? "code"
        : split.collapsed === "code"
          ? "statement"
          : "split";
  const splitColumns =
    splitMode === "code"
      ? `0px ${HANDLE_WIDTH}px minmax(0, 1fr)`
      : splitMode === "statement"
        ? `minmax(0, 1fr) ${HANDLE_WIDTH}px 0px`
        : `minmax(0, ${Math.round(split.ratio * 1000)}fr) ${HANDLE_WIDTH}px minmax(0, ${Math.round((1 - split.ratio) * 1000)}fr)`;
  const splitPercent =
    splitMode === "code"
      ? 0
      : splitMode === "statement"
        ? 100
        : Math.round(split.ratio * 100);

  function applySplit(next: SplitState) {
    splitRef.current = next;
    setSplit(next);
  }

  function startSplitDrag(event: React.PointerEvent<HTMLDivElement>) {
    const grid = gridRef.current;
    // 보조 버튼과 두 번째 손가락의 입력은 무시한다
    if (!grid || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    // 어떤 이유로 끝나지 못한 이전 끌기가 있으면 정리하고 새로 시작한다(이후 끌기가 막히지 않게)
    endDragRef.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    // 끌기를 시작해도 키보드로 이어서 조절할 수 있게 손잡이가 초점을 받는다
    handle.focus({ preventScroll: true });
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rect = grid.getBoundingClientRect();
      applySplit(
        splitFromPointer(
          moveEvent.clientX - rect.left,
          rect.width,
          splitRef.current,
        ),
      );
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      endDragRef.current = null;
      setDragging(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    endDragRef.current = end;
  }

  function onSplitKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = splitFromKey(event.key, gridWidth || 1, splitRef.current);
    if (!next) return;
    event.preventDefault();
    applySplit(next);
  }

  return (
    <div className="solve-page">
      <div className="solve-heading">
        <h1>{problem.title}</h1>
        <nav className="community-problem-links" aria-label="문제 커뮤니티">
          <Link to={`/community?c=question&problemId=${problem.id}`}>질문 보기</Link>
          <Link to={`/community?c=solution&problemId=${problem.id}`}>풀이 공유</Link>
          <Link
            to={`/community/new?c=question&problemId=${problem.id}`}
            state={{ problem: { id: problem.id, title: problem.title } }}
          >
            질문 작성
          </Link>
        </nav>
        <span
          className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
        >
          {difficultyLabel(problem.difficulty)}
        </span>
      </div>
      <div
        ref={gridRef}
        className={`solve-grid is-${splitMode}${dragging ? " is-dragging" : ""}`}
        style={{ "--solve-columns": splitColumns } as React.CSSProperties}
      >
        <section
          className={`solve-panel statement-panel${splitMode === "code" ? " is-hidden" : ""}`}
        >
          <div className="tab-list" role="tablist" aria-label="문제 보기">
            <button
              role="tab"
              id="problem-tab-statement"
              aria-selected={tab === "statement"}
              aria-controls={tab === "statement" ? "problem-tabpanel" : undefined}
              className={`tab-button ${tab === "statement" ? "active" : ""}`}
              onClick={() => setTab("statement")}
            >
              문제 설명
            </button>
            <button
              role="tab"
              id="problem-tab-history"
              aria-selected={tab === "history"}
              aria-controls={tab === "history" ? "problem-tabpanel" : undefined}
              className={`tab-button ${tab === "history" ? "active" : ""}`}
              onClick={() => setTab("history")}
            >
              제출 내역
            </button>
          </div>
          {tab === "statement" ? (
            <article
              className="problem-content"
              role="tabpanel"
              id="problem-tabpanel"
              aria-labelledby="problem-tab-statement"
            >
              <div className="meta-strip">
                <span>
                  <strong>시간</strong> {problem.timeLimitMs}ms
                </span>
                <span>
                  <strong>메모리</strong> {problem.memoryLimitMb}MB
                </span>
                <span>
                  <strong>예제</strong> {problem.samples.length}개
                </span>
              </div>
              <section>
                <h2>문제</h2>
                <div className="markdown">
                  <ProblemMarkdown>{problem.statementMarkdown}</ProblemMarkdown>
                </div>
              </section>
              {problem.inputDescriptionMarkdown ? (
                <section>
                  <h2>입력</h2>
                  <div className="markdown">
                    <ProblemMarkdown>
                      {problem.inputDescriptionMarkdown}
                    </ProblemMarkdown>
                  </div>
                </section>
              ) : null}
              {problem.outputDescriptionMarkdown ? (
                <section>
                  <h2>출력</h2>
                  <div className="markdown">
                    <ProblemMarkdown>
                      {problem.outputDescriptionMarkdown}
                    </ProblemMarkdown>
                  </div>
                </section>
              ) : null}
              {problem.samples.map((sample, index) => (
                <section key={index}>
                  <h2>예제 {index + 1}</h2>
                  <div className="sample-grid">
                    <div>
                      <h3>입력</h3>
                      <pre>{sample.input}</pre>
                    </div>
                    <div>
                      <h3>출력</h3>
                      <pre>{sample.expectedOutput}</pre>
                    </div>
                  </div>
                </section>
              ))}
            </article>
          ) : (
            <div
              className="history-panel"
              role="tabpanel"
              id="problem-tabpanel"
              aria-labelledby="problem-tab-history"
            >
              {!session ? (
                <p className="muted">
                  로그인하면 이 문제의 제출 내역이 여기에 표시됩니다.
                </p>
              ) : historyFailed ? (
                <p className="error-message" role="alert">
                  제출 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
                </p>
              ) : history === null ? (
                <SkeletonRegion label="제출 내역을 불러오는 중입니다">
                  <Skeleton height={40} style={{ marginBottom: 10 }} />
                  <Skeleton height={40} style={{ marginBottom: 10 }} />
                  <Skeleton height={40} />
                </SkeletonRegion>
              ) : history.length ? (
                <ul className="history-list">
                  {history.map((item) => (
                    <li key={item.id}>
                      <Link to={`/submissions/${item.id}`}>
                        <span
                          className={`verdict verdict-${item.status.toLowerCase()}`}
                        >
                          {verdictLabel(item.status)}
                        </span>
                        <span>
                          {LANGUAGE_LABELS[item.language] ?? item.language} ·{" "}
                          {new Date(item.createdAt).toLocaleString("ko-KR")}
                        </span>
                        <span className="muted">
                          {item.passedTestCases}/{item.totalTestCases}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  아직 이 문제를 제출하지 않았습니다. 오른쪽에서 코드를 작성해
                  제출해 보세요.
                </p>
              )}
            </div>
          )}
        </section>

        <div
          className="solve-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="문제 설명과 코드 작성 크기 조절"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={splitPercent}
          tabIndex={0}
          title="좌우로 끌어 크기를 조절해요. 너무 줄이면 그 쪽이 사라지고, 끌어서 다시 열 수 있어요. (←→ 키, 더블클릭으로 원래대로)"
          onPointerDown={startSplitDrag}
          onKeyDown={onSplitKeyDown}
          onDoubleClick={() => applySplit(DEFAULT_SPLIT)}
        >
          <span className="solve-resizer-grip" aria-hidden="true" />
        </div>
        <section
          className={`solve-panel code-panel${splitMode === "statement" ? " is-hidden" : ""}`}
          aria-label="코드 작성"
        >
          <div className="code-toolbar">
            <Select
              className="language-select"
              ariaLabel="언어"
              value={language}
              options={languages.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              onChange={(next) => setLanguage(next as Language)}
            />
            <span className="save-state" role="status">
              {saveFailed
                ? "초안을 읽거나 저장하지 못했어요. 현재 내용은 메모리에만 남아 새로고침 후 복구되지 않을 수 있어요."
                : savedAt
                  ? `초안 저장됨 · ${savedTime(savedAt)}`
                  : draftLoaded
                    ? "저장된 초안을 불러왔어요"
                    : "자동 저장 대기"}
            </span>
            <span className="cursor-info" aria-live="off">
              줄 {cursor.line}, 열 {cursor.column}
            </span>
            <span className="font-controls" role="group" aria-label="글꼴 크기">
              <button
                type="button"
                className="font-button"
                aria-label="글꼴 작게"
                disabled={fontSize <= FONT_MIN}
                onClick={() => changeFont(-1)}
              >
                A−
              </button>
              <span className="font-size" aria-hidden="true">
                {fontSize}
              </span>
              <button
                type="button"
                className="font-button"
                aria-label="글꼴 크게"
                disabled={fontSize >= FONT_MAX}
                onClick={() => changeFont(1)}
              >
                A+
              </button>
            </span>
            <button
              type="button"
              className="text-button light reset-button"
              onClick={() => {
                codeEditorRef.current?.reset(starter(language));
                // 처음 상태로 돌아가므로 기억한 Tab 단위도 비운다.
                unitsRef.current = [];
                unitsBaseRef.current = starter(language);
                setSource(starter(language));
                setSaveFailed(!resetSourceDraft(problem.id, language, starter(language)));
                setSavedAt(null);
                setDraftLoaded(false);
              }}
            >
              초기화
            </button>
          </div>
          <form onSubmit={submit} className="code-form">
            <CodeEditor
              ref={codeEditorRef}
              language={language}
              value={source}
              fontSize={fontSize}
              onChange={updateSource}
              onCursorChange={setCursor}
              syncUnits={syncUnits}
            />
            {submissionId ? (
              <JudgePanel
                result={result}
                error={resultError}
                open={panelOpen}
                height={panelHeight}
                onHeightChange={setPanelHeight}
                onToggle={() => setPanelOpen((open) => !open)}
                onClose={() => setSubmissionId(null)}
              />
            ) : null}
            {submitError ? (
              <p className="error-message" role="alert">
                {submitError}
              </p>
            ) : null}
            <p className="editor-hints" id="editor-shortcuts">
              Tab 들여쓰기 · Shift+Tab 내어쓰기 · <kbd>Ctrl/⌘ + /</kbd> 주석 ·
              괄호·따옴표 자동 완성 · <kbd>Ctrl + Space</kbd> 제안 · ↑↓ 선택,
              Enter/Tab 적용, 스니펫은 Tab으로 다음 칸 · Esc 다음 Tab 또는
              Shift+Tab으로 편집기 밖 이동
            </p>
            <div className="code-actions">
              {session ? (
                <>
                  <span className="editor-note">
                    {source.trim() ? (
                      <>
                        제출하면 전체 테스트 케이스로 채점합니다 ·{" "}
                        <kbd>Ctrl/⌘ + Enter</kbd>
                      </>
                    ) : (
                      "코드를 입력하면 제출할 수 있어요."
                    )}
                  </span>
                  <button
                    className="button"
                    disabled={submitting || !source.trim()}
                  >
                    {submitting ? "제출 중…" : "제출하고 채점하기 →"}
                  </button>
                </>
              ) : (
                <>
                  <span className="editor-note">
                    코드를 제출하려면 로그인해 주세요. 작성 중인 코드는 이
                    브라우저에 저장됩니다.
                  </span>
                  <Link
                    className="button"
                    to="/auth"
                    state={{ from: problemPath(problem.slug) }}
                  >
                    로그인하고 풀기
                  </Link>
                </>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
