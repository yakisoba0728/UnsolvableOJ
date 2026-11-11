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

type StorageSnapshot = { readable: boolean; saved: SavedSession | null };
/** A denied storage read is different from a logout that successfully removed the key. */
function readSavedSnapshot(): StorageSnapshot {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return { readable: false, saved: null };
  }
  try {
    const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
    if (
      saved &&
      Number.isFinite(saved.expiresAt) &&
      typeof saved.session?.accessToken === "string" &&
      typeof saved.session.user?.id === "string" &&
      typeof saved.session.user.username === "string"
    )
      return { readable: true, saved };
  } catch {
    /* Malformed stored data is readable, but is not an active login. */
  }
  return { readable: true, saved: null };
}
function readSaved() {
  return readSavedSnapshot().saved;
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

/** Client-side request lineage only; the server still verifies every JWT. */
function sameLoginFamily(
  previous: SavedSession | null,
  next: SavedSession | null,
) {
  if (!previous || !next || previous.session.user.id !== next.session.user.id)
    return false;
  if (previous.session.accessToken === next.session.accessToken) return true;
  const claims = (session: Session) => {
    try {
      const part = session.accessToken.split(".")[1];
      if (!part) return null;
      const value = JSON.parse(
        atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { sub?: unknown; sid?: unknown; tokenVersion?: unknown };
      return value.sub === session.user.id &&
        typeof value.sid === "string" &&
        value.sid.length > 0 &&
        Number.isInteger(value.tokenVersion)
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const a = claims(previous.session),
    b = claims(next.session);
  return Boolean(
    a &&
    b &&
    a.sub === b.sub &&
    a.sid === b.sid &&
    a.tokenVersion === b.tokenVersion,
  );
}

interface AuthContextValue {
  session: Session | null;
  setSession: (session: Session | null) => void;
  getSessionVersion: () => number;
  /** Changes for logout/login/account changes, but not a rotation of this login. */
  getSessionIdentityVersion: () => number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [saved, update] = useState<SavedSession | null>(storedSession);
  const current = useRef(saved);
  const memoryOnly = useRef(false);
  const failedWriteBaseline = useRef<string | undefined>(undefined);
  const sessionVersion = useRef(0);
  const identityVersion = useRef(0);
  const knownTokens = useRef(
    new Map<string, number>(saved ? [[saved.session.accessToken, 0]] : []),
  );
  const getSessionVersion = useCallback(() => sessionVersion.current, []);
  const getSessionIdentityVersion = useCallback(
    () => identityVersion.current,
    [],
  );
  const updateSession = useCallback(
    (next: SavedSession | null, preserveIdentity = false) => {
      if (JSON.stringify(current.current) === JSON.stringify(next)) return;
      if (!preserveIdentity) identityVersion.current += 1;
      current.current = next;
      if (next) {
        knownTokens.current.delete(next.session.accessToken);
        knownTokens.current.set(
          next.session.accessToken,
          identityVersion.current,
        );
        // Keep only recent rotations so old, unrelated tokens cannot gain a new lineage.
        while (knownTokens.current.size > 32)
          knownTokens.current.delete(knownTokens.current.keys().next().value!);
      }
      sessionVersion.current += 1;
      update(next);
    },
    [],
  );
  const saveSession = useCallback(
    (next: Session | null, preserveIdentity = false) => {
      const previous = (readSaved() ?? current.current)?.session;
      // Username updates may omit refresh credentials; only the same user can inherit them.
      if (
        next &&
        !next.refreshToken &&
        previous?.refreshToken &&
        previous.user.id === next.user.id
      )
        next = {
          ...next,
          refreshToken: previous.refreshToken,
          refreshTokenExpiresAt: previous.refreshTokenExpiresAt,
          remember: previous.remember,
        };
      const value = next
        ? { session: next, expiresAt: expiryTime(next) }
        : null;
      const baseline = readSavedSnapshot();
      try {
        if (value) localStorage.setItem(storageKey, JSON.stringify(value));
        else localStorage.removeItem(storageKey);
        memoryOnly.current = false;
        failedWriteBaseline.current = undefined;
      } catch {
        memoryOnly.current = value !== null;
        failedWriteBaseline.current =
          value !== null && baseline.readable
            ? JSON.stringify(baseline.saved)
            : undefined;
        /* In-memory login/logout still works when browser storage is blocked. */
      }
      updateSession(
        value,
        preserveIdentity && current.current?.session.user.id === next?.user.id,
      );
    },
    [updateSession],
  );
  const setSession = useCallback(
    (next: Session | null) => saveSession(next),
    [saveSession],
  );
  const refreshing = useRef<{
    identity: number;
    promise: Promise<string | null>;
  } | null>(null);
  const refresh = useCallback(
    (staleToken: string): Promise<string | null> => {
      const identity = identityVersion.current;
      if (!current.current || knownTokens.current.get(staleToken) !== identity)
        return Promise.resolve(null);
      if (refreshing.current?.identity === identity)
        return refreshing.current.promise;
      const stillCurrent = () => identityVersion.current === identity;
      const belongs = (other: SavedSession | null): other is SavedSession =>
        Boolean(
          other &&
          stillCurrent() &&
          other.session.user.id === current.current?.session.user.id &&
          (knownTokens.current.get(other.session.accessToken) === identity ||
            sameLoginFamily(current.current, other)),
        );
      const unchangedFailedWrite = (snapshot: StorageSnapshot) =>
        memoryOnly.current &&
        snapshot.readable &&
        failedWriteBaseline.current === JSON.stringify(snapshot.saved);
      const reconcileStorage = (snapshot: StorageSnapshot) => {
        // An unsuccessful write can leave a different, older login behind. It
        // is not a new external login until the stored snapshot actually changes.
        if (unchangedFailedWrite(snapshot)) return true;
        if (!snapshot.readable) return true; // Preserve the supported storage-denied memory fallback.
        const next =
          snapshot.saved &&
          (snapshot.saved.expiresAt > Date.now() ||
            canRefresh(snapshot.saved.session))
            ? snapshot.saved
            : null;
        if (
          (!snapshot.saved && !memoryOnly.current) ||
          (snapshot.saved && !belongs(snapshot.saved))
        ) {
          memoryOnly.current = false;
          // Adopt without writing. Otherwise api()'s stale 401 event could erase a
          // different tab's new login while our in-memory view is still outdated.
          updateSession(next, sameLoginFamily(current.current, next));
          return false;
        }
        return true;
      };
      const run = async (): Promise<string | null> => {
        if (!stillCurrent()) return null;
        const before = readSavedSnapshot();
        if (!reconcileStorage(before)) return null;
        const latest = unchangedFailedWrite(before)
          ? current.current
          : (before.saved ?? current.current);
        if (!belongs(latest)) return null;
        if (
          latest.session.accessToken !== staleToken &&
          latest.expiresAt > Date.now()
        ) {
          updateSession(latest, true);
          return latest.session.accessToken;
        }
        if (!canRefresh(latest.session)) return null;
        const used = latest.session.refreshToken;
        try {
          const next = await api<Session>("/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken: used }),
          });
          // A pending refresh must never revive a logout or replace a newer login.
          if (
            !stillCurrent() ||
            next.user.id !== current.current?.session.user.id
          )
            return null;
          const after = readSavedSnapshot();
          if (!reconcileStorage(after)) return null;
          if (
            belongs(after.saved) &&
            after.saved.session.refreshToken !== used &&
            after.saved.expiresAt > Date.now()
          ) {
            updateSession(after.saved, true);
            return after.saved.session.accessToken;
          }
          saveSession(next, true);
          return next.accessToken;
        } catch (cause) {
          if (!stillCurrent()) return null;
          const snapshot = readSavedSnapshot();
          if (!reconcileStorage(snapshot)) return null;
          const after = snapshot.saved;
          if (
            belongs(after) &&
            after.session.refreshToken !== used &&
            after.expiresAt > Date.now()
          ) {
            updateSession(after, true);
            return after.session.accessToken;
          }
          if (
            cause instanceof ApiError &&
            (cause.status === 400 || cause.status === 401)
          ) {
            if (current.current?.session.refreshToken === used)
              setSession(null);
            return null;
          }
          throw cause;
        }
      };
      const promise = (
        "locks" in navigator ? navigator.locks.request(refreshLock, run) : run()
      ).finally(() => {
        if (refreshing.current?.promise === promise) refreshing.current = null;
      });
      refreshing.current = { identity, promise };
      return promise;
    },
    [saveSession, setSession, updateSession],
  );
  useEffect(() => {
    setTokenRefresher(refresh);
    return () => setTokenRefresher(null);
  }, [refresh]);
  useEffect(() => {
    // 이미 다른 토큰으로 바뀐 뒤 늦게 도착한 401은 새 로그인을 지우지 않는다.
    const signOut = (event: Event) => {
      if (
        (event as CustomEvent<string>).detail ===
        current.current?.session.accessToken
      )
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
      const snapshot = readSavedSnapshot();
      if (!snapshot.readable) return;
      const next =
        snapshot.saved &&
        (snapshot.saved.expiresAt > Date.now() ||
          canRefresh(snapshot.saved.session))
          ? snapshot.saved
          : null;
      memoryOnly.current = false;
      updateSession(next, sameLoginFamily(current.current, next));
    };
    window.addEventListener("storage", synchronize);
    synchronize();
    return () => window.removeEventListener("storage", synchronize);
  }, [updateSession]);
  useEffect(() => {
    if (!saved) return;
    const identity = identityVersion.current;
    const ownsTimer = () =>
      identityVersion.current === identity &&
      current.current?.session.accessToken === saved.session.accessToken;
    const synchronizeIfCurrent = () => {
      if (!ownsTimer()) return;
      const snapshot = readSavedSnapshot();
      if (
        !snapshot.readable ||
        (memoryOnly.current &&
          failedWriteBaseline.current === JSON.stringify(snapshot.saved))
      )
        return;
      const next =
        snapshot.saved &&
        (snapshot.saved.expiresAt > Date.now() ||
          canRefresh(snapshot.saved.session))
          ? snapshot.saved
          : null;
      memoryOnly.current = false;
      updateSession(next, sameLoginFamily(current.current, next));
    };
    const refreshable = Boolean(saved.session.refreshToken);
    const timer = setTimeout(
      () => {
        if (!ownsTimer()) return;
        if (refreshable)
          void refresh(saved.session.accessToken).then(
            (token) => {
              if (!token) synchronizeIfCurrent();
            },
            () => {},
          );
        else synchronizeIfCurrent();
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
      value={{
        session: saved?.session ?? null,
        setSession,
        getSessionVersion,
        getSessionIdentityVersion,
      }}
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
