import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDocumentTitle } from "../hooks";
import { Select } from "../components/Select";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  applySuggestion,
  suggest,
  type Suggestion,
} from "../editor/autocomplete";
import {
  applyToTextarea,
  cursorPosition,
  handleBackspace,
  handleCharacter,
  handleEnter,
  handleTab,
  toggleComment,
  type EditState,
} from "../editor/codeEditing";
import type { Language, Page, Problem, Submission } from "../types";
import { problemPath } from "../paths";
import { difficultyLabel } from "./ProblemsPage";

const languages: { value: Language; label: string; starter: string }[] = [
  {
    value: "PYTHON",
    label: "Python 3",
    starter:
      'import sys\n\ndef solve():\n    data = sys.stdin.read().split()\n    # 여기에 코드를 작성하세요.\n\nif __name__ == "__main__":\n    solve()\n',
  },
  {
    value: "CPP",
    label: "C++ 20",
    starter:
      "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    return 0;\n}\n",
  },
  {
    value: "C",
    label: "C 17",
    starter: "#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n",
  },
  {
    value: "JAVA",
    label: "Java 21",
    starter:
      "public class Main {\n    public static void main(String[] args) {\n    }\n}\n",
  },
  {
    value: "JAVASCRIPT",
    label: "JavaScript",
    starter:
      'const fs = require("fs");\nconst input = fs.readFileSync(0, "utf8").trim();\n',
  },
  {
    value: "TYPESCRIPT",
    label: "TypeScript",
    starter:
      'import * as fs from "fs";\nconst input = fs.readFileSync(0, "utf8").trim();\n',
  },
  {
    value: "GO",
    label: "Go",
    starter:
      'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println()\n}\n',
  },
  {
    value: "RUST",
    label: "Rust",
    starter:
      "use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n",
  },
];

type Tab = "statement" | "history";

const fontKey = "unsolvable-oj-editor-font-v1";
const FONT_MIN = 11;
const FONT_MAX = 20;

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
  const [tab, setTab] = useState<Tab>("statement");
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  // 자동완성 제안 목록(커서 아래에 표시)
  const [popup, setPopup] = useState<{
    items: Suggestion[];
    index: number;
    left: number;
    top: number;
  } | null>(null);
  const suppressSuggest = useRef(false);
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
  const navigate = useNavigate();

  const starter = (value: Language) =>
    languages.find((item) => item.value === value)?.starter ?? "";

  // 문제가 바뀌거나 불러와지면 저장된 초안을 복원한다.
  useEffect(() => {
    if (!problem) return;
    const draft = readDraft(problem.id, language);
    setSource(draft ?? starter(language));
    setSavedAt(draft ? new Date() : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id, language]);

  // 입력 후 잠시 멈추면 초안을 자동 저장한다.
  useEffect(() => {
    if (!problem || source === starter(language)) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(problem.id, language), source);
        setSavedAt(new Date());
      } catch {
        setSavedAt(null);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, problem?.id, language]);

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
  }, [tab, session, problem]);

  useEffect(() => {
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
    if (!problem || !session) return;
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
      navigate(`/submissions/${submitted.id}`);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : "제출하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <div className="page-width empty-state">문제를 불러오는 중입니다…</div>
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
  function updateCursor(target: HTMLTextAreaElement) {
    setCursor(cursorPosition(target.value, target.selectionStart));
  }

  /** 계산한 편집 결과를 입력창에 적용한다(실행 취소가 유지되도록 브라우저 편집 명령을 우선 쓴다). */
  function applyEdit(target: HTMLTextAreaElement, next: EditState) {
    if (!applyToTextarea(target, next)) {
      setSource(next.value);
      requestAnimationFrame(() =>
        target.setSelectionRange(next.start, next.end),
      );
    }
    updateCursor(target);
  }

  /** 입력 중인 단어에 맞는 제안을 계산해 커서 바로 아래에 띄운다. */
  function refreshSuggest(target: HTMLTextAreaElement) {
    if (target.selectionStart !== target.selectionEnd) return setPopup(null);
    const items = suggest(target.value, target.selectionStart, language);
    if (!items.length) return setPopup(null);
    const { line, column } = cursorPosition(
      target.value,
      target.selectionStart,
    );
    const typed = /[A-Za-z_][A-Za-z0-9_]*$/.exec(
      target.value.slice(0, target.selectionStart),
    )![0].length;
    // 고정폭 글꼴이라 줄·열로 위치를 계산한다(글자 폭 0.6em, 줄 높이 1.6em).
    const frame = target.parentElement;
    const maxLeft = Math.max(0, (frame?.clientWidth ?? 600) - 280);
    setPopup({
      items,
      index: 0,
      left: Math.min(
        maxLeft,
        target.offsetLeft + (column - 1 - typed) * fontSize * 0.6,
      ),
      top: target.offsetTop + 16 + line * fontSize * 1.6 + 4,
    });
  }

  function acceptSuggestion(index: number) {
    const target = editorRef.current;
    const item = popup?.items[index];
    if (!target || !item) return;
    const next = applySuggestion(target.value, target.selectionStart, item);
    suppressSuggest.current = true; // 적용 직후에는 다시 띄우지 않는다
    setPopup(null);
    applyEdit(target, next);
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
    if (event.nativeEvent.isComposing) return;
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
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !modifier &&
        !event.shiftKey
      ) {
        event.preventDefault();
        acceptSuggestion(popup.index);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPopup(null);
        return;
      }
    }
    const state: EditState = {
      value: target.value,
      start: target.selectionStart,
      end: target.selectionEnd,
    };
    if (modifier && event.key === "/") {
      event.preventDefault();
      applyEdit(target, toggleComment(state, language));
    } else if (event.key === "Tab" && !modifier && !event.altKey) {
      event.preventDefault();
      applyEdit(target, handleTab(state, event.shiftKey));
    } else if (event.key === "Enter" && !modifier && !event.shiftKey) {
      event.preventDefault();
      applyEdit(target, handleEnter(state, language));
    } else if (event.key === "Backspace" && !modifier && !event.altKey) {
      const next = handleBackspace(state);
      if (next) {
        event.preventDefault();
        applyEdit(target, next);
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
        <nav className="breadcrumb" aria-label="현재 위치">
          <Link to="/problems">문제 목록</Link>
          <span aria-hidden="true">/</span>
          <span>{problem.slug}</span>
        </nav>
        <h1>{problem.title}</h1>
        <span
          className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
        >
          {difficultyLabel(problem.difficulty)}
        </span>
      </div>
      <div className="solve-grid">
        <section className="solve-panel statement-panel">
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
                <p className="muted">제출 내역을 불러오는 중입니다…</p>
              ) : history.length ? (
                <ul className="history-list">
                  {history.map((item) => (
                    <li key={item.id}>
                      <Link to={`/submissions/${item.id}`}>
                        <span
                          className={`verdict verdict-${item.status.toLowerCase()}`}
                        >
                          {item.status.replaceAll("_", " ")}
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

        <section className="solve-panel code-panel" aria-label="코드 작성">
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
              className="text-button light"
              onClick={() => {
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
                aria-autocomplete="list"
                aria-controls={popup ? "editor-suggestions" : undefined}
                aria-activedescendant={
                  popup ? `suggestion-${popup.index}` : undefined
                }
                onChange={(event) => {
                  setSource(event.target.value);
                  updateCursor(event.currentTarget);
                  if (suppressSuggest.current) suppressSuggest.current = false;
                  else refreshSuggest(event.currentTarget);
                }}
                onSelect={(event) => {
                  updateCursor(event.currentTarget);
                  // 커서가 단어에서 벗어나면 제안을 닫는다.
                  const target = event.currentTarget;
                  if (
                    popup &&
                    !suggest(target.value, target.selectionStart, language)
                      .length
                  )
                    setPopup(null);
                }}
                onBlur={() => setPopup(null)}
                onKeyDown={onEditorKeyDown}
                required
              />
              {popup ? (
                <ul
                  className="autocomplete"
                  id="editor-suggestions"
                  role="listbox"
                  aria-label="자동완성 제안"
                  style={{ left: popup.left, top: popup.top }}
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
                      <span className="suggestion-label">{item.label}</span>
                      <span className="suggestion-detail">
                        {item.detail ??
                          (item.kind === "keyword" ? "키워드" : "")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {submitError ? (
              <p className="error-message" role="alert">
                {submitError}
              </p>
            ) : null}
            <p className="editor-hints">
              Tab 들여쓰기 · Shift+Tab 내어쓰기 · <kbd>Ctrl/⌘ + /</kbd> 주석 ·
              괄호·따옴표 자동 완성 · 제안 ↑↓ 선택, Enter/Tab 적용, Esc 닫기
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
