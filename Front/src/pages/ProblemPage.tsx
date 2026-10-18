import { useEffect, useState, type FormEvent } from "react";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Language, Problem, Submission } from "../types";
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

export function ProblemPage() {
  const { slug } = useParams();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<Language>("PYTHON");
  const [source, setSource] = useState(languages[0].starter);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { session } = useAuth();
  const navigate = useNavigate();

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
      <div className="page-width empty-state">
        <p className="error-message">{error || "문제를 찾을 수 없습니다."}</p>
        <Link to="/problems">문제 목록으로</Link>
      </div>
    );

  return (
    <div className="page-width detail-page">
      <Link className="back-link" to="/problems">
        ← 문제 목록
      </Link>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">
            PROBLEM / {problem.slug.toUpperCase()}
          </span>
          <h1>{problem.title}</h1>
        </div>
        <span
          className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
        >
          {difficultyLabel(problem.difficulty)}
        </span>
      </div>
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
      <div className="detail-grid">
        <article className="problem-content">
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
                <ProblemMarkdown>{problem.inputDescriptionMarkdown}</ProblemMarkdown>
              </div>
            </section>
          ) : null}
          {problem.outputDescriptionMarkdown ? (
            <section>
              <h2>출력</h2>
              <div className="markdown">
                <ProblemMarkdown>{problem.outputDescriptionMarkdown}</ProblemMarkdown>
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
        <aside className="editor-panel">
          <div className="editor-heading">
            <span className="eyebrow">YOUR SOLUTION</span>
            <h2>코드 제출</h2>
          </div>
          {session ? (
            <form onSubmit={submit} className="form-stack">
              <label>
                언어
                <select
                  value={language}
                  onChange={(event) => {
                    const selected = event.target.value as Language;
                    setLanguage(selected);
                    setSource(
                      languages.find((item) => item.value === selected)
                        ?.starter ?? "",
                    );
                  }}
                >
                  {languages.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                소스 코드
                <textarea
                  className="code-editor"
                  spellCheck={false}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  required
                />
              </label>
              {submitError ? (
                <p className="error-message" role="alert">
                  {submitError}
                </p>
              ) : null}
              <button
                className="button button-full"
                disabled={submitting || !source.trim()}
              >
                {submitting ? "제출 중…" : "제출하고 채점하기 →"}
              </button>
            </form>
          ) : (
            <div className="sign-in-prompt">
              <p>코드를 제출하려면 로그인해 주세요.</p>
              <Link
                className="button button-full"
                to="/auth"
                state={{ from: `/problems/view/${encodeURIComponent(problem.slug)}` }}
              >
                로그인하고 풀기
              </Link>
            </div>
          )}
          <p className="editor-note">
            제출 후 판정 페이지에서 결과를 확인할 수 있습니다.
          </p>
        </aside>
      </div>
    </div>
  );
}
