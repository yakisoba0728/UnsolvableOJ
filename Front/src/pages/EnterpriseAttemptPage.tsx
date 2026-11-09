import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { CodeEditor, type CodeEditorHandle } from "../components/CodeEditor";
import { isJudging, useSubmissionResult } from "../components/JudgeResult";
import { PageHeader } from "../components/PageHeader";
import { ProblemMarkdown } from "../components/ProblemMarkdown";
import { Select } from "../components/Select";
import { difficultyLabel } from "../difficulty";
import { addUnits, remapUnits } from "../editor/codeEditing";
import { languages, starter } from "../editor/languages";
import { remainingText, type AttemptView } from "../enterprise/model";
import { useDocumentTitle, useNow, useRequest } from "../hooks";
import type { Language, Submission } from "../types";
import { verdictLabel } from "../verdict";

const draftKey = (attemptId: string, problemId: string, language: Language) =>
  `unsolvable-oj-attempt:${attemptId}:${problemId}:${language}`;

// 새로고침해도 시험 중 작성한 코드를 잃지 않게 이 브라우저에 둔다(서버 기록은 제출뿐).
function readDraft(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 공간이 없어도 화면의 코드는 그대로 둔다.
  }
}

/** 기업 테스트 응시 화면: 남은 시간, 문제 이동, 문제별 코드 작성·제출과 결과. */
export function EnterpriseAttemptPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const token = session?.accessToken;
  // 본문·편집기를 매초 다시 그리지 않도록 초 단위 표시는 AttemptTimer가 맡는다.
  const now = useNow(5_000);
  const { data, loading, error, retry } = useRequest<AttemptView | null>(
    token ? (signal) => api(`/enterprise/attempts/${id}`, { signal }, token) : null,
    null,
    "응시 정보를 불러오지 못했어요.",
    [token, id],
  );
  useDocumentTitle(data?.test.title ?? "코드 테스트");
  const [index, setIndex] = useState(0);
  const [language, setLanguage] = useState<Language>("PYTHON");
  const [sources, setSources] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [finishing, setFinishing] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const unitsRef = useRef<number[]>([]);
  const unitsBaseRef = useRef("");

  const problem = data?.problems[index];
  const key = problem ? draftKey(id, problem.id, language) : "";
  const source = problem ? (sources[key] ?? readDraft(key) ?? starter(language)) : "";
  const submissionId = problem ? (submitted[problem.id] ?? problem.lastSubmissionId) : null;
  const result = useSubmissionResult(submissionId, session);
  const judging = result.submission ? isJudging(result.submission) : false;

  // 채점이 끝나면 문제별 정답 표시를 서버 기준으로 다시 받는다.
  const lastStatus = result.submission?.status;
  useEffect(() => {
    if (lastStatus && !judging) retry();
  }, [lastStatus, judging, retry]);

  // 화면을 연 채로 마감되면 한 번 다시 받아, 공개된 점수가 있으면 바로 보여 준다.
  const expired = data ? Date.parse(data.deadlineAt) <= now : null;
  const sawOpen = useRef(false);
  useEffect(() => {
    if (expired === false) sawOpen.current = true;
    else if (expired && sawOpen.current) {
      sawOpen.current = false;
      retry();
    }
  }, [expired, retry]);

  if (!session)
    return (
      <div className="page-width enterprise-page">
        <PageHeader title="코드 테스트" />
        <div className="empty-state ent-empty">
          <strong>로그인해야 응시 화면을 볼 수 있어요</strong>
          <Link className="button" to="/auth" state={{ from: `/enterprise/attempts/${id}` }}>
            로그인하기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="page-width enterprise-page">
        <PageHeader title="코드 테스트" />
        <div className="empty-state ent-empty">
          {loading ? (
            <p role="status">응시 화면을 불러오는 중…</p>
          ) : (
            <>
              <strong role="alert">{error || "응시 정보를 불러오지 못했어요."}</strong>
              <button className="button" onClick={retry}>
                다시 시도
              </button>
            </>
          )}
        </div>
      </div>
    );

  const remaining = Date.parse(data.deadlineAt) - now;
  const closed = Boolean(data.finishedAt) || remaining <= 0;
  const solved = data.problems.filter((item) => item.solved).length;

  function syncUnits(value: string, added: readonly number[] = []) {
    unitsRef.current = addUnits(remapUnits(unitsRef.current, unitsBaseRef.current, value), added, value);
    unitsBaseRef.current = value;
    return unitsRef.current;
  }

  function change(value: string) {
    setSources((current) => ({ ...current, [key]: value }));
    writeDraft(key, value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!problem || submitting || closed || !source.trim()) return;
    setSubmitting(true);
    setMessage("");
    try {
      const created = await api<Submission>(
        `/enterprise/attempts/${id}/problems/${problem.id}/submissions`,
        { method: "POST", body: JSON.stringify({ language, sourceCode: source }) },
        token,
      );
      setSubmitted((current) => ({ ...current, [problem.id]: created.id }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "제출하지 못했어요.");
      // 시간이 끝났다는 거절이면 화면도 마감 상태로 맞춘다.
      retry();
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    if (finishing || !window.confirm("시험을 종료할까요? 종료하면 더 제출할 수 없어요.")) return;
    setFinishing(true);
    try {
      await api(`/enterprise/attempts/${id}/finish`, { method: "POST" }, token);
      retry();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "시험을 종료하지 못했어요.");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="page-width enterprise-page ent-attempt">
      <PageHeader
        title={data.test.title}
        description={`${data.problems.length}문항 · 맞힌 문제 ${solved}개`}
        aside={
          <div className="ent-actions">
            <AttemptTimer deadlineAt={data.deadlineAt} finished={Boolean(data.finishedAt)} />
            {closed ? null : (
              <button className="button button-outline" onClick={() => void finish()} disabled={finishing}>
                시험 종료
              </button>
            )}
          </div>
        }
      />
      {data.result ? (
        <section className="form-card ent-card ent-result-card" aria-labelledby="ent-my-result">
          <h2 id="ent-my-result">내 결과</h2>
          <p>
            <strong>{data.result.score}점</strong>{" "}
            <span className="muted">
              ({data.result.total}문제 중 {data.result.solved}문제 정답)
            </span>
          </p>
          <ul>
            {data.problems.map((item, position) => (
              <li key={item.id}>
                {position + 1}. {item.title} —{" "}
                <span className={item.solved ? "verdict-good" : "verdict-bad"}>
                  {item.solved ? "정답" : item.lastSubmissionId ? "미해결" : "미제출"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : closed ? (
        <p className="local-storage-notice" role="status">
          응시가 끝났어요. 제출한 코드와 결과는 아래에서 볼 수 있고, 점수는 테스트를 만든 담당자에게 전달돼요.
        </p>
      ) : null}
      {message ? (
        <p className="error-message" role="alert">
          {message}
        </p>
      ) : null}

      <nav className="tab-list ent-attempt-tabs" aria-label="문제 목록">
        {data.problems.map((item, position) => (
          <button
            key={item.id}
            type="button"
            className="tab-button"
            aria-current={position === index ? "true" : undefined}
            onClick={() => setIndex(position)}
          >
            {position + 1}. {item.title}
            {item.solved ? <span className="ent-solved"> ✓<span className="sr-only"> 정답</span></span> : null}
          </button>
        ))}
      </nav>

      {problem ? (
        <div className="ent-attempt-grid">
          <article className="problem-content form-card" aria-label={`${index + 1}번 문제`}>
            <h2>
              {index + 1}. {problem.title}
            </h2>
            <p className="muted">
              {difficultyLabel(problem.difficulty)} · 시간 제한 {problem.timeLimitMs}ms · 메모리 제한{" "}
              {problem.memoryLimitMb}MB
            </p>
            <section>
              <h3>문제</h3>
              <div className="markdown">
                <ProblemMarkdown>{problem.statementMarkdown}</ProblemMarkdown>
              </div>
            </section>
            {problem.inputDescriptionMarkdown ? (
              <section>
                <h3>입력</h3>
                <div className="markdown">
                  <ProblemMarkdown>{problem.inputDescriptionMarkdown}</ProblemMarkdown>
                </div>
              </section>
            ) : null}
            {problem.outputDescriptionMarkdown ? (
              <section>
                <h3>출력</h3>
                <div className="markdown">
                  <ProblemMarkdown>{problem.outputDescriptionMarkdown}</ProblemMarkdown>
                </div>
              </section>
            ) : null}
            {problem.samples.map((sample, position) => (
              <section key={position}>
                <h3>예제 {position + 1}</h3>
                <div className="sample-grid">
                  <div>
                    <h4>입력</h4>
                    <pre>{sample.input}</pre>
                  </div>
                  <div>
                    <h4>출력</h4>
                    <pre>{sample.expectedOutput}</pre>
                  </div>
                </div>
              </section>
            ))}
          </article>

          <form className="form-card ent-attempt-editor" onSubmit={submit}>
            <div className="ent-pick-head">
              <Select
                className="language-select"
                ariaLabel="언어"
                value={language}
                options={languages.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(next) => setLanguage(next as Language)}
              />
              <button className="button" type="submit" disabled={closed || submitting || !source.trim()}>
                {submitting ? "제출하는 중…" : "제출"}
              </button>
            </div>
            <CodeEditor
              ref={editorRef}
              language={language}
              value={source}
              fontSize={14}
              onChange={change}
              onCursorChange={() => {}}
              syncUnits={syncUnits}
            />
            <p className="ent-verdict" role="status">
              {!submissionId
                ? "아직 이 문제에 제출하지 않았어요."
                : result.submission
                  ? judging
                    ? "채점 중…"
                    : `최근 제출: ${verdictLabel(result.submission.status)}${
                        result.submission.status === "ACCEPTED"
                          ? ""
                          : ` (${result.submission.passedTestCases}/${result.submission.totalTestCases} 통과)`
                      }`
                  : result.error || "결과를 불러오는 중…"}
            </p>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function AttemptTimer({ deadlineAt, finished }: { deadlineAt: string; finished: boolean }) {
  const now = useNow(1_000);
  const remaining = Date.parse(deadlineAt) - now;
  const closed = finished || remaining <= 0;
  return (
    <p className={`ent-timer${!closed && remaining < 5 * 60_000 ? " ent-timer-low" : ""}`} role="timer" aria-live="off">
      {closed ? "응시 종료" : `남은 시간 ${remainingText(remaining)}`}
    </p>
  );
}
