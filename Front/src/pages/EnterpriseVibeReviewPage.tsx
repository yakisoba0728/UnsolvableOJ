import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle, useRequest } from "../hooks";
import type { ProjectFiles, VibeReview } from "../vibe/types";
import "../vibe.css";

const actionLabel: Record<string, string> = {
  initial: "시작 코드",
  baseline: "이력 수집 시작",
  save: "직접 저장",
  apply: "제안 적용",
  undo: "되돌리기",
  run: "테스트 실행",
  submit: "최종 제출",
};
const time = (value: string) => new Date(value).toLocaleString("ko-KR");
interface Revision {
  revision: number;
  files: ProjectFiles;
  previousFiles: ProjectFiles;
}

export function EnterpriseVibeReviewPage() {
  const { testId, attemptId, id } = useParams();
  const { session } = useAuth();
  const token = session?.accessToken;
  const url = `/enterprise/tests/${testId}/attempts/${attemptId}/vibe/${id}`;
  const review = useRequest<VibeReview | null>(
    token ? (signal) => api(url, { signal }, token) : null,
    null,
    "응시 기록을 불러오지 못했습니다.",
    [token, url],
  );
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState("");
  const data = review.data;
  const revision = selectedRevision ?? data?.revisions.at(-1)?.revision;
  const snapshot = useRequest<Revision | null>(
    token && revision !== undefined
      ? (signal) => api(`${url}/revisions/${revision}`, { signal }, token)
      : null,
    null,
    "코드 변경 기록을 불러오지 못했습니다.",
    [token, url, revision],
  );
  useDocumentTitle(
    data ? `${data.candidate.username} · 바이브코딩 검토` : "바이브코딩 검토",
  );

  async function grade() {
    if (grading) return;
    setGrading(true);
    setGradeError("");
    try {
      await api(url + "/evaluation", { method: "POST" }, token);
      review.retry();
    } catch (cause) {
      setGradeError(
        cause instanceof Error ? cause.message : "평가하지 못했습니다.",
      );
    } finally {
      setGrading(false);
    }
  }
  const report = data?.report;
  const total =
    report?.evaluationStatus === "complete"
      ? report.outcome + report.prompt!.score + report.process!.score
      : null;
  const files = snapshot.data ? Object.keys(snapshot.data.files) : [];
  const file = files.includes(selectedFile) ? selectedFile : files[0];
  return (
    <div className="page-width enterprise-page ent-vibe-review">
      <PageHeader
        title={
          data
            ? `${data.candidate.username} · 바이브코딩 검토`
            : "바이브코딩 검토"
        }
        description={data?.challenge.title}
        back={{ to: `/enterprise/${testId}`, label: "응시 결과" }}
        aside={
          <button
            className="button button-outline"
            onClick={review.retry}
            disabled={review.loading}
          >
            새로고침
          </button>
        }
      />
      {review.error ? (
        <p className="error-message" role="alert">
          {review.error}
        </p>
      ) : null}
      {!data ? (
        <p role="status">
          {review.loading
            ? "응시 기록을 불러오는 중…"
            : "기록을 열 수 없습니다."}
        </p>
      ) : (
        <>
          <section
            className="form-card ent-card"
            aria-labelledby="review-result"
          >
            <div className="ent-pick-head">
              <h2 id="review-result">
                응시 결과 · {total === null ? "평가 대기" : `${total}점`}
              </h2>
              {data.canGrade && total === null ? (
                <button
                  className="button"
                  disabled={grading || review.loading}
                  onClick={() => void grade()}
                >
                  {grading
                    ? "평가 중…"
                    : data.submittedAt
                      ? "과정 평가 다시 받기"
                      : "저장본 채점"}
                </button>
              ) : null}
            </div>
            <p className="muted">
              시작 {time(data.startedAt)} · 마감 {time(data.deadlineAt)} ·{" "}
              {data.submittedAt
                ? `제출 ${time(data.submittedAt)}`
                : data.canGrade
                  ? "응시 종료 · 마지막 저장본"
                  : "응시 중"}
            </p>
            {gradeError ? (
              <p className="error-message" role="alert">
                {gradeError}
              </p>
            ) : null}
            {report ? (
              <>
                <dl className="ent-summary">
                  <div>
                    <dt>결과물</dt>
                    <dd>{report.outcome}/40</dd>
                  </div>
                  <div>
                    <dt>프롬프트</dt>
                    <dd>
                      {report.prompt
                        ? `${report.prompt.score}/30`
                        : "평가 대기"}
                    </dd>
                  </div>
                  <div>
                    <dt>활용 과정</dt>
                    <dd>
                      {report.process
                        ? `${report.process.score}/30`
                        : "평가 대기"}
                    </dd>
                  </div>
                </dl>
                <p>
                  검증 {report.passed}/{report.total} 통과
                </p>
                {[report.prompt, report.process].map((section, index) =>
                  section ? (
                    <div key={index}>
                      <h3>
                        {index === 0 ? "프롬프트 평가" : "활용 과정 평가"}
                      </h3>
                      <p>{section.feedback}</p>
                      <ul>
                        {section.evidence.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
                {report.reflection ? (
                  <p className="ent-review-text">
                    응시자 회고: {report.reflection}
                  </p>
                ) : null}
                <details>
                  <summary>최종 검증 결과</summary>
                  <ul>
                    {report.checks.map((check, i) => (
                      <li key={i}>
                        {check.passed ? "통과" : "실패"} · {check.name}
                        {check.detail ? ` · ${check.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="muted">
                제출 전입니다. 저장된 코드와 대화 기록은 아래에서 확인할 수
                있습니다.
              </p>
            )}
            <p className="muted ent-note">
              자동 평가는 검토를 돕는 참고 자료입니다. 아래 실제 기록을 함께
              확인해 주세요.
            </p>
          </section>
          <section className="form-card ent-card" aria-labelledby="review-code">
            <h2 id="review-code">코드 변경 과정</h2>
            <div className="ent-actions ent-review-controls">
              <label>
                저장 버전{" "}
                <select
                  value={revision ?? ""}
                  onChange={(event) =>
                    setSelectedRevision(Number(event.target.value))
                  }
                >
                  {data.revisions.map((item) => (
                    <option key={item.revision} value={item.revision}>
                      v{item.revision} ·{" "}
                      {actionLabel[item.action] ?? item.action} ·{" "}
                      {time(item.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                파일{" "}
                <select
                  value={file ?? ""}
                  onChange={(event) => setSelectedFile(event.target.value)}
                >
                  {files.map((path) => (
                    <option key={path}>{path}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              직전 저장본과 선택한 버전을 비교합니다. 제안 적용·되돌리기도 별도
              버전으로 남습니다.
            </p>
            {snapshot.error ? (
              <p className="error-message" role="alert">
                {snapshot.error}{" "}
                <button className="text-button" onClick={snapshot.retry}>
                  다시 시도
                </button>
              </p>
            ) : null}
            {snapshot.loading ? (
              <p role="status">코드를 불러오는 중…</p>
            ) : snapshot.data && file ? (
              <div className="ent-review-diff">
                <div>
                  <h3>변경 전</h3>
                  <pre aria-label="변경 전 코드">
                    <code>{snapshot.data.previousFiles[file]}</code>
                  </pre>
                </div>
                <div>
                  <h3>선택한 버전 · v{snapshot.data.revision}</h3>
                  <pre aria-label="선택한 버전 코드">
                    <code>{snapshot.data.files[file]}</code>
                  </pre>
                </div>
              </div>
            ) : null}
            <details>
              <summary>저장·적용·실행 타임라인 ({data.events.length})</summary>
              <ol>
                {data.events.map((event) => (
                  <li key={event.id}>
                    {time(event.createdAt)} · v{event.revision} ·{" "}
                    {actionLabel[event.type]} {event.paths?.join(", ")}
                    {event.messageId ? ` · 연결 답변 ${event.messageId}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          </section>
          <section
            className="form-card ent-card"
            aria-labelledby="review-prompts"
          >
            <h2 id="review-prompts">
              프롬프트와 답변 ({data.messages.length})
            </h2>
            {!data.messages.length ? (
              <p className="muted">대화 기록이 없습니다.</p>
            ) : (
              data.messages.map((message) => (
                <article
                  className={`vibe-message ${message.role}`}
                  key={message.id}
                >
                  <strong>
                    {message.role === "user"
                      ? "응시자 프롬프트"
                      : "코딩 파트너 답변"}
                  </strong>
                  <small className="muted">
                    {" "}
                    · {time(message.createdAt)} · 기준 v{message.baseRevision}
                    {message.failed ? " · 요청 실패" : ""}
                  </small>
                  <p className="ent-review-text">{message.text}</p>
                  {message.files && Object.keys(message.files).length ? (
                    <details>
                      <summary>
                        제안 코드 ·{" "}
                        {data.events.some(
                          (event) =>
                            event.messageId === message.id &&
                            event.type === "apply",
                        )
                          ? "적용됨"
                          : "미적용"}
                      </summary>
                      {Object.entries(message.files).map(([path, source]) => (
                        <div key={path}>
                          <h4>{path}</h4>
                          <pre>
                            <code>{source}</code>
                          </pre>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </article>
              ))
            )}
          </section>
          <section className="form-card ent-card" aria-labelledby="review-runs">
            <h2 id="review-runs">테스트 실행 기록 ({data.runs.length})</h2>
            {!data.runs.length ? (
              <p className="muted">실행 기록이 없습니다.</p>
            ) : (
              data.runs.map((run) => (
                <details key={run.id}>
                  <summary>
                    v{run.revision} · {time(run.createdAt)} ·{" "}
                    {run.checks.filter((check) => check.passed).length}/
                    {run.checks.length} 통과
                  </summary>
                  <ul>
                    {run.checks.map((check, i) => (
                      <li key={i}>
                        {check.passed ? "통과" : "실패"} · {check.name}
                        {check.detail ? ` · ${check.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
