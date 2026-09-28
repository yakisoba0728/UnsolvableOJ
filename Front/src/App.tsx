import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AuthPage } from "./pages/AuthPage";
import { CreateProblemPage } from "./pages/CreateProblemPage";
import { ProblemPage } from "./pages/ProblemPage";
import { ProblemsPage } from "./pages/ProblemsPage";
import { SubmissionPage } from "./pages/SubmissionPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";

export function App() {
  const { session, setSession } = useAuth();
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <Link to="/problems" className="brand" aria-label="못풀준 홈">
            <span className="brand-mark">
              U<span>_</span>
            </span>
            <span>
              못풀준 <small>UNSOLVABLE OJ</small>
            </span>
          </Link>
          <nav className="main-nav" aria-label="주 메뉴">
            <NavLink to="/problems">문제</NavLink>
            {session ? <NavLink to="/submissions">내 제출</NavLink> : null}
            {session && session.user.role !== "USER" ? (
              <NavLink to="/problems/new">문제 만들기</NavLink>
            ) : null}
          </nav>
          <div className="account-actions">
            {session ? (
              <>
                <span className="account-name">{session.user.username}</span>
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
        </div>
      </header>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/problems" replace />} />
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
          <Route path="/problems/view/:slug" element={<ProblemPage />} />
          <Route path="/problems/:slug" element={<ProblemPage />} />
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
            element={
              <div className="empty-state">
                <h1>페이지를 찾을 수 없습니다.</h1>
                <Link to="/problems">문제 목록으로</Link>
              </div>
            }
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
