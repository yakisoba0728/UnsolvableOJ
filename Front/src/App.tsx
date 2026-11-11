import { WithdrawalCompletePage } from "./pages/WithdrawalCompletePage";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import { canAuthor, useAuth } from "./auth";
import { HomePage } from "./pages/HomePage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotFoundPage } from "./components/NotFoundPage";
import { SiteHeader } from "./components/SiteHeader";

// 화면 단위로 코드를 나눠, 처음 방문한 화면의 코드만 내려받는다.
// import()는 호출하는 자리에 그대로 둬야 Vite가 화면마다 청크를 나눈다.
const lazyPage = <K extends string, M extends Record<K, ComponentType<any>>>(
  load: () => Promise<M>,
  name: K,
) => lazy(() => load().then((module) => ({ default: module[name] })));
const AdminPage = lazyPage(() => import("./pages/AdminPage"), "AdminPage");
const AnalysisPage = lazyPage(() => import("./pages/AnalysisPage"), "AnalysisPage");
const AnalysisQuestionPage = lazyPage(() => import("./pages/AnalysisQuestionPage"), "AnalysisQuestionPage");
const AuthPage = lazyPage(() => import("./pages/AuthPage"), "AuthPage");
const CommunityPage = lazyPage(() => import("./pages/CommunityPage"), "CommunityPage");
const CommunityPostPage = lazyPage(() => import("./pages/CommunityPostPage"), "CommunityPostPage");
const CommunityWritePage = lazyPage(() => import("./pages/CommunityWritePage"), "CommunityWritePage");
const CreateProblemPage = lazyPage(() => import("./pages/CreateProblemPage"), "CreateProblemPage");
const EnterpriseVibeReviewPage = lazyPage(() => import("./pages/EnterpriseVibeReviewPage"), "EnterpriseVibeReviewPage");
const EmailActionPage = lazyPage(() => import("./pages/EmailActionPage"), "EmailActionPage");
const EnterpriseDetailPage = lazyPage(() => import("./pages/EnterpriseDetailPage"), "EnterpriseDetailPage");
const EnterpriseJoinPage = lazyPage(() => import("./pages/EnterpriseJoinPage"), "EnterpriseJoinPage");
const EnterpriseAttemptPage = lazyPage(() => import("./pages/EnterpriseAttemptPage"), "EnterpriseAttemptPage");
const EnterpriseFormPage = lazyPage(() => import("./pages/EnterpriseFormPage"), "EnterpriseFormPage");
const EnterprisePage = lazyPage(() => import("./pages/EnterprisePage"), "EnterprisePage");
const MissionsPage = lazyPage(() => import("./pages/MissionsPage"), "MissionsPage");
const MyProblemsPage = lazyPage(() => import("./pages/MyProblemsPage"), "MyProblemsPage");
const ProblemPage = lazyPage(() => import("./pages/ProblemPage"), "ProblemPage");
const ProblemsPage = lazyPage(() => import("./pages/ProblemsPage"), "ProblemsPage");
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"), "ProfilePage");
const RankingsPage = lazyPage(() => import("./pages/RankingsPage"), "RankingsPage");
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const UserPage = lazyPage(() => import("./pages/UserPage"), "UserPage");
const SubmissionPage = lazyPage(() => import("./pages/SubmissionPage"), "SubmissionPage");
const SubmissionsPage = lazyPage(() => import("./pages/SubmissionsPage"), "SubmissionsPage");
const VibePage = lazyPage(() => import("./pages/VibePage"), "VibePage");
const VibeWorkspacePage = lazyPage(() => import("./pages/VibeWorkspacePage"), "VibeWorkspacePage");

const menu = [
  { path: "/analysis", label: "코드 분석" },
  { path: "/vibe", label: "바이브코딩" },
  { path: "/community", label: "커뮤니티" },
  { path: "/missions", label: "미션" },
  { path: "/enterprise", label: "기업 테스트" },
];

export function App({ getNavigationVersion }: { getNavigationVersion: () => number }) {
  const { session, setSession } = useAuth();
  const { pathname, search, hash, key: locationKey } = useLocation();
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
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <SiteHeader
        links={menu}
        onSignOut={() => {
          signedOutRef.current = true;
          // 서버의 refresh token도 끊는다. 실패해도(오프라인 등) 이 브라우저에서는 로그아웃한다.
          if (session?.refreshToken)
            void api("/auth/logout", {
              method: "POST",
              body: JSON.stringify({ refreshToken: session.refreshToken }),
            }).catch(() => {});
          setSession(null);
          navigate("/");
        }}
      />
      <main className="main-content" id="main" tabIndex={-1}>
        <ErrorBoundary resetKey={pathname}>
          <Suspense
            fallback={
              <div className="page-width empty-state">불러오는 중입니다…</div>
            }
          >
            {/* 임시 비밀번호로 로그인했다면 비밀번호를 바꿀 때까지 계정 설정에 머문다(서버도 다른 API를 403으로 막는다). */}
            {session?.user.mustChangePassword && pathname !== "/settings" && pathname !== "/email/unsubscribe" ? (
              <Navigate to="/settings" replace />
            ) : (
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
              <Route
                path="/settings"
                element={session ? <SettingsPage key={session.user.id} /> : loginRedirect}
              />
              <Route path="/account/withdrawn" element={<WithdrawalCompletePage />} />
              <Route path="/email/verify" element={<EmailActionPage key={`verify:${locationKey}:${hash}`} action="verify" />} />
              <Route path="/email/unsubscribe" element={<EmailActionPage key={`unsubscribe:${locationKey}:${hash}`} action="unsubscribe" />} />
              <Route path="/rankings" element={<RankingsPage />} />
              <Route path="/users/:username" element={<UserPage />} />
              <Route path="/community" element={<CommunityPage />} />
              {/* 계정이나 글이 바뀌면 이전 작성자의 폼 상태를 재사용하지 않는다. */}
              <Route
                path="/community/new"
                element={
                  session ? (
                    <CommunityWritePage key={`${session.user.id}:${session.accessToken}:${pathname}`} getNavigationVersion={getNavigationVersion} />
                  ) : (
                    loginRedirect
                  )
                }
              />
              <Route
                path="/community/:id/edit"
                element={
                  session ? (
                    <CommunityWritePage key={`${session.user.id}:${session.accessToken}:${pathname}`} getNavigationVersion={getNavigationVersion} />
                  ) : (
                    loginRedirect
                  )
                }
              />
              <Route path="/community/:id" element={<CommunityPostPage key={`${session?.user.id}:${session?.accessToken}:${pathname}`} getNavigationVersion={getNavigationVersion} />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/vibe" element={<VibePage key={session?.user.id ?? 'guest'} />} />
              <Route path="/vibe/attempts/:id" element={session ? <VibeWorkspacePage key={`${session.user.id}:${pathname}`} /> : loginRedirect} />
              <Route path="/analysis/:id" element={<AnalysisQuestionPage />} />
              <Route path="/missions" element={<MissionsPage />} />
              <Route path="/enterprise" element={<EnterprisePage />} />
              <Route path="/enterprise/new" element={session ? <EnterpriseFormPage key={session.user.id} /> : loginRedirect} />
              <Route path="/enterprise/:id" element={<EnterpriseDetailPage />} />
              <Route path="/enterprise/join/:code" element={<EnterpriseJoinPage />} />
              <Route path="/enterprise/attempts/:id" element={<EnterpriseAttemptPage />} />
              <Route path="/enterprise/:testId/attempts/:attemptId/vibe/:id" element={session ? <EnterpriseVibeReviewPage key={`${session.user.id}:${pathname}`} /> : loginRedirect} />
              <Route path="/enterprise/:id/edit" element={session ? <EnterpriseFormPage key={`${session.user.id}:${pathname}`} /> : loginRedirect} />
              <Route
                path="/submissions"
                element={session ? <SubmissionsPage key={session.user.id} /> : loginRedirect}
              />
              <Route
                path="/submissions/:id"
                element={session ? <SubmissionPage key={session.user.id} /> : loginRedirect}
              />
              <Route
                path="/admin/*"
                element={
                  session?.user.role === "ADMIN" ? (
                    <AdminPage key={session.user.id} />
                  ) : !session ? (
                    loginRedirect
                  ) : (
                    <NotFoundPage />
                  )
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <span>못풀준 · 하나씩 풀어가는 온라인 저지</span>
        <span>UNSOLVABLE OJ</span>
      </footer>
    </div>
  );
}
