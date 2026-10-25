import { useSyncExternalStore } from "react";

/** 코드 분석에서 답을 확인한 기록. 서버에 저장소가 생기기 전까지 이 브라우저에만 남는다. */
export interface AnalysisAttempt {
  /** 비로그인은 "guest" */
  userId: string;
  questionId: string;
  correct: boolean;
  /** 고른 보기의 번호. 다시 열었을 때 결과를 그대로 보여 주는 데 쓴다. */
  selected?: number;
  at: string;
}

const storageKey = "unsolvable-oj-analysis-v1";
const MAX_ATTEMPTS = 500;

const isAttempt = (value: unknown): value is AnalysisAttempt => {
  const attempt = value as Partial<AnalysisAttempt> | null;
  return (
    !!attempt &&
    typeof attempt.userId === "string" &&
    typeof attempt.questionId === "string" &&
    typeof attempt.correct === "boolean" &&
    typeof attempt.at === "string" &&
    (attempt.selected === undefined || typeof attempt.selected === "number")
  );
};

/** 모양이 맞지 않는 기록은 버린다. 저장소를 읽을 수 없으면 null: 부르는 쪽이 메모리의 값을 계속 쓴다. */
function load(): AnalysisAttempt[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isAttempt) : [];
  } catch {
    return null;
  }
}

let state = load() ?? [];
const listeners = new Set<() => void>();

// 다른 탭의 기록은 코드 분석 화면을 벗어난 동안에도 반영한다.
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  state = load() ?? state;
  listeners.forEach((listener) => listener());
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useAnalysisAttempts = () =>
  useSyncExternalStore(subscribe, () => state);

export function recordAnalysisAttempt(
  userId: string,
  questionId: string,
  correct: boolean,
  selected: number,
) {
  // 다른 탭에서 남긴 기록 위에 더해야 그 기록을 덮어쓰지 않는다.
  state = [
    ...(load() ?? state),
    { userId, questionId, correct, selected, at: new Date().toISOString() },
  ].slice(-MAX_ATTEMPTS);
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 반영한다 */
  }
  listeners.forEach((listener) => listener());
}

/** 목록의 풀이 상태: 한 번이라도 맞혔으면 해결, 시도만 했으면 풀이 중. */
export function analysisStatus(attempts: AnalysisAttempt[], userId: string) {
  const solved = new Set<string>();
  const attempted = new Set<string>();
  const latest = new Map<string, AnalysisAttempt>();
  for (const item of attempts) {
    if (item.userId !== userId) continue;
    attempted.add(item.questionId);
    if (item.correct) solved.add(item.questionId);
    latest.set(item.questionId, item);
  }
  return { solved, attempted, latest };
}
