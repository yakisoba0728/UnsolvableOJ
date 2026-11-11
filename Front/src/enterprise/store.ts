import { useSyncExternalStore } from "react";
import { testStatus, type EnterpriseTest, type TestInput } from "./model";

/**
 * 기업 테스트는 아직 서버 저장소가 없어, 만든 계정별로 이 브라우저에만 저장한다.
 * (서버에 테스트 API가 생기면 이 파일을 API 호출로 바꾼다.)
 */
type Data = Record<string, EnterpriseTest[]>;

const storageKey = "unsolvable-oj-enterprise-v1";

/** 저장소에 쓰지 못했을 때의 안내. 폼은 입력을 그대로 둔다. */
export const SAVE_FAILED =
  "이 브라우저에 저장하지 못했어요. 입력한 내용은 유지했으니 저장 공간·권한을 확인하고 다시 시도해 주세요.";
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
function commit(update: (current: Data) => Data | null) {
  const current = load();
  // A failed read must not overwrite records belonging to another tab/account.
  if (!current) return false;
  const next = update(current);
  if (!next) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    return false;
  }
  state = next;
  listeners.forEach((listener) => listener());
  return true;
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
  create(userId: string, input: TestInput): EnterpriseTest | null {
    const now = new Date().toISOString();
    const test: EnterpriseTest = {
      id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    return commit((current) => ({ ...current, [userId]: [test, ...(current[userId] ?? [])] })) ? test : null;
  },
  /** 성공은 null, 실패는 입력을 유지한 채 표시할 오류 메시지다. */
  update(userId: string, original: EnterpriseTest, input: TestInput): string | null {
    let error = SAVE_FAILED;
    // shortcut: localStorage read/compare/write is not atomic across tabs; use server transactions when simultaneous writes must be serialized.
    const saved = commit((current) => {
      const latest = current[userId]?.find((test) => test.id === original.id);
      if (!latest) {
        error = "다른 탭에서 테스트가 삭제되었어요. 입력한 내용은 유지했지만 저장할 수 없어요.";
        return null;
      }
      if (testStatus(latest) !== "scheduled") {
        error = "시작된 테스트는 수정할 수 없어요. 입력한 내용은 유지했지만 저장할 수 없어요.";
        return null;
      }
      if (JSON.stringify(latest) !== JSON.stringify(original)) {
        error = "다른 탭에서 테스트가 변경되었어요. 입력한 내용은 유지했으니 최신 내용을 다시 확인해 주세요.";
        return null;
      }
      return {
        ...current,
        [userId]: current[userId].map((test) =>
          test.id === original.id
            ? { ...test, ...input, updatedAt: new Date().toISOString() }
            : test,
        ),
      };
    });
    return saved ? null : error;
  },
  remove(userId: string, id: string) {
    return commit((current) => {
      if (!current[userId]?.some((test) => test.id === id)) return null;
      return {
        ...current,
        [userId]: current[userId].filter((test) => test.id !== id),
      };
    });
  },
};
