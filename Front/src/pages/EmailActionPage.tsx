import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";

/** Links carry secrets in the fragment, so they are not sent as HTTP URLs/referrers. */
export function EmailActionPage({
  action,
}: {
  action: "verify" | "unsubscribe";
}) {
  const location = useLocation();
  const { session, getSessionIdentityVersion } = useAuth();
  const [token] = useState(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    return value.length <= 512 ? value : "";
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const request = useRef<AbortController | null>(null);
  const verificationIdentity =
    action === "verify" ? getSessionIdentityVersion() : null;
  const title = action === "verify" ? "이메일 인증" : "이메일 수신 해제";
  useDocumentTitle(title);
  useEffect(() => {
    // Remove the secret from the visible URL/history after capturing it in memory.
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    // Keep this link's in-memory token when the login changes, but never carry
    // another login's request or completion message into the new account.
    request.current?.abort();
    request.current = null;
    setPending(false);
    setError("");
    setDone(false);
  }, [verificationIdentity]);

  async function confirm() {
    if (!token || request.current || done || (action === "verify" && !session))
      return;
    const controller = new AbortController();
    request.current = controller;
    const version = getSessionIdentityVersion();
    setPending(true);
    setError("");
    try {
      await api(
        action === "verify"
          ? "/email/verification/confirm"
          : "/email/unsubscribe",
        {
          method: "POST",
          body: JSON.stringify({ token }),
          signal: controller.signal,
        },
        action === "verify" ? session?.accessToken : undefined,
      );
      if (
        controller.signal.aborted ||
        (action === "verify" && version !== getSessionIdentityVersion())
      )
        return;
      setDone(true);
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        (action !== "verify" || version === getSessionIdentityVersion())
      )
        setError(
          cause instanceof Error
            ? cause.message
            : "처리하지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  return (
    <div className="page-width">
      <PageHeader title={title} />
      <section className="panel settings-panel">
        {done ? (
          <>
            <p role="status">
              {action === "verify"
                ? "이메일 인증이 완료됐습니다. 설정에서 원하는 이메일 알림을 켤 수 있습니다."
                : "수신 해제 요청을 처리했습니다. 유효한 링크인 경우 이메일 알림이 해제됩니다."}
            </p>
            <Link to={session ? "/settings" : "/"} className="button">
              {session ? "계정 설정으로" : "홈으로"}
            </Link>
          </>
        ) : !token ? (
          <p role="alert">
            올바른 링크가 아닙니다. 메일의 링크를 다시 열어 주세요.
          </p>
        ) : action === "verify" && !session ? (
          <>
            <p>
              인증 메일을 받은 계정으로 로그인한 뒤 이메일 인증을 확정해 주세요.
            </p>
            <Link
              className="button"
              to="/auth"
              state={{
                from: `${location.pathname}#token=${encodeURIComponent(token)}`,
              }}
            >
              로그인하기
            </Link>
          </>
        ) : (
          <>
            <p>
              {action === "verify"
                ? "현재 로그인한 계정의 이메일을 인증합니다. 인증만으로 알림 수신이 켜지지는 않습니다."
                : "이 링크의 계정에 대한 새 답변·채택 이메일 알림을 모두 끕니다."}
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button
              className="button"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending
                ? "처리 중…"
                : action === "verify"
                  ? "이메일 인증 확정"
                  : "이메일 수신 해제 확정"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
