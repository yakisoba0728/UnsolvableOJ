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
  const countRequest = useRef<AbortController | null>(null);
  // Only GET responses use this epoch. Mutation response order does not establish
  // server state; after all mutations settle, fetch that state again.
  const queryEpoch = useRef(0);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const openRef = useRef(open);
  openRef.current = open;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function setPanelOpen(next: boolean) {
    openRef.current = next;
    setOpen(next);
  }

  function invalidateQueries() {
    queryEpoch.current += 1;
    countRequest.current?.abort();
    countRequest.current = null;
    listRequest.current?.abort();
    listRequest.current = null;
    setLoading(false);
  }

  async function refreshUnread(reportFailure = false) {
    // An open list supplies its own count. Polling must not invalidate its rows.
    if (readRequests.current.size || listRequest.current) return;
    countRequest.current?.abort();
    const controller = new AbortController();
    countRequest.current = controller;
    const epoch = ++queryEpoch.current;
    try {
      const result = await request<{ unread: number }>(tokenRef.current, "/unread-count", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && epoch === queryEpoch.current && !readRequests.current.size)
        setUnread(result.unread);
    } catch {
      if (reportFailure && !controller.signal.aborted && epoch === queryEpoch.current)
        setError("읽음 상태를 다시 확인하지 못했어요.");
    } finally {
      if (countRequest.current === controller) countRequest.current = null;
    }
  }

  useEffect(() => {
    let timer: number | undefined;
    const poll = () => {
      window.clearTimeout(timer);
      countRequest.current?.abort();
      if (document.hidden) return;
      timer = window.setTimeout(poll, POLL_MS);
      void refreshUnread();
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(timer);
      countRequest.current?.abort();
      document.removeEventListener("visibilitychange", poll);
    };
  }, [token]);

  useEffect(() => () => {
    listRequest.current?.abort();
    countRequest.current?.abort();
    readRequests.current.forEach((controller) => controller.abort());
  }, []);

  async function load(page: number, preserveError = false) {
    // A repeated click before React paints the disabled button is also ignored.
    if (page > 1 && listRequest.current) return;
    listRequest.current?.abort();
    countRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const epoch = ++queryEpoch.current;
    if (!preserveError) setError("");
    setLoading(true);
    try {
      const next = await request<NotificationPage>(
        tokenRef.current,
        `?page=${page}&limit=${PAGE_SIZE}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || epoch !== queryEpoch.current || readRequests.current.size) return;
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
      if (!controller.signal.aborted && epoch === queryEpoch.current && !readRequests.current.size) {
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
      setPanelOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function finishRead(controller: AbortController) {
    readRequests.current.delete(controller);
    if (controller.signal.aborted) return;
    // This also rejects a GET started while a mutation was in flight, even when
    // its response arrives after that mutation. Reconcile on success and failure.
    invalidateQueries();
    if (!readRequests.current.size) {
      if (openRef.current) void load(1, true);
      else void refreshUnread(true);
    }
  }

  async function markRead(item: AppNotification) {
    if (item.readAt) return;
    const controller = new AbortController();
    readRequests.current.add(controller);
    invalidateQueries();
    try {
      await request(tokenRef.current, `/${item.id}/read`, {
        method: "PUT", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const readAt = new Date().toISOString();
      setList((current) => current && {
        ...current,
        items: current.items.map((other) => other.id === item.id ? { ...other, readAt } : other),
      });
    } catch {
      if (!controller.signal.aborted) setError("읽음으로 바꾸지 못했어요.");
    } finally {
      finishRead(controller);
    }
  }

  async function markAllRead() {
    if (markingAllRef.current || listRequest.current) return;
    markingAllRef.current = true;
    setMarkingAll(true);
    const controller = new AbortController();
    readRequests.current.add(controller);
    invalidateQueries();
    try {
      await request(tokenRef.current, "/read-all", { method: "PUT", signal: controller.signal });
      if (controller.signal.aborted) return;
      const readAt = new Date().toISOString();
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
      markingAllRef.current = false;
      if (!controller.signal.aborted) setMarkingAll(false);
      finishRead(controller);
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
        onClick={() => setPanelOpen(!openRef.current)}
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
                        setPanelOpen(false);
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
