import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Check,
  ChevronRight,
  FileCode2,
  GitCompareArrows,
  Play,
  Save,
  Send,
  Undo2,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useDocumentTitle, useNow } from "../hooks";
import { useUnsavedChanges } from "../useUnsavedChanges";
import { CodeEditor, type CodeEditorHandle } from "../components/CodeEditor";
import { addUnits, remapUnits } from "../editor/codeEditing";
import { SkeletonRows } from "../components/Skeleton";
import type {
  ProjectFiles,
  VibeAttempt,
  VibeCheck,
  VibeMessage,
} from "../vibe/types";
import "../vibe.css";

const eventLabels = {
  save: "파일 저장",
  apply: "제안한 변경 적용",
  undo: "변경 되돌리기",
  run: "공개 테스트 실행",
  submit: "최종 제출",
};
const editedFiles = (attempt: VibeAttempt, files: ProjectFiles) =>
  Object.fromEntries(attempt.editablePaths.map((path) => [path, files[path]]));
const same = (a: ProjectFiles, b: ProjectFiles) =>
  JSON.stringify(a) === JSON.stringify(b);

export function VibeWorkspacePage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  useDocumentTitle("바이브코딩 작업 공간");
  const [attempt, setAttempt] = useState<VibeAttempt | null>(null);
  const [files, setFiles] = useState<ProjectFiles>({});
  const [path, setPath] = useState("src/search.ts");
  const [prompt, setPrompt] = useState("");
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [recoveryFiles, setRecoveryFiles] = useState<ProjectFiles | null>(null);
  const [proposal, setProposal] = useState<VibeMessage | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const rowRef = useRef(attempt);
  rowRef.current = attempt;
  const filesRef = useRef(files);
  filesRef.current = files;
  const operationRef = useRef(false);
  const savingRef = useRef<Promise<VibeAttempt> | null>(null);
  const bypass = useRef(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const units = useRef<{ source: string; positions: number[] }>({
    source: "",
    positions: [],
  });
  const backupKey = `unsolvable-vibe-draft:${session!.user.id}:${id}`;
  const now = useNow(1000);
  const expired = attempt ? Date.parse(attempt.deadlineAt) <= now : false;
  const remoteBusy = attempt?.busyUntil
    ? Date.parse(attempt.busyUntil) > now
    : false;
  const closed = Boolean(attempt?.submittedAt) || expired;
  const dirty = Boolean(
    attempt &&
    !same(editedFiles(attempt, files), editedFiles(attempt, attempt.files)),
  );
  useUnsavedChanges(dirty, bypass);

  function accept(next: VibeAttempt, replaceFiles = true) {
    rowRef.current = next;
    setAttempt(next);
    setSaveError("");
    if (replaceFiles) {
      filesRef.current = next.files;
      setFiles(next.files);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setError("");
    setBusy("서버 저장본을 여는 중…");
    api<VibeAttempt>(
      `/vibe/attempts/${id}`,
      { signal: controller.signal },
      session!.accessToken,
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        accept(next);
        {
          try {
            const stored = JSON.parse(
              sessionStorage.getItem(backupKey) ?? "null",
            );
            if (
              stored &&
              stored.files &&
              next.editablePaths.every(
                (name) => typeof stored.files[name] === "string",
              )
            ) {
              const recovered = {
                ...next.files,
                ...Object.fromEntries(
                  next.editablePaths.map((name) => [name, stored.files[name]]),
                ),
              };
              if (
                !next.submittedAt &&
                Date.parse(next.deadlineAt) > Date.now() &&
                stored.revision === next.revision
              ) {
                filesRef.current = recovered;
                setFiles(recovered);
              } else if (
                !same(
                  editedFiles(next, recovered),
                  editedFiles(next, next.files),
                )
              ) {
                setRecoveryFiles(editedFiles(next, recovered));
              }
            }
          } catch {
            /* Server-saved files remain available if browser backup is unavailable. */
          }
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "연습을 열지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy("");
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [id, session?.user.id, reload]);

  async function save(): Promise<VibeAttempt> {
    if (savingRef.current) await savingRef.current;
    const row = rowRef.current!;
    const snapshot = filesRef.current;
    if (same(editedFiles(row, snapshot), editedFiles(row, row.files)))
      return row;
    if (row.submittedAt || Date.parse(row.deadlineAt) <= Date.now())
      throw new Error(
        "시간이 끝나 저장하지 못한 변경이 있습니다. 코드를 복사해 보관한 뒤 마지막 서버 저장본을 제출해 주세요.",
      );
    setSaving(true);
    setSaveError("");
    const request = api<VibeAttempt>(
      `/vibe/attempts/${id}/files`,
      {
        method: "PATCH",
        body: JSON.stringify({
          revision: row.revision,
          files: editedFiles(row, snapshot),
        }),
      },
      session!.accessToken,
    );
    savingRef.current = request;
    try {
      const next = await request;
      if (mounted.current) {
        accept(next, same(filesRef.current, snapshot));
        try {
          if (same(filesRef.current, next.files))
            sessionStorage.removeItem(backupKey);
          else
            sessionStorage.setItem(
              backupKey,
              JSON.stringify({
                revision: next.revision,
                files: editedFiles(next, filesRef.current),
              }),
            );
        } catch {
          /* Server save and in-memory edits are retained. */
        }
      }
      return next;
    } catch (cause) {
      if (mounted.current)
        setSaveError(
          cause instanceof Error ? cause.message : "저장하지 못했습니다.",
        );
      throw cause;
    } finally {
      savingRef.current = null;
      if (mounted.current) setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || closed || busy || remoteBusy) return;
    const timer = window.setTimeout(() => void save().catch(() => {}), 1000);
    return () => window.clearTimeout(timer);
  }, [files, dirty, closed, busy, remoteBusy]);

  function change(source: string) {
    const next = { ...filesRef.current, [path]: source };
    filesRef.current = next;
    setFiles(next);
    try {
      sessionStorage.setItem(
        backupKey,
        JSON.stringify({
          revision: rowRef.current!.revision,
          files: editedFiles(rowRef.current!, next),
        }),
      );
    } catch {
      setSaveError(
        "이 탭의 복구 사본을 저장하지 못했습니다. 서버 저장 상태를 확인해 주세요.",
      );
    }
  }
  async function action(
    name: string,
    endpoint: string,
    body: Record<string, unknown> = {},
  ) {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(name);
    setError("");
    try {
      const row = expired && !dirty ? rowRef.current! : await save();
      const next = await api<VibeAttempt>(
        `/vibe/attempts/${id}/${endpoint}`,
        {
          method: "POST",
          body: JSON.stringify({ revision: row.revision, ...body }),
        },
        session!.accessToken,
      );
      if (!mounted.current) return;
      accept(next);
      setProposal(null);
      setShowChanges(false);
      if (endpoint === "messages" && !next.messages.at(-1)?.failed)
        setPrompt("");
      try {
        sessionStorage.removeItem(backupKey);
      } catch {
        /* Server already saved the response. */
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "작업을 완료하지 못했습니다.",
        );
    } finally {
      operationRef.current = false;
      if (mounted.current) setBusy("");
    }
  }

  if (!attempt)
    return (
      <div className="page-width page-body">
        <Link className="back-link" to="/vibe">
          ← 바이브코딩
        </Link>
        {error ? (
          <p className="error-message" role="alert">
            {error}{" "}
            <button
              className="inline-button"
              onClick={() => setReload((v) => v + 1)}
            >
              다시 시도
            </button>
          </p>
        ) : (
          <SkeletonRows count={5} />
        )}
      </div>
    );
  const latestRun = attempt.runs.at(-1);
  const selectedProposal = proposal?.files ?? {};
  const readOnly = closed || !attempt.editablePaths.includes(path);
  const total =
    attempt.report?.evaluationStatus === "complete"
      ? attempt.report.outcome +
        attempt.report.prompt!.score +
        attempt.report.process!.score
      : null;
  const evidenceLabel = (value: string) =>
    attempt.events.find((event) => event.id === value)
      ? eventLabels[attempt.events.find((event) => event.id === value)!.type]
      : attempt.runs.some((run) => run.id === value)
        ? "테스트 실행"
        : attempt.messages.find((message) => message.id === value)?.role ===
            "user"
          ? "작성한 프롬프트"
          : "파트너 답변";
  return (
    <div className="vibe-workspace page-width">
      <header className="vibe-workspace-header">
        <div>
          <Link className="back-link" to="/vibe">
            ← 바이브코딩
          </Link>
          <h1>{attempt.challenge.title}</h1>
          <p>
            <span>
              {attempt.submittedAt
                ? "제출 완료"
                : expired
                  ? "시간 종료"
                  : `남은 시간 ${Math.floor((Date.parse(attempt.deadlineAt) - now) / 60000)}분 ${Math.floor((Date.parse(attempt.deadlineAt) - now) / 1000) % 60}초`}
            </span>
          </p>
        </div>
        <div className="vibe-workspace-actions">
          <span
            className={saveError ? "vibe-save-error" : "muted"}
            role="status"
          >
            {saving
              ? "서버에 저장 중…"
              : saveError
                ? "저장 확인 필요"
                : dirty
                  ? "저장하지 않은 변경"
                  : "서버에 저장됨"}
          </span>
          <button
            className="button button-outline"
            disabled={Boolean(busy) || remoteBusy || !dirty || closed}
            onClick={() => void save().catch(() => {})}
          >
            <Save size={16} aria-hidden="true" />
            저장
          </button>
          {!attempt.submittedAt ? (
            <button
              className="button"
              disabled={
                Boolean(busy) || remoteBusy || !attempt.availability.runner
              }
              onClick={() => {
                if (
                  window.confirm(
                    "현재 저장본을 제출할까요? 제출 후에는 수정할 수 없습니다.",
                  )
                )
                  void action("최종 채점과 과정 평가 중…", "submit", {
                    reflection,
                  });
              }}
            >
              최종 제출
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <Link className="button button-outline" to="/vibe">
              새 연습
            </Link>
          )}
        </div>
      </header>
      {busy ? (
        <p className="notice-inline" role="status">
          {busy} 결과가 나올 때까지 잠시 기다려 주세요.
        </p>
      ) : null}
      {remoteBusy && !busy ? (
        <p className="notice-inline" role="status">
          서버에서 작업을 처리 중입니다. 잠시 뒤{" "}
          <button
            className="inline-button"
            onClick={() => setReload((v) => v + 1)}
          >
            결과 새로고침
          </button>
        </p>
      ) : null}
      {error || saveError ? (
        <div className="error-message" role="alert">
          {error || saveError}
          <p>저장되지 않은 코드는 편집기에서 복사할 수 있습니다.</p>
          <button
            className="inline-button"
            disabled={saving || Boolean(busy)}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "저장하지 않은 코드는 복사해 보관했나요? 서버 저장본을 다시 엽니다.",
                )
              )
                setReload((v) => v + 1);
            }}
          >
            서버 저장본 다시 열기
          </button>
        </div>
      ) : null}
      {recoveryFiles ? (
        <details className="notice-inline vibe-recovery">
          <summary>
            서버 저장본과 다른 복구 사본이 있습니다. 여기에서 코드를 복사해
            보관하세요.
          </summary>
          {Object.entries(recoveryFiles).map(([name, content]) => (
            <label key={name}>
              {name}
              <textarea
                readOnly
                aria-label={`${name} 복구 사본`}
                rows={5}
                value={content}
              />
            </label>
          ))}
        </details>
      ) : null}
      {expired && !attempt.submittedAt ? (
        <p className="notice-inline">
          연습 시간이 끝났습니다. 마지막 서버 저장본을 제출해 결과를 확인할 수
          있습니다.
          {dirty ? (
            <button
              className="inline-button"
              onClick={() => {
                if (
                  window.confirm(
                    "현재 수정 내용을 복사해 보관했나요? 서버 저장본으로 돌아갑니다.",
                  )
                ) {
                  filesRef.current = attempt.files;
                  setFiles(attempt.files);
                }
              }}
            >
              서버 저장본으로 돌아가기
            </button>
          ) : null}
        </p>
      ) : null}
      {attempt.report ? (
        <section className="vibe-report" aria-labelledby="vibe-result">
          <div className="vibe-report-title">
            <div>
              <span className="vibe-eyebrow">연습 결과</span>
              <h2 id="vibe-result">
                {total === null
                  ? "결과물 채점을 완료했어요."
                  : `${total}점, 다음 시도를 위한 기록`}
              </h2>
              <p>
                과정 점수는 자동 분석한 연습 피드백입니다. 연결된 근거와 함께
                읽어 주세요.
              </p>
            </div>
            {total !== null ? (
              <strong className="vibe-total">
                {total}
                <small>/100</small>
              </strong>
            ) : null}
          </div>
          <div className="vibe-score-grid">
            <article>
              <h3>
                결과물 <span>{attempt.report.outcome}/40</span>
              </h3>
              <p>
                기능 테스트 {attempt.report.passed}/{attempt.report.total}개
                통과
              </p>
              <Checks checks={attempt.report.checks} />
            </article>
            {(["prompt", "process"] as const).map((key) => (
              <article key={key}>
                <h3>
                  {key === "prompt" ? "프롬프트" : "협업·검증"}{" "}
                  <span>{attempt.report![key]?.score ?? "—"}/30</span>
                </h3>
                <p>
                  {attempt.report![key]?.feedback ??
                    "과정 평가를 받지 못했습니다. 결과물 점수는 보존되어 있습니다."}
                </p>
                <div className="vibe-evidence">
                  {attempt.report![key]?.evidence.map((evidence) => (
                    <a key={evidence} href={`#vibe-${evidence}`}>
                      {evidenceLabel(evidence)} ↗
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {attempt.report.evaluationStatus !== "complete" ? (
            <button
              className="button button-outline"
              disabled={Boolean(busy) || remoteBusy || !attempt.availability.ai}
              onClick={() => void action("과정 평가 중…", "evaluation")}
            >
              과정 평가 다시 받기
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="vibe-workspace-grid">
        <aside className="vibe-task-panel">
          <h2>해야 할 일</h2>
          <ol>
            {attempt.challenge.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ol>
          <h2>프로젝트 파일</h2>
          <nav className="vibe-files" aria-label="프로젝트 파일">
            {Object.keys(files).map((name) => (
              <button
                type="button"
                key={name}
                aria-current={path === name ? "page" : undefined}
                className={path === name ? "active" : ""}
                onClick={() => {
                  setPath(name);
                  setShowChanges(false);
                }}
              >
                <FileCode2 size={15} aria-hidden="true" />
                <span>{name}</span>
                {!attempt.editablePaths.includes(name) ? (
                  <small>읽기</small>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="vibe-task-note">
            공개 테스트로 기능을 확인하고, 최종 제출에서 숨김 테스트도
            검사합니다. 작성한 테스트는 결과물 점수에 직접 더하지 않습니다.
          </div>
          <details className="vibe-events">
            <summary>변경 기록 {attempt.events.length}건</summary>
            {attempt.events.map((event) => (
              <div key={event.id} id={`vibe-${event.id}`}>
                <strong>{eventLabels[event.type]}</strong>
                <span>
                  r{event.revision} ·{" "}
                  {new Date(event.createdAt).toLocaleTimeString("ko-KR")}
                </span>
                {event.paths?.map((name) => (
                  <small key={name}>{name}</small>
                ))}
              </div>
            ))}
          </details>
        </aside>
        <section className="vibe-code-panel" aria-label="코드 작업">
          <div className="vibe-panel-toolbar">
            <strong>{path}</strong>
            <div>
              <button
                className="text-button"
                disabled={
                  Boolean(busy) ||
                  remoteBusy ||
                  !attempt.canUndo ||
                  closed ||
                  dirty
                }
                onClick={() => void action("변경을 되돌리는 중…", "undo")}
              >
                <Undo2 size={15} aria-hidden="true" />
                되돌리기
              </button>
              <button
                className="text-button"
                disabled={!proposal}
                aria-pressed={showChanges}
                onClick={() => setShowChanges((v) => !v)}
              >
                <GitCompareArrows size={15} aria-hidden="true" />
                변경 비교
              </button>
            </div>
          </div>
          {showChanges && proposal ? (
            <div className="vibe-diff">
              {Object.entries(selectedProposal).map(([name, content]) => (
                <section key={name}>
                  <h3>{name}</h3>
                  <div className="vibe-diff-columns">
                    <div>
                      <h4>현재 코드</h4>
                      <pre>{files[name]}</pre>
                    </div>
                    <div>
                      <h4>제안한 변경안</h4>
                      <pre>{content}</pre>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : readOnly ? (
            <pre
              className="vibe-readonly"
              tabIndex={0}
              aria-label={`${path} 코드`}
            >
              {files[path]}
            </pre>
          ) : (
            <fieldset
              disabled={Boolean(busy) || remoteBusy}
              className="vibe-editor-fieldset"
            >
              <legend className="sr-only">{path} 편집</legend>
              <CodeEditor
                key={path}
                ref={editorRef}
                language="TYPESCRIPT"
                value={files[path] ?? ""}
                fontSize={14}
                onChange={change}
                onCursorChange={() => {}}
                syncUnits={(value, added = []) => {
                  const next = addUnits(
                    remapUnits(
                      units.current.positions,
                      units.current.source,
                      value,
                    ),
                    added,
                    value,
                  );
                  units.current = { source: value, positions: next };
                  return next;
                }}
              />
            </fieldset>
          )}
          <section className="vibe-test-panel" aria-labelledby="vibe-tests">
            <div className="vibe-panel-toolbar">
              <h2 id="vibe-tests">실행과 테스트</h2>
              <button
                className="button button-small button-outline"
                disabled={
                  Boolean(busy) ||
                  remoteBusy ||
                  closed ||
                  !attempt.availability.runner ||
                  attempt.remainingRuns <= 0
                }
                onClick={() => void action("공개 테스트 실행 중…", "runs")}
              >
                <Play size={14} aria-hidden="true" />
                테스트 실행
              </button>
            </div>
            {!attempt.availability.runner ? (
              <p className="vibe-panel-note">
                실행기가 아직 준비되지 않았습니다. 작성한 코드는 저장할 수
                있습니다.
              </p>
            ) : latestRun ? (
              <div id={`vibe-${latestRun.id}`}>
                <p className="vibe-panel-note">
                  r{latestRun.revision}의 실행 결과
                  {latestRun.revision !== attempt.revision || dirty
                    ? " · 현재 코드는 실행 뒤 변경되었습니다."
                    : ""}
                </p>
                <Checks checks={latestRun.checks} />
              </div>
            ) : (
              <p className="vibe-panel-note">
                코드를 수정한 뒤 테스트를 실행해 보세요. {attempt.remainingRuns}
                회 남았습니다.
              </p>
            )}
            <details className="vibe-run-history">
              <summary>이전 실행 기록</summary>
              {attempt.runs.slice(0, -1).map((run) => (
                <div id={`vibe-${run.id}`} key={run.id}>
                  <strong>
                    r{run.revision} ·{" "}
                    {new Date(run.createdAt).toLocaleTimeString("ko-KR")}
                  </strong>
                  <Checks checks={run.checks} />
                </div>
              ))}
            </details>
          </section>
        </section>
        <aside className="vibe-chat-panel" aria-labelledby="vibe-chat-title">
          <div className="vibe-panel-toolbar">
            <h2 id="vibe-chat-title">코딩 파트너</h2>
            <span>{attempt.remainingAiRequests}회 남음</span>
          </div>
          <p className="vibe-panel-note">
            현재 프로젝트와 공개 실행 결과를 함께 읽습니다. 변경안은 확인 후
            적용하세요.
          </p>
          <div className="vibe-messages" aria-live="polite">
            {!attempt.messages.length ? (
              <div className="vibe-chat-empty">
                <MessageHint />
                <strong>어디부터 살펴볼까요?</strong>
                <p>
                  관찰한 문제와 원하는 동작을 설명하거나, 파트너에게 프로젝트
                  구조를 먼저 물어보세요.
                </p>
              </div>
            ) : (
              attempt.messages.map((message) => (
                <article
                  id={`vibe-${message.id}`}
                  key={message.id}
                  className={`vibe-message ${message.role}`}
                >
                  <strong>
                    {message.role === "user" ? "나" : "코딩 파트너"}
                  </strong>
                  <p>{message.text}</p>
                  {message.files && Object.keys(message.files).length ? (
                    <div className="vibe-proposal">
                      <span>
                        {Object.keys(message.files).length}개 파일 변경안 · r
                        {message.baseRevision} 기준
                      </span>
                      <div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setProposal(message);
                            setShowChanges(true);
                          }}
                        >
                          변경안 보기
                        </button>
                        <button
                          className="button button-small"
                          disabled={
                            Boolean(busy) ||
                            remoteBusy ||
                            closed ||
                            dirty ||
                            message.baseRevision !== attempt.revision
                          }
                          onClick={() =>
                            void action(
                              "제안한 변경안을 적용하는 중…",
                              "apply",
                              {
                                messageId: message.id,
                              },
                            )
                          }
                        >
                          적용
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
          {!attempt.submittedAt ? (
            <form
              className="vibe-prompt"
              onSubmit={(event) => {
                event.preventDefault();
                if (prompt.trim())
                  void action(
                    "파트너가 프로젝트를 읽고 있습니다…",
                    "messages",
                    {
                      prompt,
                    },
                  );
              }}
            >
              <label className="sr-only" htmlFor="vibe-prompt">
                파트너에게 보낼 메시지
              </label>
              <textarea
                id="vibe-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={4000}
                rows={4}
                placeholder="문제 상황, 원하는 동작, 지켜야 할 조건을 알려주세요."
                disabled={
                  Boolean(busy) ||
                  remoteBusy ||
                  closed ||
                  !attempt.availability.ai
                }
              />
              <div>
                <span>
                  {!attempt.availability.ai
                    ? "파트너 연결 준비 중"
                    : `${prompt.length}/4000`}
                </span>
                <button
                  className="button button-small"
                  disabled={
                    !prompt.trim() ||
                    Boolean(busy) ||
                    remoteBusy ||
                    closed ||
                    !attempt.availability.ai ||
                    attempt.remainingAiRequests <= 0
                  }
                >
                  <Send size={14} aria-hidden="true" />
                  보내기
                </button>
              </div>
            </form>
          ) : null}
        </aside>
      </div>
      {!attempt.submittedAt ? (
        <section className="vibe-reflection">
          <label htmlFor="vibe-reflection">
            제출 전 짧은 회고 <span>선택</span>
          </label>
          <p>
            무엇을 고쳤고, 어떤 근거로 동작을 확인했나요? 실제 기록과 함께
            피드백에 활용됩니다.
          </p>
          <textarea
            id="vibe-reflection"
            rows={3}
            maxLength={3000}
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            disabled={Boolean(busy) || remoteBusy}
            placeholder="제안받은 내용 중 검토한 점과 직접 확인한 테스트를 적어 보세요."
          />
        </section>
      ) : null}
    </div>
  );
}
function MessageHint() {
  return (
    <span className="vibe-chat-mark" aria-hidden="true">
      <FileCode2 size={20} />
    </span>
  );
}
function Checks({ checks }: { checks: VibeCheck[] }) {
  return (
    <ul className="vibe-checks">
      {checks.map((check) => (
        <li key={check.name} className={check.passed ? "passed" : "failed"}>
          <div>
            <span aria-label={check.passed ? "통과" : "실패"}>
              {check.passed ? <Check size={15} aria-hidden="true" /> : "×"}
            </span>
            <strong>{check.name}</strong>
          </div>
          {check.detail ? (
            <details>
              <summary>실행 내용</summary>
              <pre>{check.detail}</pre>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
