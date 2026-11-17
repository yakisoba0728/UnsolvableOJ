import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useConfirm } from "../components/ConfirmDialog";
import type { LearningDays, LearningGoalResponse } from "./types";

const endpoint = "/users/me/learning-goal";
const labels = { ACTIVE: "진행 중", COMPLETED: "목표 달성", EXPIRED: "기간 종료" };

/** The account/login-keyed LearningPage owns this private state and its drafts. */
export function LearningGoalPanel() {
  const { session, getSessionIdentityVersion } = useAuth();
  const owner = getSessionIdentityVersion();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [resource, setResource] = useState<LearningGoalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("10");
  const [days, setDays] = useState<LearningDays>(30);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setBusy(false);
    setError("");
    const current = () => !controller.signal.aborted && getSessionIdentityVersion() === owner;
    void Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      const token = sessionRef.current?.accessToken;
      if (!token) return;
      const next = await api<LearningGoalResponse>(endpoint, { signal: controller.signal }, token);
      if (current()) {
        setResource(next);
        setUncertain(false);
      }
    }).catch(cause => {
      if (current()) setError(cause instanceof Error ? cause.message : "학습 목표를 불러오지 못했습니다.");
    }).finally(() => {
      if (current()) setLoading(false);
    });
    // Also cancels a mutation started after this read, on account/route change.
    return () => { controller.abort(); request.current?.abort(); };
    // Token rotation keeps the same owner and must not abort an in-flight write
    // or race it with an older GET. api() owns any necessary bearer refresh.
  }, [owner, refresh, getSessionIdentityVersion]);

  useEffect(() => {
    if (focusHeading.current && !editing) {
      heading.current?.focus();
      focusHeading.current = false;
    }
  }, [editing, resource]);

  async function mutate(method: "PUT" | "POST" | "DELETE", body?: { targetProblems: number; days: LearningDays }) {
    if (!session || busy || loading || uncertain || getSessionIdentityVersion() !== owner) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && getSessionIdentityVersion() === owner;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await api<LearningGoalResponse>(`${endpoint}${method === "POST" ? "/reset" : ""}`, {
        method, signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}),
      }, session.accessToken);
      if (!current()) return;
      setResource(next);
      setEditing(false);
      focusHeading.current = true;
      setNotice(method === "DELETE" ? "학습 목표를 삭제했습니다. 제출 기록은 그대로 보관됩니다."
        : method === "POST" ? "오늘부터 목표를 다시 시작합니다. 오늘 해결한 문제도 포함됩니다." : "학습 목표를 저장했습니다.");
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : "학습 목표를 변경하지 못했습니다.");
        // A lost response does not establish whether the server committed a write.
        setUncertain(true);
      }
    } finally {
      if (current()) setBusy(false);
    }
  }

  const goal = resource?.goal;
  const disabled = loading || busy || uncertain || !resource;
  function edit() {
    setTarget(String(goal?.targetProblems ?? 10));
    setDays(goal?.days ?? 30);
    setNotice("");
    setEditing(true);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = Number(target);
    if (!Number.isInteger(count) || count < 1 || count > 1000) return;
    void mutate("PUT", { targetProblems: count, days });
  }
  async function reset() {
    if (await confirm({ title: "오늘부터 다시 시작할까요?", message: "기존 목표 기간을 오늘부터 새로 계산합니다. 오늘 해결한 문제도 포함되며, 제출 기록은 유지됩니다.", confirmLabel: "다시 시작" }))
      await mutate("POST");
  }
  async function remove() {
    if (await confirm({ title: "학습 목표를 삭제할까요?", message: "목표 설정만 삭제합니다. 제출 기록과 해결한 문제는 그대로 남습니다.", confirmLabel: "목표 삭제", danger: true }))
      await mutate("DELETE");
  }

  return <section className="learning-panel learning-goal" aria-labelledby="learning-goal-title" aria-busy={loading || busy}>
    <div className="learning-heading">
      <div><h2 id="learning-goal-title" ref={heading} tabIndex={-1}>나의 학습 목표</h2>
        <p className="muted">오늘부터 7·30·90일 동안 해결할 공개 문제 수를 정해 보세요.</p></div>
      <button type="button" className="button button-small button-outline" aria-label="목표 새로고침" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{loading && resource ? "새로고침 중…" : "목표 새로고침"}</button>
    </div>
    {loading ? <p className={resource ? "sr-only" : "muted"} role="status">학습 목표를 불러오는 중입니다.</p> : null}
    {error ? <div className="learning-goal-error" role="alert"><p>{error}</p>
      {uncertain ? <p>변경 결과가 확인되지 않았습니다. 현재 목표를 다시 불러온 뒤 이어서 진행해 주세요.</p> : null}
      <button type="button" className="button button-small button-outline" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>목표 다시 불러오기</button>
    </div> : null}
    {/* The keyed page owns this resource. A same-owner refresh keeps its last
        confirmed content visible while all writes stay disabled. */}
    {resource ? goal ? <div className="learning-goal-progress">
      <div className="learning-goal-count"><strong>{goal.solvedProblems.toLocaleString("ko-KR")} / {goal.targetProblems.toLocaleString("ko-KR")}문제</strong><span className="pill">{labels[goal.status]}</span></div>
      <progress max={goal.targetProblems} value={Math.min(goal.solvedProblems, goal.targetProblems)} aria-label="학습 목표 달성률" aria-valuetext={`${goal.targetProblems}문제 목표, ${goal.solvedProblems}문제 해결`} />
      <p className="muted"><time dateTime={goal.startDate}>{goal.startDate}</time> ~ <time dateTime={goal.endDate}>{goal.endDate}</time> · 한국 시간 기준 {goal.days}일</p>
      <p className="muted learning-goal-scope">목표 기간에 정답을 받은 서로 다른 공개 문제를 셉니다. 같은 문제의 여러 정답, 테스트 실행, 기업 시험은 중복 집계하지 않거나 제외합니다. 공개 상태와 재채점 결과에 따라 수치가 바뀔 수 있습니다.</p>
    </div> : <p className="learning-goal-empty">아직 학습 목표가 없어요. 나에게 맞는 목표부터 시작해 보세요.</p> : null}
    {editing ? <form className="learning-goal-form" onSubmit={save} aria-label="학습 목표 설정">
      <div className="learning-goal-fields">
        <label htmlFor="learning-goal-target">목표 문제 수<input id="learning-goal-target" type="number" min="1" max="1000" step="1" required inputMode="numeric" value={target} disabled={disabled} onChange={event => setTarget(event.target.value)} aria-describedby="learning-goal-help" autoFocus /></label>
        <label htmlFor="learning-goal-days">목표 기간<select id="learning-goal-days" value={days} disabled={disabled} onChange={event => setDays(Number(event.target.value) as LearningDays)}>{([7, 30, 90] as const).map(period => <option key={period} value={period}>{period}일</option>)}</select></label>
      </div>
      <p id="learning-goal-help" className="muted">1~1,000문제 · 오늘 해결한 문제 포함. 수나 기간을 바꾸면 오늘부터 새 목표가 시작됩니다. 같은 설정을 다시 저장하면 기존 기간을 유지합니다.</p>
      <div className="learning-goal-actions"><button type="submit" className="button button-small" disabled={disabled}>{busy ? "저장 중…" : "목표 저장"}</button>
        <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => { focusHeading.current = true; setEditing(false); }}>취소</button></div>
    </form> : <div className="learning-goal-actions">
      <button type="button" className="button button-small" disabled={disabled} onClick={edit}>{goal ? "목표 변경" : "목표 설정"}</button>
      {goal ? <><button type="button" className="button button-small button-outline" disabled={disabled} onClick={() => { void reset(); }}>오늘부터 다시 시작</button>
        <button type="button" className="button button-small button-outline" disabled={disabled} onClick={() => { void remove(); }}>목표 삭제</button></> : null}
    </div>}
    <p className="learning-goal-notice" role="status">{busy && !editing ? "학습 목표를 변경하는 중입니다." : notice}</p>
    {confirmDialog}
  </section>;
}
