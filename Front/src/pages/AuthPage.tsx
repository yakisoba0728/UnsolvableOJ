import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDocumentTitle } from "../hooks";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Session } from "../types";

type Field = "email" | "username" | "password";

/** 회원가입 입력 규칙(서버 검증과 같다). 문제가 없으면 빈 문자열. */
function registerProblem(field: Field, value: string) {
  if (field === "email") {
    if (!value.trim()) return "이메일을 입력해 주세요.";
    if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return "이메일 형식이 올바르지 않아요. 예: user@example.com";
  } else if (field === "username") {
    if (!value) return "사용자 이름을 입력해 주세요.";
    if (!/^[A-Za-z0-9_]*$/.test(value))
      return "영문, 숫자, 밑줄(_)만 사용할 수 있어요.";
    if (value.length < 3 || value.length > 30) return "3~30자로 입력해 주세요.";
  } else {
    if (!value) return "비밀번호를 입력해 주세요.";
    if (value.length < 10) return "10자 이상 입력해 주세요.";
    if (value.length > 128) return "128자 이하로 입력해 주세요.";
  }
  return "";
}

export function AuthPage({ getNavigationVersion }: { getNavigationVersion: () => number }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  useDocumentTitle(mode === "login" ? "로그인" : "회원가입");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    email: false,
    username: false,
    password: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { session, setSession, getSessionVersion } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from ?? "/";
  const request = useRef<AbortController | null>(null);
  const navigationVersion = getNavigationVersion();
  useEffect(() => {
    setPending(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [mode, location.key, session?.accessToken, navigationVersion]);

  const values: Record<Field, string> = { email, username, password };
  const register = mode === "register";
  // 입력을 시작한 칸은 바로, 건드리고 떠난 칸은 비어 있어도 안내한다.
  const problems: Record<Field, string> = {
    email: register ? registerProblem("email", email) : "",
    username: register ? registerProblem("username", username) : "",
    password: register ? registerProblem("password", password) : "",
  };
  const shown = (field: Field) =>
    register && (touched[field] || values[field] !== "") ? problems[field] : "";

  function fieldProps(field: Field) {
    const message = shown(field);
    return {
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? `auth-${field}-error` : undefined,
      onBlur: () => setTouched((previous) => ({ ...previous, [field]: true })),
    };
  }
  const fieldError = (field: Field) =>
    shown(field) ? (
      <span
        id={`auth-${field}-error`}
        className="field-error"
        aria-live="polite"
      >
        {shown(field)}
      </span>
    ) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (register) {
      const invalid = (["email", "username", "password"] as Field[]).find(
        (field) => problems[field],
      );
      if (invalid) {
        setTouched({ email: true, username: true, password: true });
        document.getElementById(`auth-${invalid}`)?.focus();
        return;
      }
    }
    setError("");
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    const requestNavigationVersion = getNavigationVersion();
    const sessionVersion = getSessionVersion();
    const ownsRequest = () =>
      !controller.signal.aborted && request.current === controller &&
      getNavigationVersion() === requestNavigationVersion && getSessionVersion() === sessionVersion;
    try {
      const session = await api<Session>(`/auth/${mode}`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(
          mode === "register"
            ? { email, username, password }
            : { email, password },
        ),
      });
      if (!ownsRequest()) return;
      setSession(session);
      navigate(destination, { replace: true });
    } catch (cause) {
      if (!ownsRequest()) return;
      setError(
        cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <span className="eyebrow">YOUR NEXT SOLVE STARTS HERE</span>
        <h1>
          막힌 곳에서
          <br />
          <em>실력이 자랍니다.</em>
        </h1>
        <p>
          문제를 고르고, 코드를 제출하고, 판정을 확인하세요. 한 문제씩 쌓아가는
          기록이 시작됩니다.
        </p>
        <div className="intro-decoration" aria-hidden="true">
          <span>01</span>
          <span>02</span>
          <span>03</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="card-kicker">계정</div>
        <h2>
          {mode === "login"
            ? "다시 만나서 반가워요."
            : "첫 문제를 시작해 볼까요?"}
        </h2>
        <p className="muted">
          {mode === "login"
            ? "이메일과 비밀번호를 입력해 주세요."
            : "계정을 만들고 바로 문제를 풀 수 있습니다."}
        </p>
        <form onSubmit={submit} className="form-stack" noValidate={register}>
          <div className="auth-field">
            <label>
              이메일
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                {...fieldProps("email")}
              />
            </label>
            {fieldError("email")}
          </div>
          {register ? (
            <div className="auth-field">
              <label>
                사용자 이름
                <input
                  id="auth-username"
                  autoComplete="username"
                  maxLength={30}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  {...fieldProps("username")}
                />
              </label>
              {fieldError("username") ?? (
                <span className="field-help">영문, 숫자, 밑줄(_) 3~30자</span>
              )}
            </div>
          ) : null}
          <div className="auth-field">
            <label>
              비밀번호
              <input
                id="auth-password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                {...fieldProps("password")}
              />
            </label>
            {fieldError("password") ??
              (register ? <span className="field-help">10자 이상</span> : null)}
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button button-full" disabled={pending}>
            {pending ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "아직 계정이 없나요?" : "이미 계정이 있나요?"}{" "}
          <button
            className="inline-button"
            onClick={() => {
              request.current?.abort();
              request.current = null;
              setPending(false);
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setTouched({ email: false, username: false, password: false });
            }}
          >
            {mode === "login" ? "회원가입" : "로그인"}
          </button>
        </p>
        <Link className="back-link" to="/problems">
          ← 문제 목록으로 돌아가기
        </Link>
      </section>
    </div>
  );
}
