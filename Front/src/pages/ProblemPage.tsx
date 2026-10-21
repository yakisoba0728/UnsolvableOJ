import { useEffect, useRef, useState, type FormEvent } from "react";
import { verdictLabel } from "../verdict";
import { useDocumentTitle } from "../hooks";
import { Select } from "../components/Select";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { Link, useParams } from "react-router-dom";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  CaseResults,
  isJudging,
  ResultNotices,
  ResultSummary,
  useSubmissionResult,
} from "../components/JudgeResult";
import {
  applySuggestion,
  currentWord,
  moveStop,
  reconcileSession,
  recordAccepted,
  suggest,
  type SnippetSession,
  type Suggestion,
} from "../editor/autocomplete";
import {
  addUnits,
  applyToTextarea,
  backspaceUnit,
  cursorPosition,
  deleteUnit,
  handleBackspace,
  handleCharacter,
  handleEnter,
  handleTab,
  remapUnits,
  toggleComment,
  type EditResult,
  type EditState,
} from "../editor/codeEditing";
import type { Language, Page, Problem, Submission } from "../types";
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
import { difficultyLabel } from "./ProblemsPage";

const languages: { value: Language; label: string; starter: string }[] = [
  {
    value: "PYTHON",
    label: "Python 3",
    starter:
      "def solution():\n    answer = 0\n    # 여기에 코드를 작성하세요.\n    return answer\n\n\nprint(solution())\n",
  },
  {
    value: "CPP",
    label: "C++ 20",
    starter:
      '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n\nint solution() {\n    int answer = 0;\n    // 여기에 코드를 작성하세요.\n    return answer;\n}\n\nint main() {\n    cout << solution() << "\\n";\n    return 0;\n}\n',
  },
  {
    value: "C",
    label: "C 17",
    starter:
      '#include <stdio.h>\n\nint solution(void) {\n    int answer = 0;\n    // 여기에 코드를 작성하세요.\n    return answer;\n}\n\nint main(void) {\n    printf("%d\\n", solution());\n    return 0;\n}\n',
  },
  {
    value: "JAVA",
    label: "Java 21",
    starter:
      "import java.util.*;\n\npublic class Main {\n    static int solution(Scanner sc) {\n        int answer = 0;\n        // 여기에 코드를 작성하세요.\n        return answer;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println(solution(sc));\n    }\n}\n",
  },
  {
    value: "JAVASCRIPT",
    label: "JavaScript",
    starter:
      'const lines = require("fs").readFileSync(0, "utf8").trim().split("\\n");\n\nfunction solution() {\n  let answer = 0;\n  // 여기에 코드를 작성하세요.\n  return answer;\n}\n\nconsole.log(solution());\n',
  },
  {
    value: "TYPESCRIPT",
    label: "TypeScript",
    starter:
      'import * as fs from "fs";\nconst lines: string[] = fs.readFileSync(0, "utf8").trim().split("\\n");\n\nfunction solution(): number {\n  let answer = 0;\n  // 여기에 코드를 작성하세요.\n  return answer;\n}\n\nconsole.log(solution());\n',
  },
  {
    value: "GO",
    label: "Go",
    starter:
      'package main\n\nimport (\n    "bufio"\n    "fmt"\n    "os"\n)\n\nfunc solution(reader *bufio.Reader) int {\n    answer := 0\n    // 여기에 코드를 작성하세요.\n    return answer\n}\n\nfunc main() {\n    reader := bufio.NewReader(os.Stdin)\n    fmt.Println(solution(reader))\n}\n',
  },
  {
    value: "RUST",
    label: "Rust",
    starter:
      'use std::io::{self, Read};\n\nfn solution(input: &str) -> i64 {\n    let answer: i64 = 0;\n    // 여기에 코드를 작성하세요.  (값을 바꾸려면 answer를 mut로 선언하세요)\n    let _ = input;\n    answer\n}\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    println!("{}", solution(&input));\n}\n',
  },
];

type Tab = "statement" | "history";

const fontKey = "unsolvable-oj-editor-font-v1";
const FONT_MIN = 11;
const FONT_MAX = 20;
// 채점 결과 패널의 높이(px): 위쪽 손잡이를 끌거나 ↑↓ 키로 조절하고, 마지막 값을 기억한다.
const panelHeightKey = "unsolvable-oj-judge-height-v1";
const PANEL_MIN = 120;
const PANEL_DEFAULT = 260;
const PANEL_KEY_STEP = 24;

function draftKey(problemId: string, language: Language) {
  return `unsolvable-oj-draft-v1:${problemId}:${language}`;
}

function readDraft(problemId: string, language: Language) {
  try {
    return localStorage.getItem(draftKey(problemId, language));
  } catch {
    return null;
  }
}

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

const kindGlyph: Record<Suggestion["kind"], string> = {
  snippet: "{}",
  keyword: "k",
  function: "ƒ",
  method: "ƒ",
  property: "p",
  class: "C",
  variable: "v",
  module: "M",
  word: "a",
};
const kindName: Record<Suggestion["kind"], string> = {
  snippet: "스니펫",
  keyword: "키워드",
  function: "함수",
  method: "메서드",
  property: "속성",
  class: "타입",
  variable: "변수",
  module: "모듈",
  word: "",
};

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
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(panelHeightKey));
      return saved >= PANEL_MIN ? saved : PANEL_DEFAULT;
    } catch {
      return PANEL_DEFAULT;
    }
  });
  const [tab, setTab] = useState<Tab>("statement");
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  // 자동완성 제안 목록(커서 아래에 표시)
  const [popup, setPopup] = useState<{
    items: Suggestion[];
    index: number;
    caret: number;
    left: number;
    top: number;
  } | null>(null);
  const suppressSuggest = useRef(false);
  // 스니펫의 Tab 칸 이동 상태, 직전 입력창 값(칸 위치 보정용), 미러 동기화 중 표시
  const sessionRef = useRef<SnippetSession | null>(null);
  // Tab으로 넣은 들여쓰기 한 단계(공백 네 칸)의 시작 위치. 공백만으로는 직접 친 공백과 구분할 수 없어 따로 기억하고,
  // 값이 바뀔 때마다(입력·붙여넣기·실행 취소 포함) 따라 움직이게 하며, Backspace·Delete가 한 단계씩 지우는 데 쓴다.
  const unitsRef = useRef<number[]>([]);
  const unitsBaseRef = useRef("");
  const lastValueRef = useRef("");
  const syncingRef = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
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

  const starter = (value: Language) =>
    languages.find((item) => item.value === value)?.starter ?? "";

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
    const draft = readDraft(problem.id, language);
    const restored = draft ?? starter(language);
    setSource(restored);
    setSavedAt(draft ? new Date() : null);
    // 복원한 글에 맞는 Tab 단위만 이어받는다(글자가 공백 네 칸이 아니면 버려진다). 시작 코드의 들여쓰기는 기억하지 않는다.
    unitsRef.current = remapUnits(
      draft === null ? [] : readUnits(problem.id, language),
      restored,
      restored,
    );
    unitsBaseRef.current = restored;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id, language]);

  // 문제는 새 탭으로 열린다. 각 탭은 열린 시점의 초안만 가져오고, 같은 문제의 다른 탭과 실시간으로 동기화하지 않는다.
  // (다른 탭이 나중에 저장한 내용은 이 탭을 새로고침하거나 새 탭으로 열 때 반영된다.)

  // 전환·이탈 직전 입력도 남기고, 초안 복원은 다른 언어의 저장 내용을 덮어쓰지 않는다.
  function updateSource(next: string) {
    setSource(next);
    if (!problem) return;
    try {
      localStorage.setItem(draftKey(problem.id, language), next);
      setSavedAt(new Date());
    } catch {
      setSavedAt(null);
    }
  }

  useEffect(() => {
    lastValueRef.current = source;
  }, [source]);

  /** 값이 바뀐 만큼 기억한 Tab 단위를 옮기고, 이번 편집으로 새로 들어간 단위를 더한다. */
  function syncUnits(value: string, added: readonly number[] = []) {
    unitsRef.current = addUnits(
      remapUnits(unitsRef.current, unitsBaseRef.current, value),
      added,
      value,
    );
    unitsBaseRef.current = value;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // 문제나 언어가 바뀌면 진행 중이던 스니펫 칸 이동을 끝낸다.
  useEffect(() => {
    sessionRef.current = null;
  }, [problem?.id, language]);

  // 방향키로 고른 제안이 목록 밖으로 나가지 않게 따라간다.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [popup?.index]);

  useEffect(() => {
    if (tab !== "history" || !session || !problem) return;
    const controller = new AbortController();
    setHistory(null);
    api<Page<Submission>>(
      `/submissions?problemId=${problem.id}&page=1&limit=20`,
      { signal: controller.signal },
      session.accessToken,
    )
      .then((data) => setHistory(data.items))
      .catch(() => {
        if (!controller.signal.aborted) setHistory([]);
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
        if (!controller.signal.aborted)
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
    // Ctrl/⌘+Enter로도 제출되므로 버튼 비활성화만으로는 중복 제출을 막을 수 없다.
    if (!problem || !session || submittingRef.current) return;
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
        <strong>문제를 찾을 수 없어요</strong>
        <p>
          {error && !error.includes("찾을 수 없")
            ? error
            : "주소가 바뀌었거나 아직 공개되지 않은 문제일 수 있어요."}
        </p>
        <Link className="button" to="/problems">
          문제 목록으로
        </Link>
      </div>
    );

  const selectedLanguage = languages.find((item) => item.value === language);
  const lineCount = source.split("\n").length;

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

  // 코드 입력 칸이 최소한 남도록, 결과 패널은 코드 패널 높이에서 일정 부분을 뺀 만큼까지만 키운다.
  function clampPanelHeight(value: number) {
    const room = panelRef.current?.parentElement?.clientHeight ?? 800;
    return Math.round(
      Math.min(Math.max(PANEL_MIN, room - 200), Math.max(PANEL_MIN, value)),
    );
  }
  function savePanelHeight(value: number) {
    try {
      localStorage.setItem(panelHeightKey, String(value));
    } catch {
      /* 저장할 수 없어도 화면은 그대로 동작한다 */
    }
  }
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

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelRef.current?.offsetHeight ?? panelHeight;
    let latest = startHeight;
    const move = (moveEvent: PointerEvent) => {
      latest = clampPanelHeight(startHeight + (startY - moveEvent.clientY));
      setPanelHeight(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      savePanelHeight(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function resizePanelByKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowUp"
        ? PANEL_KEY_STEP
        : event.key === "ArrowDown"
          ? -PANEL_KEY_STEP
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampPanelHeight(panelHeight + delta);
    setPanelHeight(next);
    savePanelHeight(next);
  }
  function updateCursor(target: HTMLTextAreaElement) {
    setCursor(cursorPosition(target.value, target.selectionStart));
  }

  /** 계산한 편집 결과를 입력창에 적용한다(실행 취소가 유지되도록 브라우저 편집 명령을 우선 쓴다). */
  function applyEdit(target: HTMLTextAreaElement, next: EditState) {
    if (!applyToTextarea(target, next)) {
      updateSource(next.value);
      requestAnimationFrame(() =>
        target.setSelectionRange(next.start, next.end),
      );
    }
    updateCursor(target);
  }

  /** 커서 자리에 맞는 제안을 계산해 커서 근처에 띄운다(공간이 모자라면 위쪽에). */
  function refreshSuggest(target: HTMLTextAreaElement, manual = false) {
    if (target.selectionStart !== target.selectionEnd) return setPopup(null);
    const items = suggest(target.value, target.selectionStart, language, {
      manual,
    });
    if (!items.length) return setPopup(null);
    const { line, column } = cursorPosition(
      target.value,
      target.selectionStart,
    );
    const typed =
      currentWord(target.value, target.selectionStart)?.text.length ?? 0;
    // 고정폭 글꼴이라 줄·열로 위치를 계산한다(글자 폭 0.6em, 줄 높이 1.6em).
    const frame = target.parentElement;
    const lineHeight = fontSize * 1.6;
    const width = 340;
    const maxLeft = Math.max(
      0,
      (frame?.clientWidth ?? 600) + (frame?.scrollLeft ?? 0) - width,
    );
    const below = target.offsetTop + 16 + line * lineHeight + 4;
    // 목록(최대 8줄) + 설명 줄 높이를 어림해, 아래가 모자라면 커서 줄 위로 올린다.
    const height = Math.min(items.length, 8) * 28 + 40;
    const visibleBottom =
      (frame?.scrollTop ?? 0) + (frame?.clientHeight ?? 400);
    const top =
      below + height > visibleBottom
        ? Math.max(0, below - lineHeight - 8 - height)
        : below;
    setPopup({
      items,
      index: 0,
      caret: target.selectionStart,
      left: Math.min(
        maxLeft,
        target.offsetLeft + (column - 1 - typed) * fontSize * 0.6,
      ),
      top,
    });
  }

  /** 제안을 적용한다. 글이 바뀌지 않으면(이미 완성된 단어) 아무것도 하지 않고 false를 돌려준다. */
  function acceptSuggestion(index: number): boolean {
    const target = editorRef.current;
    const item = popup?.items[index];
    if (!target || !item) return false;
    const applied = applySuggestion(target.value, target.selectionStart, item);
    if (applied.value === target.value) {
      setPopup(null);
      return false;
    }
    recordAccepted(item.label);
    suppressSuggest.current = true; // 적용 직후에는 다시 띄우지 않는다
    sessionRef.current = null;
    setPopup(null);
    applyEdit(target, applied);
    // 옮겨 다닐 칸이 있으면 이어서 Tab으로 이동할 수 있게 한다.
    sessionRef.current = applied.session;
    return true;
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const modifier = event.metaKey || event.ctrlKey;
    // Ctrl/⌘ + Enter 로 바로 제출 (LeetCode·HackerRank 방식)
    if (event.key === "Enter" && modifier) {
      event.preventDefault();
      target.form?.requestSubmit();
      return;
    }
    // 한글 등 조합 입력 중에는 편집 규칙을 적용하지 않는다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // 수동 호출: Ctrl+Space(VS Code·IntelliJ), ⌘I(VS Code Mac), Alt+/
    if (
      (event.ctrlKey && event.code === "Space") ||
      (event.metaKey && event.key.toLowerCase() === "i") ||
      (event.altKey && event.code === "Slash")
    ) {
      event.preventDefault();
      refreshSuggest(target, true);
      return;
    }
    if (popup) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPopup({
          ...popup,
          index: (popup.index + step + popup.items.length) % popup.items.length,
        });
        return;
      }
      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        const step = event.key === "PageDown" ? 8 : -8;
        setPopup({
          ...popup,
          index: Math.min(
            popup.items.length - 1,
            Math.max(0, popup.index + step),
          ),
        });
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !modifier &&
        !event.shiftKey
      ) {
        // 바뀌는 것이 없으면 Enter·Tab은 평소 동작(줄바꿈·들여쓰기)으로 넘긴다.
        const before = popup.index;
        event.preventDefault();
        if (acceptSuggestion(before)) return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPopup(null);
        return;
      }
    }
    // 스니펫 칸 이동: Tab/Shift+Tab으로 다음·이전 칸, Esc나 Enter, 방향키 이동은 끝낸다.
    if (sessionRef.current) {
      if (event.key === "Tab" && !modifier && !event.altKey) {
        const moved = moveStop(sessionRef.current, event.shiftKey);
        if (moved) {
          event.preventDefault();
          sessionRef.current = moved.session;
          target.setSelectionRange(moved.start, moved.end);
          updateCursor(target);
          return;
        }
        sessionRef.current = null;
      } else if (
        [
          "Escape",
          "Enter",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)
      ) {
        sessionRef.current = null;
        if (event.key === "Escape") {
          event.preventDefault();
          return;
        }
      }
    }
    const state: EditState = {
      value: target.value,
      start: target.selectionStart,
      end: target.selectionEnd,
    };
    // 키를 처리하기 전에 기억한 Tab 단위를 지금 글에 맞춘다.
    syncUnits(target.value);
    /** 편집을 적용하고, 기억한 단위를 옮긴 뒤 이번 편집으로 새로 들어간 단위를 더한다. */
    const run = (next: EditResult) => {
      applyEdit(target, next);
      syncUnits(next.value, next.units);
    };
    if (modifier && event.key === "/") {
      event.preventDefault();
      applyEdit(target, toggleComment(state, language));
    } else if (event.key === "Tab" && !modifier && !event.altKey) {
      event.preventDefault();
      run(handleTab(state, event.shiftKey));
    } else if (event.key === "Enter" && !modifier && !event.shiftKey) {
      event.preventDefault();
      run(handleEnter(state, language, unitsRef.current));
    } else if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !modifier &&
      !event.altKey
    ) {
      // Tab으로 넣은 들여쓰기 한 단계는 한 번에 지우고, 직접 친 공백은 기본 동작(한 글자씩)을 따른다.
      const unitEdit =
        event.key === "Backspace"
          ? backspaceUnit(state, unitsRef.current)
          : deleteUnit(state, unitsRef.current);
      const next =
        unitEdit ?? (event.key === "Backspace" ? handleBackspace(state) : null);
      if (next) {
        event.preventDefault();
        run(next);
      }
    } else if (event.key.length === 1 && !modifier && !event.altKey) {
      const next = handleCharacter(state, event.key);
      if (next) {
        event.preventDefault();
        applyEdit(target, next);
      }
    }
  }

  return (
    <div className="solve-page">
      <div className="solve-heading">
        <h1>{problem.title}</h1>
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
              aria-selected={tab === "statement"}
              className={`tab-button ${tab === "statement" ? "active" : ""}`}
              onClick={() => setTab("statement")}
            >
              문제 설명
            </button>
            <button
              role="tab"
              aria-selected={tab === "history"}
              className={`tab-button ${tab === "history" ? "active" : ""}`}
              onClick={() => setTab("history")}
            >
              제출 내역
            </button>
          </div>
          {tab === "statement" ? (
            <article className="problem-content">
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
            <div className="history-panel">
              {!session ? (
                <p className="muted">
                  로그인하면 이 문제의 제출 내역이 여기에 표시됩니다.
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
                          {item.language} ·{" "}
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
              {savedAt
                ? `초안 저장됨 · ${savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
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
                sessionRef.current = null;
                setPopup(null);
                // 처음 상태로 돌아가므로 기억한 Tab 단위도 비운다.
                unitsRef.current = [];
                unitsBaseRef.current = starter(language);
                setSource(starter(language));
                try {
                  localStorage.removeItem(draftKey(problem.id, language));
                } catch {
                  /* 저장소를 쓸 수 없어도 초기화는 진행한다 */
                }
                setSavedAt(null);
              }}
            >
              초기화
            </button>
          </div>
          <form onSubmit={submit} className="code-form">
            <div
              className="editor-frame"
              style={
                { "--editor-font": `${fontSize}px` } as React.CSSProperties
              }
            >
              <div className="line-numbers" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <textarea
                ref={editorRef}
                className="code-editor"
                aria-label={`${selectedLanguage?.label ?? ""} 소스 코드`}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                wrap="off"
                value={source}
                aria-autocomplete={popup ? "list" : undefined}
                aria-controls={popup ? "editor-suggestions" : undefined}
                aria-activedescendant={
                  popup ? `suggestion-${popup.index}` : undefined
                }
                onChange={(event) => {
                  const target = event.currentTarget;
                  const native = event.nativeEvent as InputEvent;
                  // 한글 등 조합 중에는 값만 저장하고, 칸 보정·제안은 조합이 끝난 뒤에 한다.
                  if (native.isComposing) {
                    updateSource(target.value);
                    updateCursor(target);
                    return;
                  }
                  // 스니펫 칸 안에서 고친 글을 같은 번호의 다른 칸(미러)에도 반영한다.
                  if (sessionRef.current && !syncingRef.current) {
                    const synced = reconcileSession(
                      sessionRef.current,
                      lastValueRef.current,
                      target.value,
                      target.selectionStart,
                    );
                    sessionRef.current = synced.session;
                    if (synced.session && synced.value !== target.value) {
                      syncingRef.current = true;
                      applyEdit(target, {
                        value: synced.value,
                        start: synced.caret,
                        end: synced.caret,
                      });
                      syncingRef.current = false;
                    }
                  }
                  updateSource(target.value);
                  updateCursor(target);
                  if (suppressSuggest.current) {
                    suppressSuggest.current = false;
                  } else if (syncingRef.current || sessionRef.current) {
                    setPopup(null);
                  } else if (
                    // 붙여넣기·실행 취소·끌어다 놓기로 바뀐 글에는 띄우지 않고,
                    // 지우는 중에는 이미 떠 있을 때만 갱신한다(VS Code와 같다).
                    !/^(?:history|insertFromPaste|insertFromDrop)/.test(
                      native.inputType ?? "",
                    ) &&
                    (!native.inputType?.startsWith("delete") || popup)
                  ) {
                    refreshSuggest(target);
                  } else setPopup(null);
                }}
                onMouseDown={() => {
                  sessionRef.current = null;
                }}
                onSelect={(event) => {
                  updateCursor(event.currentTarget);
                  // 커서나 선택 범위가 바뀌면 이전 위치의 제안을 닫는다.
                  const target = event.currentTarget;
                  const { selectionStart, selectionEnd } = target;
                  setPopup((current) =>
                    current &&
                    (current.caret !== selectionStart ||
                      selectionStart !== selectionEnd)
                      ? null
                      : current,
                  );
                }}
                onBlur={() => setPopup(null)}
                onKeyDown={onEditorKeyDown}
                required
              />
              {popup ? (
                <div
                  className="autocomplete"
                  style={{ left: popup.left, top: popup.top }}
                >
                  <ul
                    ref={listRef}
                    id="editor-suggestions"
                    role="listbox"
                    aria-label="자동완성 제안"
                  >
                    {popup.items.map((item, index) => (
                      <li
                        key={`${item.kind}-${item.label}`}
                        id={`suggestion-${index}`}
                        role="option"
                        aria-selected={index === popup.index}
                        className={index === popup.index ? "active" : ""}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          acceptSuggestion(index);
                        }}
                      >
                        <span
                          className={`suggestion-icon kind-${item.kind}`}
                          aria-hidden="true"
                        >
                          {kindGlyph[item.kind]}
                        </span>
                        <span className="suggestion-label">
                          {Array.from(item.label).map((char, at) => (
                            <span
                              key={at}
                              className={
                                item.matches?.includes(at)
                                  ? "suggestion-hit"
                                  : undefined
                              }
                            >
                              {char}
                            </span>
                          ))}
                        </span>
                        <span className="suggestion-detail">
                          {item.detail ?? kindName[item.kind]}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="suggestion-doc" aria-hidden="true">
                    {popup.items[popup.index].doc ??
                      kindName[popup.items[popup.index].kind]}
                  </p>
                </div>
              ) : null}
            </div>
            {submissionId ? (
              <section
                ref={panelRef}
                className="judge-panel"
                aria-label="채점 결과"
                style={panelOpen ? { height: panelHeight } : undefined}
              >
                {panelOpen ? (
                  <div
                    className="judge-resizer"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="채점 결과 높이 조절"
                    aria-valuemin={PANEL_MIN}
                    aria-valuenow={panelHeight}
                    tabIndex={0}
                    title="위아래로 끌어 높이를 조절해요 (↑↓ 키도 가능)"
                    onPointerDown={startPanelResize}
                    onKeyDown={resizePanelByKey}
                  />
                ) : null}
                <div className="judge-panel-head">
                  <strong>채점 결과</strong>
                  {result ? (
                    <span
                      role="status"
                      className={`verdict verdict-${result.status.toLowerCase()}`}
                    >
                      {verdictLabel(result.status)}
                    </span>
                  ) : null}
                  <span className="judge-panel-actions">
                    {result ? (
                      <Link
                        className="text-button"
                        to={`/submissions/${result.id}`}
                      >
                        자세히 보기
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="text-button"
                      aria-expanded={panelOpen}
                      onClick={() => setPanelOpen((open) => !open)}
                    >
                      {panelOpen ? "접기" : "펼치기"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setSubmissionId(null)}
                    >
                      닫기
                    </button>
                  </span>
                </div>
                {panelOpen ? (
                  <div className="judge-panel-body">
                    {resultError ? (
                      <p className="error-message" role="alert">
                        {resultError}
                      </p>
                    ) : !result ? (
                      <p className="muted">채점을 시작하고 있어요…</p>
                    ) : (
                      <>
                        {isJudging(result) ? (
                          <p className="muted">
                            채점 중이에요. 끝나면 이 자리에 결과가 나타납니다.
                          </p>
                        ) : null}
                        <ResultSummary submission={result} />
                        <ResultNotices submission={result} />
                        <CaseResults submission={result} />
                      </>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}
            {submitError ? (
              <p className="error-message" role="alert">
                {submitError}
              </p>
            ) : null}
            <p className="editor-hints">
              Tab 들여쓰기 · Shift+Tab 내어쓰기 · <kbd>Ctrl/⌘ + /</kbd> 주석 ·
              괄호·따옴표 자동 완성 · <kbd>Ctrl + Space</kbd> 제안 · ↑↓ 선택,
              Enter/Tab 적용, 스니펫은 Tab으로 다음 칸
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
