const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
export const unauthorizedEvent = "unsolvable-oj:unauthorized";

type TokenRefresher = (staleToken: string) => Promise<string | null>;
let refreshAccessToken: TokenRefresher | null = null;
/** auth.tsx가 등록한다. null은 새 토큰을 받을 수 없다는 뜻(로그아웃), 예외는 일시 오류(세션 유지)다. */
export function setTokenRefresher(refresher: TokenRefresher | null) {
  refreshAccessToken = refresher;
}

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
  retried = false,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  }).catch((cause: unknown) => {
    // 연결 실패는 브라우저마다 다른 영어 문구("Failed to fetch")의 TypeError다. 화면에 그대로 보이지 않게 바꾸되,
    // 일시 오류로 다시 시도하는 쪽(JudgeResult)이 구분할 수 있도록 TypeError는 유지한다. 취소(AbortError)는 그대로 둔다.
    if (cause instanceof TypeError)
      throw new TypeError("서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.");
    throw cause;
  });
  // 본문 없는 성공(로그아웃·기기 로그아웃의 204)은 SPA 대체 응답과 구분해 그대로 성공으로 본다.
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  // 백엔드가 없거나 주소가 틀리면 SPA의 index.html(200)이 돌아온다. 빈 값을 성공으로 넘기지 않는다.
  if (response.ok && data === null)
    throw new ApiError(
      response.status,
      "서버 응답을 확인할 수 없습니다. 백엔드 주소(VITE_API_BASE_URL) 설정을 확인해 주세요.",
    );
  // 토큰이 무효가 됐다(만료·역할 변경 등). 한 번 새 토큰을 받아 다시 보내고, 받을 수 없으면 로그인 상태를 정리하도록 알린다.
  if (response.status === 401 && token) {
    const fresh =
      retried || !refreshAccessToken
        ? null
        : await refreshAccessToken(token).catch(() => undefined);
    if (fresh) return api<T>(path, options, fresh, true);
    if (fresh === null)
      window.dispatchEvent(new CustomEvent(unauthorizedEvent, { detail: token }));
  }
  if (!response.ok) {
    const detail = data?.message;
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const retryAfterMs = Number.isFinite(seconds * 1000)
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
