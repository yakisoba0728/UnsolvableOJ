import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { DateTimePicker } from "../components/DateTimePicker";
import { PageHeader } from "../components/PageHeader";
import { deviceTimeZone } from "../components/EnterpriseSchedule";
import {
  LIMITS,
  draftToInput,
  parseInvitees,
  testStatus,
  toLocalInput,
  validateDraft,
  type EnterpriseTest,
  type TestDraft,
  type TestErrors,
} from "../enterprise/model";
import { enterpriseApi, useEnterpriseTest } from "../enterprise/api";
import { useDocumentTitle, useEnterpriseProblems } from "../hooks";
import { difficultyLabel } from "../difficulty";

const fieldIds: Record<keyof TestErrors, string> = {
  title: "ent-title",
  startsAt: "ent-start",
  endsAt: "ent-end",
  durationMin: "ent-duration",
  problemIds: "ent-problems",
  invitees: "ent-invitees",
  description: "ent-description",
};
const fieldOrder: (keyof TestErrors)[] = [
  "title",
  "startsAt",
  "endsAt",
  "durationMin",
  "problemIds",
  "invitees",
  "description",
];

function initialDraft(existing?: EnterpriseTest): TestDraft {
  if (existing)
    return {
      title: existing.title,
      description: existing.description,
      startsAt: toLocalInput(new Date(existing.startsAt)),
      endsAt: toLocalInput(new Date(existing.endsAt)),
      durationMin: String(existing.durationMin),
      problemIds: existing.problemIds,
      inviteOnly: existing.inviteOnly,
      invitees: existing.invitees.join("\n"),
      showScoreToCandidates: existing.showScoreToCandidates,
    };
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return {
    title: "",
    description: "",
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    durationMin: "90",
    problemIds: [],
    inviteOnly: false,
    invitees: "",
    showScoreToCandidates: false,
  };
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page-width">
      <PageHeader title={title} back={{ to: "/enterprise", label: "기업 테스트" }} />
      <div className="empty-state ent-empty">{children}</div>
    </div>
  );
}

export function EnterpriseFormPage() {
  const { id } = useParams();
  const { session } = useAuth();
  useDocumentTitle(id ? "테스트 편집" : "새 테스트 만들기");

  if (!session)
    return (
      <Notice title="새 테스트 만들기">
        <strong>로그인하고 코드 테스트를 만들어 보세요</strong>
        <Link
          className="button"
          to="/auth"
          state={{ from: id ? `/enterprise/${id}/edit` : "/enterprise/new" }}
        >
          로그인하기 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  // 계정이나 주소가 바뀔 때만 새 폼을 연다. 다른 탭의 변경으로 작성 중인 입력을 버리지 않는다.
  return <EnterpriseForm key={`${session.user.id}:${id ?? "new"}`} token={session.accessToken} id={id} />;
}

function EnterpriseForm({ token, id }: { token: string; id?: string }) {
  const { session } = useAuth();
  const { data: existing, loading, error, retry } = useEnterpriseTest(session, id);
  const editable = !existing || testStatus(existing) === "scheduled";
  if (id && loading && !existing)
    return (
      <Notice title="테스트 편집">
        <p role="status">테스트를 불러오는 중…</p>
      </Notice>
    );
  if (id && error && !existing && !/찾을 수 없/.test(error))
    return (
      <Notice title="테스트 편집">
        <strong role="alert">{error}</strong>
        <button className="button" onClick={retry}>
          다시 시도
        </button>
      </Notice>
    );
  if (id && !existing)
    return (
      <Notice title="테스트 편집">
        <strong>테스트를 찾을 수 없어요</strong>
        <p>삭제되었거나 이 계정이 만든 테스트가 아닙니다.</p>
        <Link className="button" to="/enterprise">
          기업 테스트로 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  if (existing && !editable)
    return (
      <Notice title="테스트 편집">
        <strong>시작된 테스트는 수정할 수 없어요</strong>
        <p>응시 기간이 시작된 뒤에는 출제 문제와 기간을 바꿀 수 없습니다.</p>
        <Link className="button" to={`/enterprise/${existing.id}`}>
          상세 보기 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  return <TestForm token={token} existing={existing ?? undefined} />;
}

function TestForm({ token, existing }: { token: string; existing?: EnterpriseTest }) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { problems, loading, error, privateError } = useEnterpriseProblems(session);
  const [draft, setDraft] = useState(() => initialDraft(existing));
  const [query, setQuery] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const errors = showErrors ? validateDraft(draft) : {};
  const patch = (next: Partial<TestDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const known = new Set(problems.map((problem) => problem.id));
  const orphans = loading ? [] : draft.problemIds.filter((id) => !known.has(id));
  const needle = query.trim().toLowerCase();
  const visible = problems.filter(
    (problem) =>
      !needle ||
      problem.title.toLowerCase().includes(needle) ||
      problem.slug.toLowerCase().includes(needle),
  );
  const toggle = (id: string) =>
    patch({
      problemIds: draft.problemIds.includes(id)
        ? draft.problemIds.filter((value) => value !== id)
        : [...draft.problemIds, id],
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaveError("");
    setShowErrors(true);
    const found = validateDraft(draft);
    const first = fieldOrder.find((key) => found[key]);
    if (first) {
      document.getElementById(fieldIds[first])?.focus();
      return;
    }
    const input = draftToInput(draft);
    setSaving(true);
    try {
      const saved = existing
        ? await enterpriseApi.update(token, existing.id, input)
        : await enterpriseApi.create(token, input);
      navigate(`/enterprise/${saved.id}`);
    } catch (cause) {
      // 입력은 그대로 두고 서버가 알려 준 이유를 보여 준다.
      setSaveError(
        `${cause instanceof Error ? cause.message : "테스트를 저장하지 못했어요."} 입력한 내용은 유지했어요.`,
      );
    } finally {
      setSaving(false);
    }
  }

  const err = (key: keyof TestErrors) =>
    errors[key] ? (
      <p className="field-error" id={`${fieldIds[key]}-error`}>
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: keyof TestErrors) => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${fieldIds[key]}-error` : undefined,
  });

  return (
    <div className="page-width enterprise-page">
      {saveError ? <p className="error-message" role="alert">{saveError}</p> : null}
      <PageHeader
        title={existing ? "테스트 편집" : "새 테스트 만들기"}
        description="테스트 정보를 입력하고 출제할 문제를 고릅니다."
        back={{ to: existing ? `/enterprise/${existing.id}` : "/enterprise", label: existing ? "테스트 상세" : "기업 테스트" }}
      />
      <form className="ent-form" onSubmit={submit} noValidate>
        <p className="muted schedule-zone">입력 기준 시간대: {deviceTimeZone()} (이 기기의 현지 시간)</p>
        <div className="ent-form-grid">
          <section className="form-card ent-card" aria-labelledby="ent-basic">
            <h2 id="ent-basic">기본 정보</h2>
            <div className="form-stack">
              <div className="field-group">
                <div className="label-row">
                  <label className="field-label" htmlFor={fieldIds.title}>
                    테스트 이름
                  </label>
                  <span className="required-mark" aria-hidden="true">
                    필수
                  </span>
                </div>
                <input
                  id={fieldIds.title}
                  value={draft.title}
                  maxLength={LIMITS.title + 20}
                  placeholder="예: 백엔드 신입 공채 1차"
                  onChange={(event) => patch({ title: event.target.value })}
                  {...aria("title")}
                />
                {err("title")}
              </div>
              <div className="limit-row ent-dates">
                <div className="field-group">
                  <label className="field-label" htmlFor={fieldIds.startsAt}>
                    시작 일시
                  </label>
                  <DateTimePicker
                    id={fieldIds.startsAt}
                    value={draft.startsAt}
                    onChange={(value) => patch({ startsAt: value })}
                    {...aria("startsAt")}
                  />
                  {err("startsAt")}
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor={fieldIds.endsAt}>
                    종료 일시
                  </label>
                  <DateTimePicker
                    id={fieldIds.endsAt}
                    value={draft.endsAt}
                    onChange={(value) => patch({ endsAt: value })}
                    align="right"
                    {...aria("endsAt")}
                  />
                  {err("endsAt")}
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor={fieldIds.durationMin}>
                  제한 시간 (분)
                </label>
                <input
                  id={fieldIds.durationMin}
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.minDuration}
                  max={LIMITS.maxDuration}
                  value={draft.durationMin}
                  onChange={(event) => patch({ durationMin: event.target.value })}
                  {...aria("durationMin")}
                />
                <span className="field-help">
                  응시자가 시작한 뒤 문제를 푸는 시간입니다. 응시 기간보다 길 수 없어요.
                </span>
                {err("durationMin")}
              </div>
              <div className="field-group">
                <div className="label-row">
                  <label className="field-label" htmlFor={fieldIds.description}>
                    안내 문구
                  </label>
                  <span className="field-help">(선택)</span>
                </div>
                <textarea
                  id={fieldIds.description}
                  rows={4}
                  value={draft.description}
                  placeholder="응시자에게 보여 줄 유의사항을 적어 주세요."
                  onChange={(event) => patch({ description: event.target.value })}
                  {...aria("description")}
                />
                <span className="field-help">
                  {draft.description.length} / {LIMITS.description}
                </span>
                {err("description")}
              </div>
            </div>
          </section>

          <section className="form-card ent-card" aria-labelledby="ent-pick">
            <div className="ent-pick-head">
              <h2 id="ent-pick">출제 문제</h2>
              <span className="muted" aria-live="polite">
                {draft.problemIds.length} / {LIMITS.maxProblems}개 선택
              </span>
            </div>
            <input
              type="search"
              aria-label="문제 검색"
              placeholder="문제 이름으로 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div
              className="ent-problems"
              id={fieldIds.problemIds}
              tabIndex={-1}
              role="group"
              aria-label="출제할 문제"
              {...aria("problemIds")}
            >
              {loading ? (
                <p className="muted">문제를 불러오는 중입니다…</p>
              ) : error ? (
                <p className="error-message" role="alert">
                  {error}
                </p>
              ) : (
                <>
                  {orphans.map((id) => (
                    <label className="ent-problem" key={id}>
                      <input type="checkbox" checked onChange={() => toggle(id)} />
                      <span className="ent-problem-title">비공개 또는 삭제된 문제</span>
                    </label>
                  ))}
                  {visible.map((problem) => (
                    <label className="ent-problem" key={problem.id}>
                      <input
                        type="checkbox"
                        checked={draft.problemIds.includes(problem.id)}
                        onChange={() => toggle(problem.id)}
                      />
                      <span className="ent-problem-title">{problem.title}</span>
                      {problem.isPrivate ? (
                        <span className="case-pill status-private">기업 전용</span>
                      ) : null}
                      <span
                        className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                      >
                        {difficultyLabel(problem.difficulty)}
                      </span>
                    </label>
                  ))}
                  {visible.length === 0 && orphans.length === 0 ? (
                    <p className="muted">
                      {problems.length ? "검색 결과가 없어요." : "공개된 문제가 아직 없어요."}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            {err("problemIds")}
            {privateError ? (
              <p className="error-message" role="status">
                {privateError} 공개 문제는 그대로 고를 수 있어요.
              </p>
            ) : null}
            <span className="field-help">
              선택한 순서대로 출제됩니다. 이 테스트에서만 쓸 문제는{" "}
              <Link to="/problems/new?private=1">기업 전용 문제로 만들어</Link>{" "}
              함께 고를 수 있어요.
            </span>
          </section>
        </div>

        <section className="form-card ent-card ent-access" aria-labelledby="ent-access">
          <h2 id="ent-access">응시 대상</h2>
          <div className="form-stack">
            <fieldset className="ent-access-choice">
              <legend className="sr-only">응시할 수 있는 사람</legend>
              <label className="check-row">
                <input
                  type="radio"
                  name="ent-access"
                  checked={!draft.inviteOnly}
                  onChange={() => patch({ inviteOnly: false })}
                />
                링크를 아는 로그인 사용자 누구나
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="ent-access"
                  checked={draft.inviteOnly}
                  onChange={() => patch({ inviteOnly: true })}
                />
                초대한 사람만
              </label>
            </fieldset>
            {draft.inviteOnly ? (
              <div className="field-group">
                <div className="label-row">
                  <label className="field-label" htmlFor={fieldIds.invitees}>
                    초대할 사람
                  </label>
                  <span className="field-help" aria-live="polite">
                    {parseInvitees(draft.invitees).length} / {LIMITS.maxInvitees}명
                  </span>
                </div>
                <textarea
                  id={fieldIds.invitees}
                  rows={5}
                  value={draft.invitees}
                  placeholder={"사용자 이름 또는 이메일\n예: kim_dev, lee@example.com"}
                  onChange={(event) => patch({ invitees: event.target.value })}
                  {...aria("invitees")}
                />
                <span className="field-help">
                  줄바꿈이나 쉼표로 구분해요. 이메일로 초대하면 그 이메일로 가입한 계정이 응시할 수 있어요.
                </span>
                {err("invitees")}
              </div>
            ) : null}
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.showScoreToCandidates}
                onChange={(event) => patch({ showScoreToCandidates: event.target.checked })}
              />
              응시를 마친 사람에게 자기 점수와 문제별 정답 여부 보여 주기
            </label>
          </div>
        </section>

        <div className="ent-form-actions">
          <Link
            className="button button-outline"
            to={existing ? `/enterprise/${existing.id}` : "/enterprise"}
          >
            취소
          </Link>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "저장하는 중…" : existing ? "변경 저장" : "테스트 만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}
