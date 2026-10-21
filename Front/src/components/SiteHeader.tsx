import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import logo from "../assets/logo.png";
import { canAuthor, useAuth } from "../auth";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader({
  links,
  onSignOut,
}: {
  links: { path: string; label: string }[];
  onSignOut: () => void;
}) {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  // 화면을 옮기면 메뉴를 닫는다.
  useEffect(() => setMenuOpen(false), [pathname]);

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
        >
          <NavLink to="/" end>
            홈
          </NavLink>
          {/* /problems/new 는 "문제 만들기"만 활성화한다 */}
          <NavLink
            to="/problems"
            className={({ isActive }) =>
              isActive && pathname !== "/problems/new" ? "active" : ""
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
          {canAuthor(session) ? (
            <NavLink
              to="/problems/new"
              className={({ isActive }) =>
                isActive || pathname.startsWith("/my-problems")
                  ? "active"
                  : ""
              }
            >
              문제 만들기
            </NavLink>
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
              <button className="text-button" onClick={onSignOut}>
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
