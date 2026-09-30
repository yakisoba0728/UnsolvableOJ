import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  ProblemStatus,
  solveState,
} from "../components/ProblemStatus";
import { PageHeader } from "../components/PageHeader";
import { LearningIllustration } from "../components/LearningIllustration";
import { WeekStrip } from "../components/WeekStrip";
import {
  solvedToday,
  streakDays,
  submissionsByDay,
  useAllProblems,
  useSubmissionHistory,
} from "../hooks";
import type { RankingEntry, UserProfile } from "../types";
import { difficultyLabel } from "./ProblemsPage";

// 안 푼 문제 중 가장 쉬운 것부터 제안한다 (학습 순서)
const difficultyOrder = ["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"];

export function HomePage() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [rankError, setRankError] = useState("");
  const { problems, loading, error } = useAllProblems();
  const history = useSubmissionHistory(session);

  useEffect(() => {
    const controller = new AbortController();
    setRankError("");
    api<RankingEntry[]>("/rankings", { signal: controller.signal })
      .then(setRankings)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setRankError(
            cause instanceof Error ? cause.message : "랭킹을 불러오지 못했습니다.",
          );
      });
    if (session)
      api<UserProfile>(
        "/users/me",
        { signal: controller.signal },
        session.accessToken,
      )
        .then(setProfile)
        .catch(() => undefined);
    else setProfile(null);
    return () => controller.abort();
  }, [session]);

  const dayCounts = submissionsByDay(history.submissions);
  const streak = streakDays(dayCounts);
  const todaySolved = solvedToday(history.submissions);
  const DAILY_GOAL = 1;
  const myRank = session
    ? rankings.findIndex((entry) => entry.id === session.user.id)
    : -1;
  const topRankings = rankings.slice(0, 5);

  // 이어 풀 문제: 시도했지만 아직 해결하지 못한 가장 최근 문제만 해당한다.
  const resume =
    history.submissions.find(
      (item) => !history.solved.has(item.problem.id) && item.problem.slug,
    ) ?? null;
  // 진행 중인 문제가 없으면 아직 해결하지 않은 다음 문제를 제안한다.
  const nextProblem = resume
    ? null
    : ([...problems]
        .filter((problem) => !history.solved.has(problem.id))
        .sort(
          (a, b) =>
            difficultyOrder.indexOf(a.difficulty) -
            difficultyOrder.indexOf(b.difficulty),
        )[0] ?? null);
  const recommended = problems
    .filter((problem) => !history.solved.has(problem.id))
    .slice(0, 3);
  const name = session?.user.username;

  return (
    <div className="page-width home-page">
      <PageHeader
        title={name ? `${name}님, 오늘도 한 걸음.` : "오늘도 한 걸음."}
        description="어제의 고민을 오늘의 실력으로 이어가세요."
        aside={
          session && streak > 0 ? (
            <span className="pill pill-success">{streak}일 연속 학습 중</span>
          ) : null
        }
      />

      {error || rankError ? (
        <p className="error-message" role="alert">
          {error || rankError}
        </p>
      ) : null}

      <div className="home-top-grid">
        <section className="continue-card" aria-label="이어서 학습">
          <LearningIllustration />
          {session && resume ? (
            <>
              <span className="pill pill-primary">이어서 학습</span>
              <h2>{resume.problem.title ?? "문제"}</h2>
              <p className="muted">
                풀이 중 · 최근 제출{" "}
                {new Date(resume.updatedAt).toLocaleDateString("ko-KR")}
              </p>
              <Link
                className="button"
                to={
                  resume.problem.slug
                    ? `/problems/${resume.problem.slug}`
                    : "/problems"
                }
              >
                이어서 풀기
              </Link>
            </>
          ) : session && nextProblem ? (
            <>
              <span className="pill pill-primary">다음 도전</span>
              <h2>{nextProblem.title}</h2>
              <p className="muted">
                {difficultyLabel(nextProblem.difficulty)} ·{" "}
                {nextProblem.timeLimitMs}ms · {nextProblem.memoryLimitMb}MB
              </p>
              <Link className="button" to={`/problems/${nextProblem.slug}`}>
                풀어보기
              </Link>
            </>
          ) : session && history.solved.size > 0 && !loading ? (
            <>
              <span className="pill pill-success">모두 해결</span>
              <h2>공개된 문제를 모두 해결했어요.</h2>
              <p className="muted">새 문제가 올라오면 여기에서 알려드릴게요.</p>
              <Link className="button button-outline" to="/profile">
                내 학습 기록
              </Link>
            </>
          ) : session ? (
            <>
              <span className="pill pill-primary">시작해보세요</span>
              <h2>첫 문제를 골라 도전해보세요.</h2>
              <p className="muted">쉬운 문제부터 차근차근 시작할 수 있어요.</p>
              <Link className="button" to="/problems">
                문제 둘러보기
              </Link>
            </>
          ) : (
            <>
              <span className="pill pill-primary">못풀준과 함께</span>
              <h2>로그인하고 학습 기록을 남겨보세요.</h2>
              <p className="muted">
                문제 풀이, 랭킹, 성장 기록을 한곳에서 확인할 수 있어요.
              </p>
              <ul className="highlight-stats" aria-label="서비스 현황">
                <li>
                  <strong>{problems.length}</strong> 공개 문제
                </li>
                <li>
                  <strong>8</strong> 지원 언어
                </li>
                <li>
                  <strong>실시간</strong> 채점
                </li>
              </ul>
              <div className="card-actions">
                <Link className="button" to="/auth">
                  로그인
                </Link>
                <Link className="button button-outline" to="/problems">
                  문제 먼저 보기
                </Link>
              </div>
            </>
          )}
        </section>

        <section className="ranking-card" aria-label="랭킹">
          <div className="ranking-card-heading">
            <h2>랭킹</h2>
            <span className="muted">XP 기준</span>
          </div>
          {topRankings.length ? (
            <ol className="ranking-list">
              {topRankings.map((entry, index) => (
                <li
                  key={entry.id}
                  className={
                    entry.id === session?.user.id
                      ? "ranking-row current"
                      : "ranking-row"
                  }
                >
                  <span className="ranking-position">{index + 1}</span>
                  <span className="ranking-name">
                    {entry.username}
                    <small>Lv.{entry.level}</small>
                  </span>
                  <span className="ranking-xp">
                    {entry.xp.toLocaleString()} XP
                  </span>
                </li>
              ))}
              {myRank >= 5 ? (
                <li className="ranking-row current">
                  <span className="ranking-position">{myRank + 1}</span>
                  <span className="ranking-name">
                    {rankings[myRank].username} · 나
                    <small>Lv.{rankings[myRank].level}</small>
                  </span>
                  <span className="ranking-xp">
                    {rankings[myRank].xp.toLocaleString()} XP
                  </span>
                </li>
              ) : null}
            </ol>
          ) : (
            <p className="muted">랭킹 정보가 아직 없습니다.</p>
          )}
        </section>
      </div>

      {session ? (
        <section className="daily-card" aria-label="오늘의 목표">
          <div className="daily-goal">
            <h2>오늘의 목표</h2>
            <p>
              {todaySolved >= DAILY_GOAL
                ? "오늘 목표를 달성했어요. 한 문제 더 도전해 볼까요?"
                : `문제 ${DAILY_GOAL}개 해결하기`}
            </p>
            <div
              className="progress"
              role="progressbar"
              aria-label="오늘의 목표 진행률"
              aria-valuemin={0}
              aria-valuemax={DAILY_GOAL}
              aria-valuenow={Math.min(todaySolved, DAILY_GOAL)}
            >
              <span
                style={{
                  width: `${(Math.min(todaySolved, DAILY_GOAL) / DAILY_GOAL) * 100}%`,
                }}
              />
            </div>
            <small>
              {Math.min(todaySolved, DAILY_GOAL)} / {DAILY_GOAL}
            </small>
          </div>
          <WeekStrip counts={dayCounts} />
        </section>
      ) : null}

      {profile ? (
        <div className="stat-tiles">
          <Link to="/profile" className="stat-tile">
            <small>레벨</small>
            <strong>Lv.{profile.level}</strong>
            <span>{profile.xp.toLocaleString()} XP</span>
          </Link>
          <Link to="/profile" className="stat-tile">
            <small>해결한 문제</small>
            <strong>{profile.solvedCount}</strong>
            <span>
              {myRank >= 0 ? `랭킹 ${myRank + 1}위` : "랭킹 집계 전"}
            </span>
          </Link>
          <Link to="/profile" className="stat-tile">
            <small>연속 학습</small>
            <strong>{streak}일</strong>
            <span>{streak > 0 ? "오늘도 이어가요" : "오늘 한 문제 풀어요"}</span>
          </Link>
          <Link to="/profile" className="stat-tile">
            <small>레이팅</small>
            <strong>{profile.rating.toLocaleString()}</strong>
            <span>제출 {history.submissions.length}회</span>
          </Link>
        </div>
      ) : null}

      <section className="home-section">
        <div className="section-heading">
          <div>
            <h2>지금 풀기 좋은 문제</h2>
            <p>
              {session
                ? "아직 해결하지 않은 문제부터 골라 도전해 보세요."
                : "관심 있는 문제부터 시작해 보세요."}
            </p>
          </div>
          <Link className="inline-button" to="/problems">
            전체보기 →
          </Link>
        </div>
        {loading ? (
          <div className="empty-state">불러오는 중입니다…</div>
        ) : recommended.length ? (
          <div className="card-grid">
            {recommended.map((problem) => (
              <Link
                className="problem-card"
                to={`/problems/${problem.slug}`}
                key={problem.id}
              >
                <span
                  className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                >
                  {difficultyLabel(problem.difficulty)}
                </span>
                <strong>{problem.title}</strong>
                <small>
                  {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                </small>
                <span className="problem-card-foot">
                  <ProblemStatus
                    state={solveState(
                      problem.id,
                      history.solved,
                      history.attempted,
                    )}
                  />
                  <span className="button button-outline button-small">
                    문제 보기
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {problems.length
              ? "모든 문제를 해결했어요. 새 문제를 기다려 주세요."
              : "공개된 문제가 아직 없습니다."}
          </div>
        )}
      </section>
    </div>
  );
}
