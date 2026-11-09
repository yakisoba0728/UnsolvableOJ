import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle, useRequest } from "../hooks";
import type { Session, SessionDevice } from "../types";

type Status = { pending: boolean; error: string; done: string };
const idle: Status = { pending: false, error: "", done: "" };
const dateTime = (value: string) =>
  new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/** 계정 설정: 사용자 이름과 비밀번호 변경, 로그인 기기 관리. 성공하면 서버가 준 새 세션으로 바꾼다. */
export function SettingsPage() {
  useDocumentTitle("계정 설정");
  const { session, setSession, getSessionVersion } = useAuth();
  const [username, setUsername] = useState(session?.user.username ?? "");
  const [nameStatus, setNameStatus] = useState(idle);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState(idle);
  const [deviceStatus, setDeviceStatus] = useState(idle);
  const token = session?.accessToken;
  // 비밀번호를 바꾸면 다른 로그인이 모두 끊기고 토큰이 바뀌므로 목록도 다시 받는다.
  const devices = useRequest(
    token ? (signal) => api<SessionDevice[]>("/auth/sessions", { signal }, token) : null,
    [],
    "로그인 기기를 불러오지 못했습니다.",
    [token],
  );
  if (!session) return null;

  async function signOutDevices(path: string, done: string) {
    setDeviceStatus({ ...idle, pending: true });
    try {
      await api(path, { method: "DELETE" }, session!.accessToken);
      setDeviceStatus({ ...idle, done });
    } catch (cause) {
      setDeviceStatus({
        ...idle,
        error: cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.",
      });
    }
    devices.retry();
  }

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
      // 비밀번호를 바꾸면 refresh token도 모두 새로 받으므로 지금의 로그인 유지 여부를 이어 간다.
      { currentPassword, newPassword, ...(session!.remember ? { remember: true } : {}) },
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
        description="사용자 이름과 비밀번호를 바꾸고, 로그인한 기기를 관리할 수 있습니다."
        back={{ to: "/profile", label: "내 학습 기록" }}
      />
      {session.user.mustChangePassword && (
        <p className="error-message" role="alert">
          관리자가 발급한 임시 비밀번호로 로그인했습니다. 아래에서 새 비밀번호로 바꿔야 다른 기능을 쓸 수 있습니다.
        </p>
      )}
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
      <section className="panel settings-panel" aria-labelledby="settings-devices">
        <h2 id="settings-devices">로그인 기기</h2>
        {devices.loading && !devices.data.length ? (
          <p className="field-help">불러오는 중입니다…</p>
        ) : devices.error ? (
          <p className="error-message">
            {devices.error}{" "}
            <button type="button" className="button button-small button-outline" onClick={devices.retry}>
              다시 시도
            </button>
          </p>
        ) : (
          <ul className="session-list">
            {devices.data.map((device) => (
              <li key={device.id} className={device.current ? "current" : undefined}>
                <div>
                  <strong>{device.current ? "이 기기" : "다른 로그인"}</strong>
                  {device.remember && <span className="case-pill">로그인 유지</span>}
                  <span className="field-help">
                    로그인 {dateTime(device.createdAt)} · 마지막 사용 {dateTime(device.lastUsedAt)}
                  </span>
                </div>
                {!device.current && (
                  <button
                    type="button"
                    className="button button-small button-outline"
                    disabled={deviceStatus.pending}
                    onClick={() =>
                      void signOutDevices(`/auth/sessions/${device.id}`, "그 기기에서 로그아웃했습니다.")
                    }
                  >
                    로그아웃
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {message(deviceStatus)}
        <button
          type="button"
          className="button button-outline"
          disabled={deviceStatus.pending || !devices.data.some((device) => !device.current)}
          onClick={() =>
            void signOutDevices("/auth/sessions", "다른 기기에서 모두 로그아웃했습니다.")
          }
        >
          다른 기기 모두 로그아웃
        </button>
      </section>
    </div>
  );
}
