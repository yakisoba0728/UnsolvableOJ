import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "./types";

const storageKey = "unsolvable-oj-session-v1";

interface SavedSession {
  session: Session;
  expiresAt: number;
}

function storedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
    if (saved && saved.expiresAt > Date.now()) return saved;
    localStorage.removeItem(storageKey);
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [saved, update] = useState<SavedSession | null>(storedSession);
  const setSession = (next: Session | null) => {
    const value = next ? { session: next, expiresAt: expiryTime(next) } : null;
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
    update(value);
  };
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(
      () => {
        localStorage.removeItem(storageKey);
        update(null);
      },
      Math.max(0, saved.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [saved]);
  return (
    <AuthContext.Provider
      value={{ session: saved?.session ?? null, setSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
