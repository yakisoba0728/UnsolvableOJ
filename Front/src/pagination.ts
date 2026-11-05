import { api, ApiError } from "./api";
import type { Page } from "./types";

const PAGE_LIMIT = 1000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 서버가 알려 준 모든 페이지를 읽는다. 일부만 받은 목록을 전체인 것처럼 돌려주지 않는다. */
export async function fetchAll<T>(
  path: string,
  signal: AbortSignal,
  token?: string,
): Promise<T[]> {
  const items: T[] = [];
  const seenIds = new Set<string | number>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    let data: Page<T>;
    for (let retry = 0; ; retry += 1) {
      signal.throwIfAborted();
      try {
        data = await api<Page<T>>(
          `${path}${separator}${cursor === undefined ? `page=${page}` : `cursor=${encodeURIComponent(cursor)}`}&limit=${PAGE_LIMIT}`,
          { signal },
          token,
        );
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 429 || retry >= 3)
          throw error;
        await wait(error.retryAfterMs ?? 60_000, signal);
      }
    }
    signal.throwIfAborted();
    if (
      !Array.isArray(data.items) ||
      !Number.isSafeInteger(data.totalPages) ||
      data.totalPages < 0
    )
      throw new Error("목록 페이지 정보를 확인할 수 없습니다.");
    for (const item of data.items) {
      const id =
        item && typeof item === "object" && "id" in item ? item.id : undefined;
      if (typeof id === "string" || typeof id === "number") {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      items.push(item);
    }
    if (data.nextCursor !== undefined) {
      if (data.nextCursor === null) return items;
      if (
        typeof data.nextCursor !== "string" ||
        !data.nextCursor ||
        seenCursors.has(data.nextCursor) ||
        data.items.length === 0
      )
        throw new Error("목록 커서가 진행되지 않습니다. 다시 시도해 주세요.");
      seenCursors.add(data.nextCursor);
      cursor = data.nextCursor;
      continue;
    }
    if (cursor !== undefined)
      throw new Error("목록 커서 정보를 확인할 수 없습니다.");
    // shortcut: 오프셋 페이지는 읽는 사이 항목이 추가·삭제되면 밀릴 수 있다. 안정적으로 순회하려면 백엔드 커서가 필요하다.
    if (data.items.length === 0 && page < data.totalPages)
      throw new Error("목록 일부를 불러오지 못했습니다. 다시 시도해 주세요.");
    if (page >= data.totalPages) return items;
  }
}
