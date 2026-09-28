import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Difficulty, Problem } from "../types";

interface TestCaseInput {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  score: number;
}
const blankCase = (): TestCaseInput => ({
  input: "",
  expectedOutput: "",
  isSample: true,
  score: 1,
});

export function CreateProblemPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [statementMarkdown, setStatement] = useState("");
  const [inputDescriptionMarkdown, setInputDescription] = useState("");
  const [outputDescriptionMarkdown, setOutputDescription] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("BEGINNER");
  const [timeLimitMs, setTimeLimit] = useState(1000);
  const [memoryLimitMb, setMemoryLimit] = useState(256);
  const [testCases, setTestCases] = useState<TestCaseInput[]>([blankCase()]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function updateCase(index: number, patch: Partial<TestCaseInput>) {
    setTestCases((previous) =>
      previous.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setPending(true);
    setError("");
    try {
      const problem = await api<Problem>(
        "/problems",
        {
          method: "POST",
          body: JSON.stringify({
            slug,
            title,
            statementMarkdown,
            inputDescriptionMarkdown,
            outputDescriptionMarkdown,
            difficulty,
            status: "PUBLISHED",
            timeLimitMs,
            memoryLimitMb,
            testCases,
          }),
        },
        session.accessToken,
      );
      navigate(`/problems/${problem.slug}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "문제를 만들지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-width create-page">
      <Link className="back-link" to="/problems">
        ← 문제 목록
      </Link>
      <span className="eyebrow">AUTHOR WORKSPACE</span>
      <h1>새 문제 만들기</h1>
      <p className="muted">
        저장하면 문제가 바로 공개됩니다. 예제만 문제 페이지에 표시되고, 나머지
        테스트케이스는 채점에만 사용됩니다.
      </p>
      <form onSubmit={submit} className="create-form">
        <div className="form-card">
          <h2>기본 정보</h2>
          <div className="form-grid">
            <label>
              제목
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={150}
                required
              />
            </label>
            <label>
              주소용 slug
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="a-plus-b"
                minLength={3}
                maxLength={80}
                required
              />
            </label>
            <label>
              난이도
              <select
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as Difficulty)
                }
              >
                <option value="BEGINNER">입문</option>
                <option value="EASY">쉬움</option>
                <option value="MEDIUM">보통</option>
                <option value="HARD">어려움</option>
                <option value="EXPERT">전문가</option>
              </select>
            </label>
            <label>
              시간 제한 (ms)
              <input
                type="number"
                min={100}
                max={60000}
                value={timeLimitMs}
                onChange={(event) => setTimeLimit(Number(event.target.value))}
                required
              />
            </label>
            <label>
              메모리 제한 (MB)
              <input
                type="number"
                min={16}
                max={4096}
                value={memoryLimitMb}
                onChange={(event) => setMemoryLimit(Number(event.target.value))}
                required
              />
            </label>
          </div>
        </div>
        <div className="form-card">
          <h2>문제 설명</h2>
          <div className="form-stack">
            <label>
              문제 본문 (Markdown)
              <textarea
                rows={8}
                value={statementMarkdown}
                onChange={(event) => setStatement(event.target.value)}
                required
              />
            </label>
            <label>
              입력 설명
              <textarea
                rows={4}
                value={inputDescriptionMarkdown}
                onChange={(event) => setInputDescription(event.target.value)}
              />
            </label>
            <label>
              출력 설명
              <textarea
                rows={4}
                value={outputDescriptionMarkdown}
                onChange={(event) => setOutputDescription(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="form-card">
          <div className="section-heading">
            <div>
              <h2>테스트케이스</h2>
              <p>최소 하나가 필요합니다.</p>
            </div>
            <button
              type="button"
              className="button button-outline"
              onClick={() =>
                setTestCases((previous) => [...previous, blankCase()])
              }
            >
              + 추가
            </button>
          </div>
          {testCases.map((testCase, index) => (
            <div className="case-editor" key={index}>
              <div className="case-heading">
                <strong>테스트 {index + 1}</strong>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={testCase.isSample}
                    onChange={(event) =>
                      updateCase(index, { isSample: event.target.checked })
                    }
                  />{" "}
                  예제로 공개
                </label>
                {testCases.length > 1 ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setTestCases((previous) =>
                        previous.filter((_, position) => position !== index),
                      )
                    }
                  >
                    삭제
                  </button>
                ) : null}
              </div>
              <div className="sample-grid">
                <label>
                  입력
                  <textarea
                    rows={4}
                    value={testCase.input}
                    onChange={(event) =>
                      updateCase(index, { input: event.target.value })
                    }
                  />
                </label>
                <label>
                  기대 출력
                  <textarea
                    rows={4}
                    value={testCase.expectedOutput}
                    onChange={(event) =>
                      updateCase(index, { expectedOutput: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button" disabled={pending}>
          {pending ? "게시 중…" : "문제 게시하기 →"}
        </button>
      </form>
    </div>
  );
}
