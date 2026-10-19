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

function load(): Data {
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
    return {};
  }
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: Data) {
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 반영한다 */
  }
  listeners.forEach((listener) => listener());
}

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
    commit({ ...state, [userId]: [test, ...(state[userId] ?? [])] });
    return test;
  },
  update(userId: string, id: string, input: TestInput) {
    commit({
      ...state,
      [userId]: (state[userId] ?? []).map((test) =>
        test.id === id
          ? { ...test, ...input, updatedAt: new Date().toISOString() }
          : test,
      ),
    });
  },
  remove(userId: string, id: string) {
    commit({
      ...state,
      [userId]: (state[userId] ?? []).filter((test) => test.id !== id),
    });
  },
};
