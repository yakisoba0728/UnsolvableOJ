import { useState, type FormEvent } from "react";
import { useDocumentTitle } from "../hooks";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, demoAccount, isDemo } from "../api";
import { useAuth } from "../auth";
import type { Session } from "../types";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  useDocumentTitle(mode === "login" ? "로그인" : "회원가입");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination =
    (location.state as { from?: string } | null)?.from ?? "/";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const session = await api<Session>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(
          mode === "register"
            ? { email, username, password }
            : { email, password },
        ),
      });
      setSession(session);
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setPending(false);
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
        {isDemo && demoAccount ? (
          <p className="demo-hint" role="note">
            <span>
              데모 모드입니다. 데모 계정 <code>{demoAccount.email}</code>로
              로그인하거나(비밀번호는 아무 값이나 가능) 새로 가입할 수 있어요.
            </span>
            {mode === "login" ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEmail(demoAccount.email);
                  setPassword(demoAccount.password);
                }}
              >
                데모 계정 채우기
              </button>
            ) : null}
          </p>
        ) : null}
        <form onSubmit={submit} className="form-stack">
          <label>
            이메일
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {mode === "register" ? (
            <label>
              사용자 이름
              <input
                autoComplete="username"
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9_]+"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            비밀번호
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "register" ? 10 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
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
              setMode(mode === "login" ? "register" : "login");
              setError("");
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
