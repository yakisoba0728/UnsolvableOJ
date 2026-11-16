import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

/** A private account-owned control; refreshing a token also abandons pending work. */
export function ProblemBookmark({ problemId }: { problemId: string }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session)
    return <Link className="button button-soft" to="/auth" state={{ from: location.pathname }}>
      <Bookmark size={16} aria-hidden="true" /> 로그인 후 저장
    </Link>;
  return <OwnedBookmark key={`${session.user.id}:${session.accessToken}:${problemId}`}
    problemId={problemId} token={session.accessToken} />;
}

function OwnedBookmark({ problemId, token }: { problemId: string; token: string }) {
  const [bookmarked, setBookmarked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const path = `/problems/${problemId}/bookmark`;

  async function run(method: "GET" | "PUT" | "DELETE") {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ bookmarked: boolean }>(path, { method, signal: controller.signal }, token);
      if (!controller.signal.aborted && mounted.current) {
        setBookmarked(result.bookmarked);
        if (method !== "GET")
          setNotice(result.bookmarked ? "나만의 문제 목록에 저장했어요." : "저장한 문제 목록에서 지웠어요.");
      }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        // A lost response may follow a committed save. Re-read before offering a toggle.
        setBookmarked(null);
        setError(cause instanceof Error ? cause.message : "저장 상태를 확인하지 못했습니다.");
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted && mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void run("GET");
    return () => {
      mounted.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, []);

  return <div className="bookmark-control" role="group" aria-label="문제 저장">
    <button type="button" className={`button ${bookmarked ? "button-outline" : "button-soft"}`}
      aria-label={bookmarked ? "문제 저장 취소" : "문제 저장"}
      aria-pressed={bookmarked === true} disabled={busy || bookmarked === null}
      onClick={() => void run(bookmarked ? "DELETE" : "PUT")}>
      <Bookmark size={16} aria-hidden="true" fill={bookmarked ? "currentColor" : "none"} />
      {busy ? "확인 중…" : bookmarked ? "저장됨" : "저장"}
    </button>
    <Link to="/problems?saved=1" className="inline-button">저장한 문제</Link>
    <span className="sr-only" role="status">{notice}</span>
    {error ? <span className="bookmark-error error-message" role="alert">
      {error}{" "}<button type="button" className="inline-button" disabled={busy}
        onClick={() => void run("GET")}>상태 다시 확인</button>
    </span> : null}
  </div>;
}
