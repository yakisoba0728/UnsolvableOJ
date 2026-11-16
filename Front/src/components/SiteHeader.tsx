import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import logo from "../assets/logo.png";
import { useAuth } from "../auth";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({
  links,
  onSignOut,
}: {
  links: { path: string; label: string }[];
  onSignOut: () => void;
}) {
  const { session, getSessionIdentityVersion } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sessionIdentity = `${session?.user.id ?? "guest"}:${getSessionIdentityVersion()}`;

  // 데스크톱 메뉴: 활성 메뉴 아래 표시선이 새 위치로 미끄러져 이동한다.
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(
    null,
  );
  const [indicatorReady, setIndicatorReady] = useState(false);
  const role = session?.user.role;
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>("a.active");
      setIndicator(
        active ? { x: active.offsetLeft, w: active.offsetWidth } : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    void document.fonts?.ready.then(measure);
    // 첫 배치는 애니메이션 없이 제자리에 놓는다.
    const frame = requestAnimationFrame(() => setIndicatorReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [pathname, Boolean(session), role]);

  // A disclosure is not a modal: opening it places keyboard users on its first
  // link, but Tab remains free to leave the panel. The DOM puts the toggle after
  // the links, so leaving focus on the toggle would skip every disclosed link.
  useLayoutEffect(() => {
    if (menuOpen && window.matchMedia("(max-width: 1100px)").matches)
      navRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [menuOpen]);

  // RouteFocus owns the destination after navigation, including lazy routes.
  useLayoutEffect(() => setMenuOpen(false), [pathname]);
  // A role/account change can remove the focused link without a route change.
  useLayoutEffect(() => {
    if (menuOpen && window.matchMedia("(max-width: 1100px)").matches)
      menuButtonRef.current?.focus({ preventScroll: true });
    setMenuOpen(false);
  }, [sessionIdentity, role]);

  useLayoutEffect(() => {
    const collapsed = window.matchMedia("(max-width: 1100px)");
    const belongsToMenu = (element: EventTarget | null): element is HTMLElement =>
      element instanceof HTMLElement &&
      (element === menuButtonRef.current || Boolean(navRef.current?.contains(element)));
    // CSS can hide and blur the toggle/navigation before matchMedia delivers
    // its change event. Retain that focus owner only across a hidden-element
    // blur; an actual focus move or outside pointer action clears ownership.
    let lastMenuFocus = belongsToMenu(document.activeElement) ? document.activeElement : null;
    const rememberFocus = (event: FocusEvent) => {
      if ((event.target === document.body || event.target === document.documentElement) &&
          lastMenuFocus && !lastMenuFocus.getClientRects().length)
        return;
      lastMenuFocus = belongsToMenu(event.target) ? event.target : null;
    };
    const forgetVisibleBlur = (event: FocusEvent) => {
      if (event.target === lastMenuFocus && lastMenuFocus?.getClientRects().length)
        lastMenuFocus = null;
    };
    const forgetOutsidePointer = (event: PointerEvent) => {
      if (!belongsToMenu(event.target)) lastMenuFocus = null;
    };
    const resized = () => {
      const focused = document.activeElement;
      const nav = navRef.current;
      const owner = belongsToMenu(focused) ? focused :
        focused === document.body || focused === document.documentElement ? lastMenuFocus : null;
      setMenuOpen(false);
      if (collapsed.matches && owner && nav?.contains(owner)) {
        menuButtonRef.current?.focus({ preventScroll: true });
      } else if (!collapsed.matches && owner === menuButtonRef.current) {
        (nav?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ??
          nav?.querySelector<HTMLAnchorElement>("a"))?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", rememberFocus, true);
    document.addEventListener("focusout", forgetVisibleBlur, true);
    document.addEventListener("pointerdown", forgetOutsidePointer, true);
    collapsed.addEventListener("change", resized);
    return () => {
      document.removeEventListener("focusin", rememberFocus, true);
      document.removeEventListener("focusout", forgetVisibleBlur, true);
      document.removeEventListener("pointerdown", forgetOutsidePointer, true);
      collapsed.removeEventListener("change", resized);
    };
  }, []);

  // 열려 있는 동안: Esc로 닫고(버튼으로 포커스 복귀), 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);
  return (
    <header className="site-header" ref={headerRef}>
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="못풀준 홈">
          <img
            className="brand-mark"
            src={logo}
            alt=""
            width="38"
            height="38"
          />
          <span>못풀준</span>
        </Link>
        <nav
          className={`main-nav ${menuOpen ? "open" : ""}`}
          id="main-menu"
          aria-label="주 메뉴"
          ref={navRef}
          onClick={(event) => {
            // Close even when activating the current route (pathname is then
            // unchanged). Modified clicks keep this tab's disclosure intact.
            if (!menuOpen || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
              return;
            if ((event.target as Element).closest("a")) {
              setMenuOpen(false);
              menuButtonRef.current?.focus({ preventScroll: true });
            }
          }}
          onBlur={(event) => {
            if (menuOpen && event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== menuButtonRef.current)
              setMenuOpen(false);
          }}
        >
          <NavLink to="/" end>
            홈
          </NavLink>
          <NavLink
            to="/problems"
            className={({ isActive }) =>
              isActive || pathname.startsWith("/my-problems") ? "active" : ""
            }
          >
            문제
          </NavLink>
          {links.map((item) => (
            <NavLink to={item.path} key={item.path}>
              {item.label}
            </NavLink>
          ))}
          {session ? <NavLink to="/submissions">내 제출</NavLink> : null}
          {role === "ADMIN" ? <NavLink to="/admin">관리</NavLink> : null}
          {session ? (
            <button
              type="button"
              className="text-button mobile-signout"
              onClick={() => {
                setMenuOpen(false);
                onSignOut();
              }}
            >
              로그아웃
            </button>
          ) : null}
          <span
            className={`nav-indicator ${indicatorReady ? "ready" : ""}`}
            aria-hidden="true"
            style={{
              width: indicator?.w ?? 0,
              transform: `translateX(${indicator?.x ?? 0}px)`,
              opacity: indicator ? 1 : 0,
            }}
          />
        </nav>
        <div className="account-actions">
          <ThemeToggle />
          {session ? (
            <>
              <NotificationBell
                key={`${session.user.id}:${getSessionIdentityVersion()}`}
                token={session.accessToken}
              />
              <Link
                className="account-link"
                to="/profile"
                aria-label="내 학습 기록"
              >
                <span className="account-name">{session.user.username}</span>
                <span className="avatar" aria-hidden="true">
                  {session.user.username.slice(0, 1).toUpperCase()}
                </span>
              </Link>
              <button className="text-button header-signout" onClick={onSignOut}>
                로그아웃
              </button>
            </>
          ) : (
            <Link className="button button-small" to="/auth">
              로그인
            </Link>
          )}
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button menu-button"
          aria-expanded={menuOpen}
          aria-controls="main-menu"
          aria-label="메뉴"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            aria-hidden="true"
            focusable="false"
          >
            {menuOpen ? (
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
}
