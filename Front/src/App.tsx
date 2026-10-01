import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { isDemo } from "./api";
import { useAuth } from "./auth";
import { ComingSoonPage } from "./components/ComingSoonPage";
import { NotFoundPage } from "./components/NotFoundPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { AuthPage } from "./pages/AuthPage";
import { CreateProblemPage } from "./pages/CreateProblemPage";
import { HomePage } from "./pages/HomePage";
import { ProblemPage } from "./pages/ProblemPage";
import { ProblemsPage } from "./pages/ProblemsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SubmissionPage } from "./pages/SubmissionPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";

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
  {
    path: "/community",
    label: "커뮤니티",
    page: {
      title: "커뮤니티",
      description: "질문하고, 풀이를 나누고, 더 좋은 풀이로 이어가는 공간입니다.",
      points: [
        "질문 · 풀이 공유 · 자유 · 공지 카테고리",
        "답변과 추천, 글 작성 중 초안 자동 복원",
        "문제 페이지의 '질문' 탭과 연결",
      ],
      cta: { to: "/problems", label: "문제 둘러보기" },
    },
  },
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

export function App() {
  const { session, setSession } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
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
            <span className="brand-mark">
              U<span>_</span>
            </span>
            <span>못풀준</span>
          </Link>
          <nav
            className={`main-nav ${menuOpen ? "open" : ""}`}
            id="main-menu"
            aria-label="주 메뉴"
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
            {session && session.user.role !== "USER" ? (
              <NavLink to="/problems/new">문제 만들기</NavLink>
            ) : null}
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
                  onClick={() => setSession(null)}
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
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              {menuOpen ? (
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </header>
      {isDemo ? (
        <div className="demo-banner" role="status">
          <span>
            <strong>데모 모드</strong> · 더미 데이터와 시뮬레이션 채점 · 기록은
            이 브라우저에만 저장됩니다.
          </span>
          <button
            className="text-button"
            onClick={() => {
              try {
                localStorage.removeItem("unsolvable-oj-demo-v1");
                localStorage.removeItem("unsolvable-oj-session-v1");
              } catch {
                /* 저장소를 쓸 수 없으면 새로고침만 한다 */
              }
              window.location.assign("/");
            }}
          >
            데이터 초기화
          </button>
        </div>
      ) : null}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route
            path="/problems/new"
            element={
              session?.user.role === "AUTHOR" ||
              session?.user.role === "ADMIN" ? (
                <CreateProblemPage />
              ) : (
                <Navigate to="/problems" replace />
              )
            }
          />
          <Route path="/problems/:slug" element={<ProblemPage />} />
          <Route
            path="/profile"
            element={
              session ? <ProfilePage /> : <Navigate to="/auth" replace />
            }
          />
          {upcoming.map((item) => (
            <Route
              key={item.path}
              path={item.path}
              element={<ComingSoonPage {...item.page} />}
            />
          ))}
          <Route
            path="/submissions"
            element={
              session ? <SubmissionsPage /> : <Navigate to="/auth" replace />
            }
          />
          <Route
            path="/submissions/:id"
            element={
              session ? <SubmissionPage /> : <Navigate to="/auth" replace />
            }
          />
          <Route
            path="*"
            element={<NotFoundPage />}
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>못풀준 · 하나씩 풀어가는 온라인 저지</span>
        <span>UNSOLVABLE OJ</span>
      </footer>
    </div>
  );
}
