import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useRequest } from "../hooks";

type Preferences = {
  verified: boolean;
  answer: boolean;
  accepted: boolean;
  enabled: boolean;
};
type Status = { pending: boolean; error: string; done: string };
const idle: Status = { pending: false, error: "", done: "" };
const failure = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "처리하지 못했습니다. 다시 시도해 주세요.";

/** Each account owns its form and pending requests; switching accounts unmounts them. */
export function AccountPrivacyPanels() {
  const { session, getSessionIdentityVersion } = useAuth();
  return session ? (
    <PrivacyPanels key={`${session.user.id}:${getSessionIdentityVersion()}`} />
  ) : null;
}

function PrivacyPanels() {
  const { session, getSessionIdentityVersion } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(idle);
  const [withdrawStatus, setWithdrawStatus] = useState(idle);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [choices, setChoices] = useState<{
    answer: boolean;
    accepted: boolean;
  } | null>(null);
  const action = useRef<AbortController | null>(null);
  const withdrawal = useRef<AbortController | null>(null);
  const knownVerification = useRef<boolean | undefined>(undefined);
  const token = session?.accessToken;
  const preferences = useRequest<Preferences | null>(
    token && !session?.user.mustChangePassword
      ? (signal) => api("/email/preferences", { signal }, token)
      : null,
    null,
    "이메일 알림 설정을 불러오지 못했습니다.",
    [token, session?.user.mustChangePassword],
  );
  useEffect(
    () => () => {
      action.current?.abort();
      withdrawal.current?.abort();
    },
    [],
  );
  // Refreshing the same login briefly clears the fetched data, not the user's edits.
  // A new login owns a new component; only an actual verification change resets edits.
  useEffect(() => {
    const verified = preferences.data?.verified;
    if (verified === undefined) return;
    const previous = knownVerification.current;
    knownVerification.current = verified;
    if (previous !== undefined && previous !== verified) {
      setChoices(null);
      setStatus((previous) => (previous.pending ? previous : idle));
    }
  }, [preferences.data?.verified]);
  if (!session || session.user.mustChangePassword) return null;
  const values = choices ??
    preferences.data ?? { answer: false, accepted: false };
  const canEnable = Boolean(
    preferences.data?.enabled && preferences.data.verified,
  );
  const increasesConsent = Boolean(
    preferences.data &&
    ((values.answer && !preferences.data.answer) ||
      (values.accepted && !preferences.data.accepted)),
  );

  async function emailAction(kind: "save" | "verify") {
    if (!session || action.current || withdrawal.current) return;
    const controller = new AbortController();
    action.current = controller;
    const version = getSessionIdentityVersion();
    setStatus({ ...idle, pending: true });
    try {
      const result = await api<{ message?: string }>(
        kind === "save" ? "/email/preferences" : "/email/verification/request",
        {
          method: kind === "save" ? "PATCH" : "POST",
          signal: controller.signal,
          body: JSON.stringify(
            kind === "save"
              ? { answer: values.answer, accepted: values.accepted }
              : {},
          ),
        },
        session.accessToken,
      );
      if (controller.signal.aborted || getSessionIdentityVersion() !== version)
        return;
      setStatus({
        ...idle,
        done:
          kind === "save"
            ? "이메일 알림 설정을 저장했습니다."
            : (result?.message ?? "인증 메일 발송 요청을 받았습니다."),
      });
      if (kind === "save") {
        setChoices(null);
        preferences.retry();
      }
    } catch (cause) {
      if (!controller.signal.aborted && getSessionIdentityVersion() === version)
        setStatus({ ...idle, error: failure(cause) });
    } finally {
      if (action.current === controller) {
        action.current = null;
        if (!controller.signal.aborted)
          setStatus((previous) => ({ ...previous, pending: false }));
      }
    }
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (
      !session ||
      action.current ||
      withdrawal.current ||
      confirmation !== "회원 탈퇴"
    )
      return;
    const controller = new AbortController();
    withdrawal.current = controller;
    const version = getSessionIdentityVersion();
    setWithdrawStatus({ ...idle, pending: true });
    try {
      await api(
        "/auth/account",
        {
          method: "DELETE",
          signal: controller.signal,
          body: JSON.stringify({ currentPassword: password, confirmation }),
        },
        session.accessToken,
      );
      if (controller.signal.aborted || getSessionIdentityVersion() !== version)
        return;
      setPassword("");
      setConfirmation("");
      // Commit the public destination before clearing auth, so the protected settings
      // redirect cannot replace the completion message with its own login redirect.
      navigate("/account/withdrawn", {
        replace: true,
        flushSync: true,
        state: {
          withdrawalComplete: true,
          withdrawalUserId: session.user.id,
          withdrawalVersion: version,
        },
      });
    } catch (cause) {
      if (!controller.signal.aborted && getSessionIdentityVersion() === version)
        setWithdrawStatus({ ...idle, error: failure(cause) });
    } finally {
      if (withdrawal.current === controller) {
        withdrawal.current = null;
        if (!controller.signal.aborted)
          setWithdrawStatus((previous) => ({ ...previous, pending: false }));
      }
    }
  }

  const busy = status.pending || withdrawStatus.pending;
  return (
    <>
      <section
        className="panel settings-panel"
        aria-labelledby="settings-email"
      >
        <h2 id="settings-email">커뮤니티 이메일 알림</h2>
        <p>
          가입 이메일 {session.user.email}로 선택한 알림만 받습니다. 기본값은
          수신 안 함입니다.
        </p>
        {preferences.loading ? (
          <p>이메일 설정을 불러오는 중입니다…</p>
        ) : preferences.error ? (
          <p className="error-message" role="alert">
            {preferences.error}{" "}
            <button
              type="button"
              className="button button-small button-outline"
              onClick={preferences.retry}
            >
              이메일 설정 다시 시도
            </button>
          </p>
        ) : (
          preferences.data && (
            <>
              {!preferences.data.enabled && (
                <p>
                  현재 서버의 이메일 발송이 준비되지 않았습니다. 발송 설정 후
                  사용할 수 있습니다.
                </p>
              )}
              {preferences.data.verified ? (
                <p>인증된 이메일입니다.</p>
              ) : (
                <>
                  <p>
                    다른 사람에게 메일이 발송되지 않도록 이메일 인증이 먼저
                    필요합니다.
                  </p>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy || !preferences.data.enabled}
                    onClick={() => void emailAction("verify")}
                  >
                    인증 메일 보내기
                  </button>
                </>
              )}
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void emailAction("save");
                }}
              >
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={values.answer}
                    disabled={
                      busy ||
                      (!canEnable && !preferences.data.answer && !values.answer)
                    }
                    onChange={(event) =>
                      setChoices({
                        answer: event.target.checked,
                        accepted: values.accepted,
                      })
                    }
                  />
                  내 글에 새 답변이 달렸을 때
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={values.accepted}
                    disabled={
                      busy ||
                      (!canEnable &&
                        !preferences.data.accepted &&
                        !values.accepted)
                    }
                    onChange={(event) =>
                      setChoices({
                        answer: values.answer,
                        accepted: event.target.checked,
                      })
                    }
                  />
                  내 답변이 채택됐을 때
                </label>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !preferences.data ||
                    (!canEnable && increasesConsent)
                  }
                >
                  이메일 알림 저장
                </button>
              </form>
            </>
          )
        )}
        {status.error && (
          <p className="error-message" role="alert">
            {status.error}
          </p>
        )}
        {status.done && (
          <p className="success-message" role="status">
            {status.done}
          </p>
        )}
      </section>
      <section
        className="panel settings-panel"
        aria-labelledby="settings-withdrawal"
      >
        <h2 id="settings-withdrawal">회원 탈퇴</h2>
        {session.user.role === "ADMIN" ? (
          <p>
            관리자 계정은 바로 탈퇴할 수 없습니다. 다른 관리자에게 권한 변경을
            요청한 뒤 진행해 주세요.
          </p>
        ) : (
          <>
            <p>
              탈퇴하면 모든 기기에서 로그아웃되고 다시 로그인할 수 없습니다.
              개인정보는 익명화되며 작성 글·답변·제출·시험 기록은 익명 상태로
              남습니다. 작성한 내용 안의 개인정보는 자동 삭제되지 않으므로 탈퇴
              전에 직접 지워 주세요.
            </p>
            <form
              className="form-stack"
              onSubmit={(event) => void withdraw(event)}
            >
              <label>
                탈퇴 비밀번호
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                확인 문구
                <input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <span className="field-help">
                확인 문구에 ‘회원 탈퇴’를 입력한 뒤 탈퇴를 확정해 주세요.
              </span>
              <button
                className="button button-outline"
                disabled={busy || confirmation !== "회원 탈퇴" || !password}
              >
                {withdrawStatus.pending ? "탈퇴 처리 중…" : "회원 탈퇴 확정"}
              </button>
            </form>
            {withdrawStatus.error && (
              <p className="error-message" role="alert">
                {withdrawStatus.error}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
