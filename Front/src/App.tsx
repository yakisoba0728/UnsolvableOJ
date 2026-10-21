import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useNavigate,
} from "react-router-dom";
import logo from "./assets/logo.png";
import { canAuthor, useAuth } from "./auth";
import { HomePage } from "./pages/HomePage";
import { ComingSoonPage } from "./components/ComingSoonPage";
import { NotFoundPage } from "./components/NotFoundPage";
import { ThemeToggle } from "./components/ThemeToggle";

// 화면 단위로 코드를 나눠, 처음 방문한 화면의 코드만 내려받는다.
// import()는 호출하는 자리에 그대로 둬야 Vite가 화면마다 청크를 나눈다.
const lazyPage = <K extends string, M extends Record<K, ComponentType<any>>>(
  load: () => Promise<M>,
  name: K,
) => lazy(() => load().then((module) => ({ default: module[name] })));
const AuthPage = lazyPage(() => import("./pages/AuthPage"), "AuthPage");
const CommunityPage = lazyPage(() => import("./pages/CommunityPage"), "CommunityPage");
const CommunityPostPage = lazyPage(() => import("./pages/CommunityPostPage"), "CommunityPostPage");
const CommunityWritePage = lazyPage(() => import("./pages/CommunityWritePage"), "CommunityWritePage");
const CreateProblemPage = lazyPage(() => import("./pages/CreateProblemPage"), "CreateProblemPage");
const MyProblemsPage = lazyPage(() => import("./pages/MyProblemsPage"), "MyProblemsPage");
const ProblemPage = lazyPage(() => import("./pages/ProblemPage"), "ProblemPage");
const ProblemsPage = lazyPage(() => import("./pages/ProblemsPage"), "ProblemsPage");
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"), "ProfilePage");
const SubmissionPage = lazyPage(() => import("./pages/SubmissionPage"), "SubmissionPage");
const SubmissionsPage = lazyPage(() => import("./pages/SubmissionsPage"), "SubmissionsPage");

const upcoming = [
  {
    path: "/analysis",
    label: "코드 분석",
    page: {
      title: "코드 분석",
      description: "모범 답안을 읽고 원리를 추론하는 학습 모드입니다.",
      points: [
        "객관식으로 코드의 동작·복잡도를 맞히고 해설 확인",
        "오답 해설과 개념 보완, 학습 진행 유지",
        "코드 품질 비교와 최적화 대회 (후순위)",
      ],
      cta: { to: "/problems", label: "문제 풀러 가기" },
    },
  },
  // 커뮤니티는 실제 화면이 있어 준비 중 안내(page)가 없다.
  { path: "/community", label: "커뮤니티" },
  {
    path: "/missions",
    label: "미션",
    page: {
      title: "미션",
      description: "일일 퀘스트와 시즌 미션으로 꾸준히 학습을 이어가세요.",
      points: [
        "일일 · 시즌 미션 진행률과 보상 수령",
        "연속 학습과 레벨·XP 보상 연동",
        "홈 화면의 '진행 중인 미션'과 연결",
      ],
      cta: { to: "/profile", label: "내 학습 기록 보기" },
    },
  },
  {
    path: "/enterprise",
    label: "기업 테스트",
    page: {
      title: "기업 테스트",
      description: "기업이 코딩 테스트를 만들고 운영하는 공간입니다.",
      points: [
        "테스트 생성 · 상태별 목록 · 운영 지표",
        "응시자 결과 관리",
        "실제 기업 출제 유형 문제와 커리큘럼 추천",
      ],
      cta: { to: "/problems", label: "문제 연습하기" },
    },
  },
];

export function App({ getNavigationVersion }: { getNavigationVersion: () => number }) {
  const { session, setSession } = useAuth();
  const { pathname, search, hash } = useLocation();
  const navigationType = useNavigationType();
  // 다른 화면으로 이동하면 스크롤을 맨 위로 올린다(뒤로 가기는 브라우저 동작에 맡기고,
  // 같은 화면에서 필터·검색 주소만 바뀔 때는 위치를 유지한다).
  useEffect(() => {
    if (navigationType === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  const navigate = useNavigate();
  // 로그아웃 직후에는 로그인 화면이 아니라 홈으로 보낸다.
  const signedOutRef = useRef(false);
  useEffect(() => {
    if (session) signedOutRef.current = false;
  }, [session]);
  const loginRedirect = (
    <Navigate
      to={signedOutRef.current ? "/" : "/auth"}
      replace
      state={signedOutRef.current ? undefined : { from: pathname + search + hash }}
    />
  );
  /** 비로그인은 로그인으로, 권한이 없는 로그인 사용자는 문제 목록으로 보낸다. */
  const authorOnly = (element: ReactElement) =>
    canAuthor(session) ? (
      element
    ) : !session ? (
      loginRedirect
    ) : (
      <Navigate to="/problems" replace />
    );
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
    <div className="app-shell">
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
            {upcoming.map((item) => (
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
                <button
                  className="text-button"
                  onClick={() => {
                    signedOutRef.current = true;
                    setSession(null);
                    navigate("/");
                  }}
                >
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
      <main className="main-content">
        <Suspense
          fallback={
            <div className="page-width empty-state">불러오는 중입니다…</div>
          }
        >
          <Routes>
            <Route
              path="/"
              element={<HomePage key={session ? `user:${session.user.id}` : "guest"} />}
            />
            <Route path="/auth" element={<AuthPage getNavigationVersion={getNavigationVersion} />} />
            <Route path="/problems" element={<ProblemsPage />} />
            <Route
              path="/problems/new"
              element={authorOnly(
                <CreateProblemPage key={`${session?.user.id}:${pathname}`} />,
              )}
            />
            <Route
              path="/my-problems"
              element={authorOnly(<MyProblemsPage key={session?.user.id} />)}
            />
            <Route
              path="/my-problems/:id/edit"
              element={authorOnly(
                <CreateProblemPage key={`${session?.user.id}:${pathname}`} />,
              )}
            />
            <Route path="/problems/view/:slug" element={<ProblemPage />} />
            <Route path="/problems/:slug" element={<ProblemPage />} />
            <Route
              path="/profile"
              element={session ? <ProfilePage key={session.user.id} /> : loginRedirect}
            />
            <Route path="/community" element={<CommunityPage />} />
            {/* 계정이나 글이 바뀌면 이전 작성자의 폼 상태를 재사용하지 않는다. */}
            <Route
              path="/community/new"
              element={
                session ? (
                  <CommunityWritePage key={`${session.user.id}:${pathname}`} />
                ) : (
                  loginRedirect
                )
              }
            />
            <Route
              path="/community/:id/edit"
              element={
                session ? (
                  <CommunityWritePage key={`${session.user.id}:${pathname}`} />
                ) : (
                  loginRedirect
                )
              }
            />
            <Route path="/community/:id" element={<CommunityPostPage />} />
            {upcoming.map((item) =>
              item.page ? (
                <Route
                  key={item.path}
                  path={item.path}
                  element={<ComingSoonPage {...item.page} />}
                />
              ) : null,
            )}
            <Route
              path="/submissions"
              element={session ? <SubmissionsPage key={session.user.id} /> : loginRedirect}
            />
            <Route
              path="/submissions/:id"
              element={session ? <SubmissionPage key={session.user.id} /> : loginRedirect}
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="site-footer">
        <span>못풀준 · 하나씩 풀어가는 온라인 저지</span>
        <span>UNSOLVABLE OJ</span>
      </footer>
    </div>
  );
}
