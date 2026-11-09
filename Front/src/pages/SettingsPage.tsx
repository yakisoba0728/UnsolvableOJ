import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";
import type { Session } from "../types";

type Status = { pending: boolean; error: string; done: string };
const idle: Status = { pending: false, error: "", done: "" };

/** 계정 설정: 사용자 이름과 비밀번호 변경. 성공하면 서버가 준 새 세션으로 바꾼다. */
export function SettingsPage() {
  useDocumentTitle("계정 설정");
  const { session, setSession, getSessionVersion } = useAuth();
  const [username, setUsername] = useState(session?.user.username ?? "");
  const [nameStatus, setNameStatus] = useState(idle);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState(idle);
  if (!session) return null;

  async function send(
    path: string,
    body: object,
    setStatus: (status: Status) => void,
    done: string,
  ) {
    setStatus({ ...idle, pending: true });
    const version = getSessionVersion();
    try {
      const next = await api<Session>(
        path,
        { method: "PATCH", body: JSON.stringify(body) },
        session!.accessToken,
      );
      // 응답 전에 로그아웃·계정 전환이 있었다면 지난 계정의 세션을 되살리지 않는다.
      if (getSessionVersion() !== version) return;
      setSession(next);
      setStatus({ ...idle, done });
      return true;
    } catch (cause) {
      setStatus({
        ...idle,
        error: cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  function changeUsername(event: FormEvent) {
    event.preventDefault();
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username))
      return setNameStatus({ ...idle, error: "영문, 숫자, 밑줄(_) 3~30자로 입력해 주세요." });
    void send("/auth/username", { username }, setNameStatus, "사용자 이름을 바꿨습니다.");
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 10)
      return setPasswordStatus({ ...idle, error: "새 비밀번호는 10자 이상이어야 합니다." });
    if (newPassword !== confirmPassword)
      return setPasswordStatus({ ...idle, error: "새 비밀번호가 서로 다릅니다." });
    const changed = await send(
      "/auth/password",
      { currentPassword, newPassword },
      setPasswordStatus,
      "비밀번호를 바꿨습니다. 다른 기기에서는 다시 로그인해야 합니다.",
    );
    if (changed) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  const message = (status: Status) =>
    status.error ? (
      <p className="error-message" role="alert">
        {status.error}
      </p>
    ) : status.done ? (
      <p className="success-message" role="status">
        {status.done}
      </p>
    ) : null;

  return (
    <div className="page-width settings-page">
      <PageHeader
        title="계정 설정"
        description="사용자 이름과 비밀번호를 바꿀 수 있습니다."
        back={{ to: "/profile", label: "내 학습 기록" }}
      />
      <section className="panel settings-panel" aria-labelledby="settings-username">
        <h2 id="settings-username">사용자 이름</h2>
        <form className="form-stack" onSubmit={changeUsername} noValidate>
          <label>
            새 사용자 이름
            <input
              autoComplete="username"
              maxLength={30}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <span className="field-help">영문, 숫자, 밑줄(_) 3~30자</span>
          {message(nameStatus)}
          <button
            className="button"
            disabled={nameStatus.pending || username === session.user.username}
          >
            {nameStatus.pending ? "처리 중…" : "이름 변경"}
          </button>
        </form>
      </section>
      <section className="panel settings-panel" aria-labelledby="settings-password">
        <h2 id="settings-password">비밀번호</h2>
        <form className="form-stack" onSubmit={changePassword} noValidate>
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label>
            새 비밀번호
            <input
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label>
            새 비밀번호 확인
            <input
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <span className="field-help">10자 이상. 바꾸면 다른 기기의 로그인은 풀립니다.</span>
          {message(passwordStatus)}
          <button
            className="button"
            disabled={passwordStatus.pending || !currentPassword || !newPassword}
          >
            {passwordStatus.pending ? "처리 중…" : "비밀번호 변경"}
          </button>
        </form>
      </section>
    </div>
  );
}
