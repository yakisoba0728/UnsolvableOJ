import { Bell } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { relativeTime } from "../community/store";
import { verdictLabel } from "../verdict";

export interface AppNotification {
  id: string;
  type: "ANSWER" | "ACCEPTED" | "JUDGED";
  readAt: string | null;
  createdAt: string;
  commentId: string | null;
  actor: { id: string; username: string } | null;
  post: { id: string; title: string } | null;
  submission: { id: string; status: string; problemTitle: string } | null;
}
interface NotificationPage {
  items: AppNotification[];
  unread: number;
  page: number;
  totalPages: number;
}

const POLL_MS = 60_000;
const PAGE_SIZE = 10;

// 배경 확인은 토큰을 headers로 넘겨, 401이어도 로그아웃 이벤트를 내지 않는다(다른 요청이 처리한다).
const request = <T,>(
  token: string,
  path: string,
  init: RequestInit = {},
) =>
  api<T>(`/notifications${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}` },
  });

function describe(item: AppNotification) {
  const actor = item.actor?.username ?? "누군가";
  if (item.type === "JUDGED")
    return {
      to: `/submissions/${item.submission?.id ?? ""}`,
      text: `“${item.submission?.problemTitle ?? "문제"}” 채점 결과: ${verdictLabel(item.submission?.status ?? "")}`,
    };
  return {
    to: `/community/${item.post?.id ?? ""}`,
    text:
      item.type === "ACCEPTED"
        ? `${actor}님이 내 답변을 채택했어요 · ${item.post?.title ?? ""}`
        : `${actor}님이 내 글에 답변했어요 · ${item.post?.title ?? ""}`,
  };
}

/** 헤더의 알림 종. 안 읽은 수는 탭이 보일 때만 1분마다 확인한다. */
export function NotificationBell({ token }: { token: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NotificationPage | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    let timer: number | undefined;
    const poll = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      request<{ unread: number }>(token, "/unread-count")
        .then((result) => setUnread(result.unread))
        .catch(() => {});
      timer = window.setTimeout(poll, POLL_MS);
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [token]);

  async function load(page: number) {
    setError("");
    try {
      const next = await request<NotificationPage>(
        token,
        `?page=${page}&limit=${PAGE_SIZE}`,
      );
      setUnread(next.unread);
      setList((current) =>
        page > 1 && current
          ? { ...next, items: [...current.items, ...next.items] }
          : next,
      );
    } catch {
      setError("알림을 불러오지 못했어요.");
    }
  }

  useEffect(() => {
    if (open) void load(1);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function markRead(item: AppNotification) {
    if (item.readAt) return;
    const readAt = new Date().toISOString();
    setList((current) =>
      current && {
        ...current,
        items: current.items.map((other) =>
          other.id === item.id ? { ...other, readAt } : other,
        ),
      },
    );
    setUnread((count) => Math.max(0, count - 1));
    request(token, `/${item.id}/read`, { method: "PUT" }).catch(() => {});
  }

  async function markAllRead() {
    try {
      await request(token, "/read-all", { method: "PUT" });
      const readAt = new Date().toISOString();
      setUnread(0);
      setList(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) => ({
              ...item,
              readAt: item.readAt ?? readAt,
            })),
          },
      );
    } catch {
      setError("읽음으로 바꾸지 못했어요.");
    }
  }

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-label={unread ? `알림, 안 읽음 ${unread}개` : "알림"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} aria-hidden="true" />
        {unread ? (
          <span className="notification-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="notification-panel"
          id={panelId}
          role="region"
          aria-label="알림"
        >
          <div className="notification-panel-head">
            <strong>알림</strong>
            <button
              type="button"
              className="inline-button"
              disabled={!unread}
              onClick={() => void markAllRead()}
            >
              모두 읽음
            </button>
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          {!list ? (
            error ? null : (
              <p className="muted" role="status">
                불러오는 중…
              </p>
            )
          ) : list.items.length ? (
            <ul className="notification-list">
              {list.items.map((item) => {
                const { to, text } = describe(item);
                return (
                  <li key={item.id} className={item.readAt ? "" : "unread"}>
                    <Link
                      to={to}
                      onClick={() => {
                        markRead(item);
                        // 지연 로딩 화면은 주소 변경이 늦게 반영되므로 누르는 즉시 닫는다.
                        setOpen(false);
                      }}
                    >
                      <span>{text}</span>
                      <small className="muted">
                        {item.readAt ? "" : "새 알림 · "}
                        {relativeTime(item.createdAt)}
                      </small>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">아직 알림이 없어요.</p>
          )}
          {list && list.page < list.totalPages ? (
            <button
              type="button"
              className="button button-outline button-small"
              onClick={() => void load(list.page + 1)}
            >
              더 보기
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
