import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setTokenRefresher, unauthorizedEvent } from "./api";
import type { Session } from "./types";

const storageKey = "unsolvable-oj-session-v1";
const refreshLock = "unsolvable-oj-refresh";

interface SavedSession {
  session: Session;
  expiresAt: number;
}

const canRefresh = (session: Session) =>
  typeof session.refreshToken === "string" &&
  Date.parse(session.refreshTokenExpiresAt ?? "") > Date.now();

/** 저장된 세션을 만료와 관계없이 읽는다. */
function readSaved(): SavedSession | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
    if (
      saved &&
      Number.isFinite(saved.expiresAt) &&
      typeof saved.session?.accessToken === "string" &&
      typeof saved.session.user?.id === "string" &&
      typeof saved.session.user.username === "string"
    )
      return saved;
    return null;
  } catch {
    return null;
  }
}

// 읽는 쪽에서 만료된 값을 지우지 않는다: 읽는 사이 다른 탭이 새 값으로 바꿨을 수 있다.
// access token이 끝났어도 refresh token이 살아 있으면 로그인 상태로 두고 갱신한다.
function storedSession(): SavedSession | null {
  const saved = readSaved();
  return saved && (saved.expiresAt > Date.now() || canRefresh(saved.session))
    ? saved
    : null;
}

function expiryTime(session: Session): number {
  const match = /^(\d+)([smhd])$/.exec(session.expiresIn);
  if (!match) return Date.now() + 15 * 60_000;
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return (
    Date.now() + Number(match[1]) * unitMs[match[2] as keyof typeof unitMs]
  );
}

interface AuthContextValue {
  session: Session | null;
  setSession: (session: Session | null) => void;
  getSessionVersion: () => number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [saved, update] = useState<SavedSession | null>(storedSession);
  const current = useRef(saved);
  const sessionVersion = useRef(0);
  const getSessionVersion = useCallback(() => sessionVersion.current, []);
  const updateSession = useCallback((next: SavedSession | null) => {
    if (JSON.stringify(current.current) === JSON.stringify(next)) return;
    current.current = next;
    sessionVersion.current += 1;
    update(next);
  }, []);
  const setSession = useCallback((next: Session | null) => {
    const previous = (readSaved() ?? current.current)?.session;
    // 사용자 이름 변경처럼 refresh token 없이 온 같은 사용자의 세션은 지금 refresh token을 이어 쓴다.
    if (next && !next.refreshToken && previous?.refreshToken && previous.user.id === next.user.id)
      next = {
        ...next,
        refreshToken: previous.refreshToken,
        refreshTokenExpiresAt: previous.refreshTokenExpiresAt,
        remember: previous.remember,
      };
    const value = next ? { session: next, expiresAt: expiryTime(next) } : null;
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      /* 저장소를 쓸 수 없어도(쿠키 차단·용량 초과) 이번 방문의 로그인·로그아웃은 반영한다 */
    }
    updateSession(value);
  }, [updateSession]);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const refresh = useCallback(
    (staleToken: string) => {
      const run = async (): Promise<string | null> => {
        // 다른 탭이나 이 탭의 앞선 갱신이 이미 새 토큰을 받았다면 같은 refresh token을 다시 쓰지 않는다
        // (서버는 쓴 토큰이 다시 오면 탈취로 보고 그 로그인을 모두 끊는다).
        const latest = readSaved() ?? current.current;
        // 그사이 다른 계정으로 바뀌었다면 그 계정의 토큰으로 이 요청을 다시 보내지 않는다.
        const sameUser = (other: SavedSession) =>
          other.session.user.id === current.current?.session.user.id;
        if (
          latest &&
          sameUser(latest) &&
          latest.session.accessToken !== staleToken &&
          latest.expiresAt > Date.now()
        ) {
          updateSession(latest);
          return latest.session.accessToken;
        }
        if (!latest || !sameUser(latest) || !canRefresh(latest.session)) return null;
        const used = latest.session.refreshToken;
        try {
          const next = await api<Session>("/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken: used }),
          });
          setSession(next);
          return next.accessToken;
        } catch (cause) {
          // 잠금을 못 쓰거나 다른 탭의 저장이 늦게 보이는 브라우저(Firefox)에서 다른 탭이 먼저 회전했다면 그 탭이 저장한 세션을 쓴다.
          // 아직 안 보이면 서버는 409를 주고, 세션을 지우지 않은 채 던져 storage 이벤트로 새 세션을 받는다.
          const after = readSaved();
          if (
            after &&
            sameUser(after) &&
            after.session.refreshToken !== used &&
            after.expiresAt > Date.now()
          ) {
            updateSession(after);
            return after.session.accessToken;
          }
          if (cause instanceof ApiError && (cause.status === 400 || cause.status === 401)) {
            if (current.current?.session.refreshToken === used) setSession(null);
            return null;
          }
          throw cause;
        }
      };
      // 탭 안에서는 진행 중인 갱신을 함께 기다리고, 탭 사이에서는 Web Locks로 한 번에 하나만 갱신한다.
      refreshing.current ??= ("locks" in navigator
        ? navigator.locks.request(refreshLock, run)
        : run()
      ).finally(() => {
        refreshing.current = null;
      });
      return refreshing.current;
    },
    [setSession, updateSession],
  );
  useEffect(() => {
    setTokenRefresher(refresh);
    return () => setTokenRefresher(null);
  }, [refresh]);
  useEffect(() => {
    // 이미 다른 토큰으로 바뀐 뒤 늦게 도착한 401은 새 로그인을 지우지 않는다.
    const signOut = (event: Event) => {
      if ((event as CustomEvent<string>).detail === current.current?.session.accessToken)
        setSession(null);
    };
    window.addEventListener(unauthorizedEvent, signOut);
    return () => window.removeEventListener(unauthorizedEvent, signOut);
  }, [setSession]);
  useEffect(() => {
    const synchronize = (event?: StorageEvent) => {
      if (
        event &&
        (event.storageArea !== localStorage ||
          (event.key !== storageKey && event.key !== null))
      )
        return;
      updateSession(storedSession());
    };
    window.addEventListener("storage", synchronize);
    synchronize();
    return () => window.removeEventListener("storage", synchronize);
  }, [updateSession]);
  useEffect(() => {
    if (!saved) return;
    const refreshable = Boolean(saved.session.refreshToken);
    const timer = setTimeout(
      () => {
        // refresh token이 있으면 access token이 끝나기 1분 전에 갱신한다. 일시 오류면 다음 401에서 다시 시도한다.
        if (refreshable)
          void refresh(saved.session.accessToken).then(
            (token) => token ?? updateSession(storedSession()),
            () => {},
          );
        // storage 이벤트가 오기 전에 다른 탭이 새 세션으로 바꿨을 수 있어 저장소를 다시 읽는다.
        else updateSession(storedSession());
      },
      Math.min(
        2_147_483_647,
        Math.max(0, saved.expiresAt - (refreshable ? 60_000 : 0) - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [saved, refresh, updateSession]);
  return (
    <AuthContext.Provider
      value={{ session: saved?.session ?? null, setSession, getSessionVersion }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** 문제를 만들 수 있는 계정인지. 로그인한 누구나 출제하고, 공개는 관리자 검수를 거친다. */
export const canAuthor = (session: Session | null) => Boolean(session);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
