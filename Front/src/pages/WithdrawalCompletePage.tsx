import { useEffect } from "react";
import { useAuth } from "../auth";
import { Link, useLocation } from "react-router-dom";
import { NotFoundPage } from "../components/NotFoundPage";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";

/** Eager route: a lazy login page may suspend and keep the protected settings mounted. */
export function WithdrawalCompletePage() {
  const { state } = useLocation();
  const { session, setSession, getSessionIdentityVersion } = useAuth();
  const receipt = state as {
    withdrawalComplete?: boolean;
    withdrawalUserId?: string;
    withdrawalVersion?: number;
  } | null;
  const completed =
    (state as { withdrawalComplete?: boolean } | null)?.withdrawalComplete ===
    true;
  useDocumentTitle(completed ? "회원 탈퇴 완료" : "페이지를 찾을 수 없습니다");
  useEffect(() => {
    // Clear auth only after this public destination commits. A protected-route
    // redirect must not win a race with the successful withdrawal navigation.
    if (
      completed &&
      session?.user.id === receipt?.withdrawalUserId &&
      getSessionIdentityVersion() === receipt?.withdrawalVersion
    )
      setSession(null);
  }, [completed, session, receipt, getSessionIdentityVersion, setSession]);
  if (!completed) return <NotFoundPage />;
  return (
    <div className="page-width">
      <PageHeader title="회원 탈퇴 완료" />
      <section className="panel settings-panel">
        <p role="status">회원 탈퇴가 완료됐습니다.</p>
        <Link className="button" to="/">
          홈으로
        </Link>
      </section>
    </div>
  );
}
