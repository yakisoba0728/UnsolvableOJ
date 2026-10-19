import { useSyncExternalStore } from "react";

/** 코드 분석에서 답을 확인한 기록. 서버에 저장소가 생기기 전까지 이 브라우저에만 남는다. */
export interface AnalysisAttempt {
  /** 비로그인은 "guest" */
  userId: string;
  questionId: string;
  correct: boolean;
  at: string;
}

const storageKey = "unsolvable-oj-analysis-v1";
const MAX_ATTEMPTS = 500;

function load(): AnalysisAttempt[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AnalysisAttempt[]) : [];
  } catch {
    return [];
  }
}

let state = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      state = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const useAnalysisAttempts = () =>
  useSyncExternalStore(subscribe, () => state);

export function recordAnalysisAttempt(
  userId: string,
  questionId: string,
  correct: boolean,
) {
  state = [
    ...state,
    { userId, questionId, correct, at: new Date().toISOString() },
  ].slice(-MAX_ATTEMPTS);
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 반영한다 */
  }
  listeners.forEach((listener) => listener());
}

export interface AnalysisAnswer {
  selected: number;
  correct: boolean;
}

/** 진행 중인 풀이. 다른 메뉴에 다녀오거나 새로고침해도 이어 풀 수 있게 사용자별로 저장한다. */
export interface AnalysisSession {
  questionIds: string[];
  index: number;
  picked: number | null;
  answers: (AnalysisAnswer | undefined)[];
  finished: boolean;
  /** 이 화면에 머문 시간(초). 화면을 떠나 있는 동안에는 늘지 않는다. */
  elapsed: number;
}

const sessionKey = "unsolvable-oj-analysis-session-v1";

function readSessions(): Record<string, AnalysisSession> {
  try {
    const raw = localStorage.getItem(sessionKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, AnalysisSession>)
      : {};
  } catch {
    return {};
  }
}

/** 저장된 풀이를 돌려준다. 문제 구성이 바뀌었거나 값이 깨졌으면 버린다. */
export function loadAnalysisSession(
  userId: string,
  questionIds: string[],
): AnalysisSession | null {
  const saved = readSessions()[userId];
  if (
    !saved ||
    !Array.isArray(saved.questionIds) ||
    saved.questionIds.join() !== questionIds.join() ||
    !Array.isArray(saved.answers) ||
    saved.answers.length !== questionIds.length ||
    !Number.isInteger(saved.index) ||
    saved.index < 0 ||
    saved.index >= questionIds.length ||
    !Number.isFinite(saved.elapsed)
  )
    return null;
  return {
    ...saved,
    picked: saved.picked ?? null,
    // JSON 배열에서 빈 칸은 null로 저장되므로 되돌린다.
    answers: saved.answers.map((answer) => answer ?? undefined),
  };
}

export function saveAnalysisSession(userId: string, session: AnalysisSession) {
  try {
    localStorage.setItem(
      sessionKey,
      JSON.stringify({ ...readSessions(), [userId]: session }),
    );
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 계속 풀 수 있다 */
  }
}
