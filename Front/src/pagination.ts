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

/** Read every advertised page; never report a truncated list as complete. */
export async function fetchAll<T>(
  path: string,
  signal: AbortSignal,
  token?: string,
): Promise<T[]> {
  const items: T[] = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    let data: Page<T>;
    for (let retry = 0; ; retry += 1) {
      signal.throwIfAborted();
      try {
        data = await api<Page<T>>(
          `${path}${separator}page=${page}&limit=${PAGE_LIMIT}`,
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
    if (
      !Array.isArray(data.items) ||
      !Number.isSafeInteger(data.totalPages) ||
      data.totalPages < 0
    )
      throw new Error("목록 페이지 정보를 확인할 수 없습니다.");
    if (data.items.length === 0 && page < data.totalPages)
      throw new Error("목록 일부를 불러오지 못했습니다. 다시 시도해 주세요.");
    items.push(...data.items);
    if (page >= data.totalPages) return items;
  }
}
