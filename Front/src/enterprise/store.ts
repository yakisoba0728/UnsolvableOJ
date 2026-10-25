import { useSyncExternalStore } from "react";
import type { EnterpriseTest, TestInput } from "./model";

/**
 * 기업 테스트는 아직 서버 저장소가 없어, 만든 계정별로 이 브라우저에만 저장한다.
 * (서버에 테스트 API가 생기면 이 파일을 API 호출로 바꾼다.)
 */
type Data = Record<string, EnterpriseTest[]>;

const storageKey = "unsolvable-oj-enterprise-v1";
const EMPTY: EnterpriseTest[] = [];

const isTest = (value: unknown): value is EnterpriseTest => {
  const test = value as Partial<EnterpriseTest> | null;
  return (
    !!test &&
    typeof test.id === "string" &&
    typeof test.title === "string" &&
    typeof test.description === "string" &&
    typeof test.startsAt === "string" &&
    typeof test.endsAt === "string" &&
    Number.isFinite(Date.parse(test.startsAt)) &&
    Number.isFinite(Date.parse(test.endsAt)) &&
    Number.isFinite(test.durationMin) &&
    Array.isArray(test.problemIds) &&
    test.problemIds.every((id) => typeof id === "string")
  );
};

/** 저장소를 읽을 수 없으면 null: 부르는 쪽이 메모리의 값을 계속 쓴다. */
function load(): Data | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([user, list]) => [
        user,
        Array.isArray(list) ? list.filter(isTest) : [],
      ]),
    );
  } catch {
    return null;
  }
}

let state = load() ?? {};
const listeners = new Set<() => void>();

// 다른 탭에서 바뀐 목록 위에 고쳐 써야 그 탭의 변경을 덮어쓰지 않는다.
function commit(update: (current: Data) => Data) {
  const next = update(load() ?? state);
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 반영한다 */
  }
  listeners.forEach((listener) => listener());
}

// 다른 탭의 변경은 기업 테스트 화면을 벗어난 동안에도 반영한다.
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

export function useEnterpriseTests(userId: string | undefined) {
  const data = useSyncExternalStore(subscribe, () => state);
  return userId ? (data[userId] ?? EMPTY) : EMPTY;
}

export const enterpriseActions = {
  create(userId: string, input: TestInput): EnterpriseTest {
    const now = new Date().toISOString();
    const test: EnterpriseTest = {
      id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    commit((current) => ({ ...current, [userId]: [test, ...(current[userId] ?? [])] }));
    return test;
  },
  update(userId: string, id: string, input: TestInput) {
    commit((current) => ({
      ...current,
      [userId]: (current[userId] ?? []).map((test) =>
        test.id === id
          ? { ...test, ...input, updatedAt: new Date().toISOString() }
          : test,
      ),
    }));
  },
  remove(userId: string, id: string) {
    commit((current) => ({
      ...current,
      [userId]: (current[userId] ?? []).filter((test) => test.id !== id),
    }));
  },
};
