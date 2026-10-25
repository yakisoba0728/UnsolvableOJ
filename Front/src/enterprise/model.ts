export interface EnterpriseTest {
  id: string;
  title: string;
  /** 응시자에게 보여 줄 안내 문구 (선택) */
  description: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  /** 출제 순서대로의 문제 id */
  problemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type TestStatus = "scheduled" | "running" | "closed";

export const statusLabel: Record<TestStatus, string> = {
  scheduled: "예정",
  running: "진행 중",
  closed: "마감",
};

export const LIMITS = {
  title: 60,
  description: 300,
  minDuration: 10,
  maxDuration: 600,
  maxProblems: 20,
} as const;

export function testStatus(
  test: Pick<EnterpriseTest, "startsAt" | "endsAt">,
  now = Date.now(),
): TestStatus {
  if (now < Date.parse(test.startsAt)) return "scheduled";
  return now < Date.parse(test.endsAt) ? "running" : "closed";
}

/** 응시 기간 중 지난 비율 (0~1) */
export function periodProgress(
  test: Pick<EnterpriseTest, "startsAt" | "endsAt">,
  now = Date.now(),
) {
  const start = Date.parse(test.startsAt);
  const end = Date.parse(test.endsAt);
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

const pad = (value: number) => String(value).padStart(2, "0");

type Period = Pick<EnterpriseTest, "startsAt" | "endsAt">;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const dateText = (date: Date) => `${date.getMonth() + 1}월${date.getDate()}일`;
const timeText = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** 시작과 마감이 같은 날이면 하루짜리 테스트다. */
export const isSingleDay = (test: Period) =>
  sameDay(new Date(test.startsAt), new Date(test.endsAt));

/** 응시 기간 글자: 여러 날이면 "10월18일부터, 10월23일까지", 하루짜리면 "10월20일 14:00부터, 18:30까지" */
export function formatPeriod(test: Period) {
  const start = new Date(test.startsAt);
  const end = new Date(test.endsAt);
  return sameDay(start, end)
    ? `${dateText(start)} ${timeText(start)}부터, ${timeText(end)}까지`
    : `${dateText(start)}부터, ${dateText(end)}까지`;
}

/** "오후 2시", "오전 9시 30분" */
function clockWords(date: Date) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour < 12 ? "오전" : "오후"} ${hour12}시${minute ? ` ${minute}분` : ""}`;
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * 시작 시점 글자. 오늘·내일 시작하면 "오늘 오후 7시", "내일 오후 2시"처럼 말로 쓰고,
 * 그 밖에는 날짜만(하루짜리 테스트는 시간까지) 보여 준다.
 */
export function formatStart(test: Period, now = Date.now()) {
  const start = new Date(test.startsAt);
  const days = Math.round(
    (startOfDay(start) - startOfDay(new Date(now))) / 86_400_000,
  );
  if (days === 0) return `오늘 ${clockWords(start)}`;
  if (days === 1) return `내일 ${clockWords(start)}`;
  return isSingleDay(test)
    ? `${dateText(start)} ${timeText(start)}`
    : dateText(start);
}

/** 마감 시점 글자: 하루짜리만 시간을 붙인다. */
export function formatEnd(test: Period) {
  const end = new Date(test.endsAt);
  return isSingleDay(test) ? `${dateText(end)} ${timeText(end)}` : dateText(end);
}

/** `<input type="datetime-local">` 값 */
export function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function remainingText(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`;
  return `${minutes}분`;
}

export const metaLine = (test: Pick<EnterpriseTest, "problemIds" | "durationMin">) =>
  `${test.problemIds.length}문항 · ${test.durationMin}분`;

/** 폼에서 편집 중인 값. 날짜는 datetime-local 문자열, 시간은 입력 그대로의 문자열이다. */
export interface TestDraft {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationMin: string;
  problemIds: string[];
}

export type TestErrors = Partial<
  Record<
    "title" | "startsAt" | "endsAt" | "durationMin" | "problemIds" | "description",
    string
  >
>;

const parseLocal = (value: string) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? null : time;
};

export function validateDraft(draft: TestDraft, now = Date.now()): TestErrors {
  const errors: TestErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "테스트 이름을 입력해 주세요.";
  else if (title.length > LIMITS.title)
    errors.title = `테스트 이름은 ${LIMITS.title}자 이하로 입력해 주세요.`;

  const start = parseLocal(draft.startsAt);
  const end = parseLocal(draft.endsAt);
  if (start === null) errors.startsAt = "시작 일시를 입력해 주세요.";
  if (end === null) errors.endsAt = "종료 일시를 입력해 주세요.";
  else if (start !== null && end <= start)
    errors.endsAt = "종료 일시는 시작 일시보다 늦어야 해요.";
  else if (end <= now) errors.endsAt = "종료 일시는 지금보다 이후여야 해요.";

  const duration = Number(draft.durationMin);
  if (
    draft.durationMin.trim() === "" ||
    !Number.isInteger(duration) ||
    duration < LIMITS.minDuration ||
    duration > LIMITS.maxDuration
  )
    errors.durationMin = `제한 시간은 ${LIMITS.minDuration}~${LIMITS.maxDuration}분 사이의 정수로 입력해 주세요.`;
  else if (start !== null && end !== null && end > start && duration * 60_000 > end - start)
    errors.durationMin = "제한 시간은 응시 기간보다 길 수 없어요.";

  if (draft.problemIds.length === 0)
    errors.problemIds = "출제할 문제를 하나 이상 골라 주세요.";
  else if (draft.problemIds.length > LIMITS.maxProblems)
    errors.problemIds = `문제는 최대 ${LIMITS.maxProblems}개까지 고를 수 있어요.`;

  if (draft.description.length > LIMITS.description)
    errors.description = `안내 문구는 ${LIMITS.description}자 이하로 입력해 주세요.`;
  return errors;
}

/** 검증을 통과한 폼 값을 저장 형태로 바꾼다. */
export function draftToInput(draft: TestDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    startsAt: new Date(draft.startsAt).toISOString(),
    endsAt: new Date(draft.endsAt).toISOString(),
    durationMin: Number(draft.durationMin),
    problemIds: draft.problemIds,
  };
}

export type TestInput = ReturnType<typeof draftToInput>;

/** 진행 중 → 예정(가까운 순) → 마감(최근 순) */
export function sortTests(tests: EnterpriseTest[], now = Date.now()) {
  const rank: Record<TestStatus, number> = { running: 0, scheduled: 1, closed: 2 };
  return [...tests].sort((a, b) => {
    const sa = testStatus(a, now);
    const sb = testStatus(b, now);
    if (sa !== sb) return rank[sa] - rank[sb];
    return sa === "closed"
      ? Date.parse(b.endsAt) - Date.parse(a.endsAt)
      : Date.parse(a.startsAt) - Date.parse(b.startsAt);
  });
}
