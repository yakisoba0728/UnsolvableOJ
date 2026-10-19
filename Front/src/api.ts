const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  // 백엔드가 없거나 주소가 틀리면 SPA의 index.html(200)이 돌아온다. 빈 값을 성공으로 넘기지 않는다.
  if (response.ok && data === null)
    throw new ApiError(
      response.status,
      "서버 응답을 확인할 수 없습니다. 백엔드 주소(VITE_API_BASE_URL) 설정을 확인해 주세요.",
    );
  if (!response.ok) {
    const detail = data?.message;
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const retryAfterMs = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : retryAfter && Number.isFinite(Date.parse(retryAfter))
        ? Math.max(0, Date.parse(retryAfter) - Date.now())
        : undefined;
    throw new ApiError(
      response.status,
      Array.isArray(detail)
        ? detail.join(", ")
        : (detail ?? `요청에 실패했습니다 (${response.status}).`),
      retryAfterMs,
    );
  }
  return data as T;
}
