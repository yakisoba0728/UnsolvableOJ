import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "./types";

const storageKey = "unsolvable-oj-session-v1";

interface SavedSession {
  session: Session;
  expiresAt: number;
}

// 읽는 쪽에서 만료된 값을 지우지 않는다: 읽는 사이 다른 탭이 새 값으로 바꿨을 수 있다.
function storedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
    if (
      saved &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > Date.now() &&
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
  const setSession = (next: Session | null) => {
    const value = next ? { session: next, expiresAt: expiryTime(next) } : null;
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      /* 저장소를 쓸 수 없어도(쿠키 차단·용량 초과) 이번 방문의 로그인·로그아웃은 반영한다 */
    }
    updateSession(value);
  };
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
    const timer = setTimeout(
      () => {
        // storage 이벤트가 오기 전에 다른 탭이 새 세션으로 바꿨을 수 있어 저장소를 다시 읽는다.
        updateSession(storedSession());
      },
      Math.min(2_147_483_647, Math.max(0, saved.expiresAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [saved, updateSession]);
  return (
    <AuthContext.Provider
      value={{ session: saved?.session ?? null, setSession, getSessionVersion }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** 문제를 만들고 고칠 수 있는 계정(작성자·관리자)인지. */
export const canAuthor = (session: Session | null) =>
  session?.user.role === "AUTHOR" || session?.user.role === "ADMIN";

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
