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
  const [loading, setLoading] = useState(false);
  const [failedPage, setFailedPage] = useState(1);
  const [markingAll, setMarkingAll] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  const readRequests = useRef(new Set<AbortController>());
  const markingAllRef = useRef(false);
  // A count requested before a list refresh or read must not restore an old badge.
  const countVersion = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    let timer: number | undefined;
    let pending: AbortController | undefined;
    const poll = () => {
      window.clearTimeout(timer);
      pending?.abort();
      if (document.hidden) return;
      timer = window.setTimeout(poll, POLL_MS);
      if (readRequests.current.size) return;
      const controller = new AbortController();
      pending = controller;
      const version = countVersion.current;
      request<{ unread: number }>(token, "/unread-count", { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted && version === countVersion.current)
            setUnread(result.unread);
        })
        .catch(() => {});
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(timer);
      pending?.abort();
      document.removeEventListener("visibilitychange", poll);
    };
  }, [token]);

  useEffect(() => () => {
    listRequest.current?.abort();
    readRequests.current.forEach((controller) => controller.abort());
  }, []);

  async function load(page: number) {
    // A repeated click before React paints the disabled button is also ignored.
    if (page > 1 && listRequest.current) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setError("");
    setLoading(true);
    try {
      const next = await request<NotificationPage>(
        token,
        `?page=${page}&limit=${PAGE_SIZE}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      countVersion.current += 1;
      setUnread(next.unread);
      setList((current) =>
        page > 1 && current
          ? {
              ...next,
              // New notifications can shift offset pages while the panel is open.
              items: [...new Map([...current.items, ...next.items].map((item) => [item.id, item])).values()],
            }
          : next,
      );
    } catch {
      if (!controller.signal.aborted) {
        setFailedPage(page);
        setError("알림을 불러오지 못했어요.");
      }
    } finally {
      if (listRequest.current === controller) {
        listRequest.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (open) void load(1);
    return () => {
      listRequest.current?.abort();
      listRequest.current = null;
    };
  }, [open, token]);
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

  async function markRead(item: AppNotification) {
    if (item.readAt) return;
    const controller = new AbortController();
    readRequests.current.add(controller);
    const version = ++countVersion.current;
    try {
      const result = await request<{ unread: number }>(token, `/${item.id}/read`, {
        method: "PUT", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const readAt = new Date().toISOString();
      setList((current) => current && {
        ...current,
        items: current.items.map((other) => other.id === item.id ? { ...other, readAt } : other),
      });
      if (version === countVersion.current) {
        countVersion.current += 1;
        setUnread(result.unread);
      }
    } catch {
      if (!controller.signal.aborted) setError("읽음으로 바꾸지 못했어요.");
    } finally {
      readRequests.current.delete(controller);
    }
  }

  async function markAllRead() {
    if (markingAllRef.current || listRequest.current) return;
    markingAllRef.current = true;
    setMarkingAll(true);
    const controller = new AbortController();
    readRequests.current.add(controller);
    const version = ++countVersion.current;
    try {
      await request(token, "/read-all", { method: "PUT", signal: controller.signal });
      if (controller.signal.aborted || version !== countVersion.current) return;
      countVersion.current += 1;
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
      if (!controller.signal.aborted) setError("읽음으로 바꾸지 못했어요.");
    } finally {
      readRequests.current.delete(controller);
      markingAllRef.current = false;
      if (!controller.signal.aborted) setMarkingAll(false);
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
              disabled={!unread || loading || markingAll}
              onClick={() => void markAllRead()}
            >
              모두 읽음
            </button>
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}{" "}
              <button type="button" className="inline-button" disabled={loading} onClick={() => void load(failedPage)}>
                다시 시도
              </button>
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
                        void markRead(item);
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
              disabled={loading}
              onClick={() => void load(list.page + 1)}
            >
              {loading ? "불러오는 중…" : "더 보기"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
