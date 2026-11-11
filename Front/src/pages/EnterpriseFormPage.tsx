import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { DateTimePicker } from "../components/DateTimePicker";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { PageHeader } from "../components/PageHeader";
import {
  EnterpriseNotice,
  NoticeAction,
  TestNotFound,
} from "../enterprise/EnterpriseNotice";
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
import {
  SAVE_FAILED,
  enterpriseActions,
  useEnterpriseTests,
} from "../enterprise/store";
import { useAllProblems, useDocumentTitle } from "../hooks";
import type { ProblemSummary } from "../types";

type FieldKey = keyof TestErrors;

/** 입력 칸의 id. 적힌 순서가 화면 순서이자, 오류가 있을 때 포커스를 옮기는 순서다. */
const fieldIds: Record<FieldKey, string> = {
  title: "ent-title",
  startsAt: "ent-start",
  endsAt: "ent-end",
  durationMin: "ent-duration",
  problemIds: "ent-problems",
  description: "ent-description",
};
const fieldOrder = Object.keys(fieldIds) as FieldKey[];

const DEFAULT_DURATION_MIN = 90;
const DEFAULT_PERIOD_DAYS = 7;

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
  // 새 테스트는 다음 정각에 시작해 일주일 동안 연다.
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + DEFAULT_PERIOD_DAYS * 86_400_000);
  return {
    title: "",
    description: "",
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    durationMin: String(DEFAULT_DURATION_MIN),
    problemIds: [],
  };
}

export function EnterpriseFormPage() {
  const { id } = useParams();
  const { session } = useAuth();
  useDocumentTitle(id ? "테스트 편집" : "새 테스트 만들기");

  if (!session)
    return (
      <EnterpriseNotice title="새 테스트 만들기">
        <strong>로그인하고 코드 테스트를 만들어 보세요</strong>
        <NoticeAction
          to="/auth"
          from={id ? `/enterprise/${id}/edit` : "/enterprise/new"}
        >
          로그인하기
        </NoticeAction>
      </EnterpriseNotice>
    );
  // 계정이나 주소가 바뀔 때만 새 폼을 연다. 다른 탭의 변경으로 작성 중인 입력을 버리지 않는다.
  return (
    <EnterpriseForm
      key={`${session.user.id}:${id ?? "new"}`}
      userId={session.user.id}
      id={id}
    />
  );
}

function EnterpriseForm({ userId, id }: { userId: string; id?: string }) {
  const tests = useEnterpriseTests(userId);
  // 폼을 연 순간의 테스트와 수정 가능 여부로 고정한다.
  // (다른 탭에서 바뀌거나 편집 중에 시작 시각이 지나도 입력 중인 폼을 갈아엎지 않는다. 저장할 때 다시 확인한다.)
  const [{ existing, editable }] = useState(() => {
    const found = id ? tests.find((test) => test.id === id) : undefined;
    return {
      existing: found,
      editable: !found || testStatus(found) === "scheduled",
    };
  });
  if (id && !existing) return <TestNotFound title="테스트 편집" />;
  if (existing && !editable)
    return (
      <EnterpriseNotice title="테스트 편집">
        <strong>시작된 테스트는 수정할 수 없어요</strong>
        <p>응시 기간이 시작된 뒤에는 출제 문제와 기간을 바꿀 수 없습니다.</p>
        <NoticeAction to={`/enterprise/${existing.id}`}>상세 보기</NoticeAction>
      </EnterpriseNotice>
    );
  return <TestForm userId={userId} existing={existing} />;
}

function TestForm({
  userId,
  existing,
}: {
  userId: string;
  existing?: EnterpriseTest;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => initialDraft(existing));
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState("");
  const errors = showErrors ? validateDraft(draft) : {};
  const patch = (next: Partial<TestDraft>) =>
    setDraft((prev) => ({ ...prev, ...next }));
  const backTo = existing ? `/enterprise/${existing.id}` : "/enterprise";

  /** 성공하면 저장한 테스트의 id, 실패하면 오류를 보이고 null */
  function save(): string | null {
    const input = draftToInput(draft);
    if (existing) {
      const error = enterpriseActions.update(userId, existing, input);
      if (error) setSaveError(error);
      return error ? null : existing.id;
    }
    const created = enterpriseActions.create(userId, input);
    if (!created) setSaveError(SAVE_FAILED);
    return created?.id ?? null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaveError("");
    setShowErrors(true);
    const found = validateDraft(draft);
    const first = fieldOrder.find((key) => found[key]);
    if (first) {
      document.getElementById(fieldIds[first])?.focus();
      return;
    }
    const savedId = save();
    if (savedId) navigate(`/enterprise/${savedId}`);
  }

  const err = (key: FieldKey) =>
    errors[key] ? (
      <p className="field-error" id={`${fieldIds[key]}-error`}>
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: FieldKey) => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${fieldIds[key]}-error` : undefined,
  });

  return (
    <div className="page-width enterprise-page">
      {saveError ? (
        <p className="error-message" role="alert">
          {saveError}
        </p>
      ) : null}
      <PageHeader
        title={existing ? "테스트 편집" : "새 테스트 만들기"}
        description="테스트 정보를 입력하고 출제할 문제를 고릅니다."
        back={{
          to: backTo,
          label: existing ? "테스트 상세" : "기업 테스트",
        }}
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
                  // 넘친 글자를 잘라 버리지 않고 오류로 알려 주도록 조금 더 받는다.
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
            <ProblemPicker
              selected={draft.problemIds}
              onChange={(problemIds) => patch({ problemIds })}
              groupProps={{ id: fieldIds.problemIds, ...aria("problemIds") }}
            />
            {err("problemIds")}
            <span className="field-help">선택한 순서대로 출제됩니다.</span>
          </section>
        </div>

        <div className="ent-form-actions">
          <Link className="button button-outline" to={backTo}>
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

/** 공개 문제를 검색해 고른다. 고른 순서가 출제 순서다. */
function ProblemPicker({
  selected,
  onChange,
  groupProps,
}: {
  selected: string[];
  onChange: (problemIds: string[]) => void;
  /** 검증 오류를 잇고 포커스를 받을 수 있도록 묶음에 붙이는 속성 */
  groupProps: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  };
}) {
  const { problems, loading, error } = useAllProblems();
  const [query, setQuery] = useState("");
  const known = new Set(problems.map((problem) => problem.id));
  // 고른 뒤 비공개·삭제된 문제도 목록에 남겨 직접 뺄 수 있게 한다.
  const orphans = loading ? [] : selected.filter((id) => !known.has(id));
  const needle = query.trim().toLowerCase();
  const visible = problems.filter(
    (problem) =>
      !needle ||
      problem.title.toLowerCase().includes(needle) ||
      problem.slug.toLowerCase().includes(needle),
  );
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );

  return (
    <>
      <input
        type="search"
        aria-label="문제 검색"
        placeholder="문제 이름으로 검색"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        className="ent-problems"
        tabIndex={-1}
        role="group"
        aria-label="출제할 문제"
        {...groupProps}
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
              <ProblemOption
                key={problem.id}
                problem={problem}
                checked={selected.includes(problem.id)}
                onToggle={() => toggle(problem.id)}
              />
            ))}
            {visible.length === 0 && orphans.length === 0 ? (
              <p className="muted">
                {problems.length ? "검색 결과가 없어요." : "공개된 문제가 아직 없어요."}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function ProblemOption({
  problem,
  checked,
  onToggle,
}: {
  problem: ProblemSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="ent-problem">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="ent-problem-title">{problem.title}</span>
      <DifficultyBadge difficulty={problem.difficulty} />
    </label>
  );
}
