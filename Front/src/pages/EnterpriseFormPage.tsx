import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import {
  LIMITS,
  draftToInput,
  testStatus,
  toLocalInput,
  validateDraft,
  type EnterpriseTest,
  type TestDraft,
  type TestErrors,
} from "../enterprise/model";
import { enterpriseActions, useEnterpriseTests } from "../enterprise/store";
import { useAllProblems, useDocumentTitle } from "../hooks";
import { difficultyLabel } from "../difficulty";

const fieldIds: Record<keyof TestErrors, string> = {
  title: "ent-title",
  startsAt: "ent-start",
  endsAt: "ent-end",
  durationMin: "ent-duration",
  problemIds: "ent-problems",
  description: "ent-description",
};
const fieldOrder: (keyof TestErrors)[] = [
  "title",
  "startsAt",
  "endsAt",
  "durationMin",
  "problemIds",
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
  const tests = useEnterpriseTests(session?.user.id);
  const existing = id ? tests.find((test) => test.id === id) : undefined;
  useDocumentTitle(id ? "테스트 편집" : "새 테스트 만들기");

  if (!session)
    return (
      <Notice title="새 테스트 만들기">
        <strong>로그인하고 코드 테스트를 만들어 보세요</strong>
        <Link className="button" to="/auth" state={{ from: "/enterprise/new" }}>
          로그인하기 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  if (id && !existing)
    return (
      <Notice title="테스트 편집">
        <strong>테스트를 찾을 수 없어요</strong>
        <p>삭제되었거나 이 브라우저에서 만든 테스트가 아닙니다.</p>
        <Link className="button" to="/enterprise">
          기업 테스트로 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  if (existing && testStatus(existing) !== "scheduled")
    return (
      <Notice title="테스트 편집">
        <strong>시작된 테스트는 수정할 수 없어요</strong>
        <p>응시 기간이 시작된 뒤에는 출제 문제와 기간을 바꿀 수 없습니다.</p>
        <Link className="button" to={`/enterprise/${existing.id}`}>
          상세 보기 <span aria-hidden="true">→</span>
        </Link>
      </Notice>
    );
  return <TestForm key={existing?.id ?? "new"} userId={session.user.id} existing={existing} />;
}

function TestForm({ userId, existing }: { userId: string; existing?: EnterpriseTest }) {
  const navigate = useNavigate();
  const { problems, loading, error } = useAllProblems();
  const [draft, setDraft] = useState(() => initialDraft(existing));
  const [query, setQuery] = useState("");
  const [showErrors, setShowErrors] = useState(false);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    const found = validateDraft(draft);
    const first = fieldOrder.find((key) => found[key]);
    if (first) {
      document.getElementById(fieldIds[first])?.focus();
      return;
    }
    const input = draftToInput(draft);
    if (existing) {
      enterpriseActions.update(userId, existing.id, input);
      navigate(`/enterprise/${existing.id}`);
    } else navigate(`/enterprise/${enterpriseActions.create(userId, input).id}`);
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
      <PageHeader
        title={existing ? "테스트 편집" : "새 테스트 만들기"}
        description="테스트 정보를 입력하고 출제할 문제를 고릅니다."
        back={{ to: existing ? `/enterprise/${existing.id}` : "/enterprise", label: existing ? "테스트 상세" : "기업 테스트" }}
      />
      <form className="ent-form" onSubmit={submit} noValidate>
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
                  <input
                    id={fieldIds.startsAt}
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={(event) => patch({ startsAt: event.target.value })}
                    {...aria("startsAt")}
                  />
                  {err("startsAt")}
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor={fieldIds.endsAt}>
                    종료 일시
                  </label>
                  <input
                    id={fieldIds.endsAt}
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={(event) => patch({ endsAt: event.target.value })}
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
            <span className="field-help">선택한 순서대로 출제됩니다.</span>
          </section>
        </div>

        <div className="ent-form-actions">
          <Link
            className="button button-outline"
            to={existing ? `/enterprise/${existing.id}` : "/enterprise"}
          >
            취소
          </Link>
          <button className="button" type="submit">
            {existing ? "변경 저장" : "테스트 만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}
