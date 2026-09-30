import { useEffect, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Language, Page, Problem, Submission } from "../types";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<Language>("PYTHON");
  const [source, setSource] = useState(languages[0].starter);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [tab, setTab] = useState<Tab>("statement");
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
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
    void api<Problem>(`/problems/${encodeURIComponent(slug ?? "")}`, {
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
      <div className="page-width empty-state">
        <p className="error-message">{error || "문제를 찾을 수 없습니다."}</p>
        <Link to="/problems">문제 목록으로</Link>
      </div>
    );

  const selectedLanguage = languages.find((item) => item.value === language);
  const lineCount = source.split("\n").length;

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
                  <Markdown>{problem.statementMarkdown}</Markdown>
                </div>
              </section>
              {problem.inputDescriptionMarkdown ? (
                <section>
                  <h2>입력</h2>
                  <div className="markdown">
                    <Markdown>{problem.inputDescriptionMarkdown}</Markdown>
                  </div>
                </section>
              ) : null}
              {problem.outputDescriptionMarkdown ? (
                <section>
                  <h2>출력</h2>
                  <div className="markdown">
                    <Markdown>{problem.outputDescriptionMarkdown}</Markdown>
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
            <label className="language-select">
              <span className="sr-only">언어</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
              >
                {languages.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="save-state" role="status">
              {savedAt
                ? `초안 저장됨 · ${savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                : "자동 저장 대기"}
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
            <div className="editor-frame">
              <div className="line-numbers" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <textarea
                className="code-editor"
                aria-label={`${selectedLanguage?.label ?? ""} 소스 코드`}
                spellCheck={false}
                wrap="off"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                onKeyDown={(event) => {
                  // Ctrl/⌘ + Enter 로 바로 제출 (LeetCode·HackerRank 방식)
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                    return;
                  }
                  if (event.key !== "Tab") return;
                  event.preventDefault();
                  const target = event.currentTarget;
                  const { selectionStart, selectionEnd } = target;
                  setSource(
                    `${source.slice(0, selectionStart)}    ${source.slice(selectionEnd)}`,
                  );
                  requestAnimationFrame(() =>
                    target.setSelectionRange(
                      selectionStart + 4,
                      selectionStart + 4,
                    ),
                  );
                }}
                required
              />
            </div>
            {submitError ? (
              <p className="error-message" role="alert">
                {submitError}
              </p>
            ) : null}
            <div className="code-actions">
              {session ? (
                <>
                  <span className="editor-note">
                    제출하면 전체 테스트 케이스로 채점합니다 ·{" "}
                    <kbd>Ctrl/⌘ + Enter</kbd>
                  </span>
                  <button
                    className="button"
                    disabled={submitting || !source.trim()}
                  >
                    {submitting ? "제출 중…" : "제출 및 채점"}
                  </button>
                </>
              ) : (
                <>
                  <span className="editor-note">
                    코드를 제출하려면 로그인해 주세요. 작성 중인 코드는
                    이 브라우저에 저장됩니다.
                  </span>
                  <Link
                    className="button"
                    to="/auth"
                    state={{ from: `/problems/${problem.slug}` }}
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
