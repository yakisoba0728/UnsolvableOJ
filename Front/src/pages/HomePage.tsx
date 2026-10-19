import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ProblemStatus, solveState } from "../components/ProblemStatus";
import { PageHeader } from "../components/PageHeader";
import { CardSlider } from "../components/CardSlider";
import { BrandArt } from "../components/BrandArt";
import { WeekStrip } from "../components/WeekStrip";
import {
  solvedToday,
  streakDays,
  submissionsByDay,
  useDocumentTitle,
  useAllProblems,
  useSubmissionHistory,
} from "../hooks";
import { LANGUAGES, type RankingEntry, type UserProfile } from "../types";
import { problemPath } from "../paths";
import { difficultyLabel } from "./ProblemsPage";

export function HomePage() {
  const { session } = useAuth();
  useDocumentTitle();
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
            cause instanceof Error
              ? cause.message
              : "랭킹을 불러오지 못했습니다.",
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
  // 내가 6위 밖이면 상위 5명 + 내 순위, 그 외에는 상위 6명 (어느 쪽이든 6줄로 카드 높이를 맞춘다)
  const topRankings = rankings.slice(0, myRank >= 5 ? 5 : 6);

  const recommended = problems
    .filter((problem) => !history.solved.has(problem.id))
    .slice(0, 7); // 슬라이더는 이 7장 + "전체보기" 카드 = 총 8장
  const name = session?.user.username;

  return (
    <div className="page-width home-page">
      <PageHeader
        title={name ? `${name}님, 오늘도 한 걸음.` : "오늘도 한 걸음."}
        description="어제의 고민을 오늘의 실력으로 이어가세요."
      />

      {error || rankError || history.error ? (
        <p className="error-message" role="alert">
          {error || rankError || history.error}
        </p>
      ) : null}

      <div className="home-top-grid">
        <section className="continue-card with-art" aria-label="못풀준 소개">
          <BrandArt />
          <>
            <span className="pill pill-primary">못풀준과 함께</span>
            <h2>게임처럼 성장하는 온라인 저지</h2>
            <p className="muted">
              문제를 풀고 채점받으며 레벨·랭킹·미션으로 꾸준히 성장해 보세요.
            </p>
            <ul className="highlight-stats" aria-label="서비스 현황">
              <li>
                <strong>{problems.length}</strong>
                <span>공개 문제</span>
              </li>
              <li>
                <strong>{LANGUAGES.length}</strong>
                <span>지원 언어</span>
              </li>
              <li>
                <strong>실시간</strong>
                <span>자동 채점</span>
              </li>
            </ul>
          </>
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
            <span>{myRank >= 0 ? `랭킹 ${myRank + 1}위` : "랭킹 집계 전"}</span>
          </Link>
          <Link to="/profile" className="stat-tile">
            <small>연속 학습</small>
            <strong>{streak}일</strong>
            <span>
              {streak > 0 ? "오늘도 이어가요" : "오늘 한 문제 풀어요"}
            </span>
          </Link>
          <Link to="/profile" className="stat-tile">
            <small>레이팅</small>
            <strong>{profile.rating.toLocaleString()}</strong>
            <span>제출 {history.submissions.length}회</span>
          </Link>
        </div>
      ) : null}

      {loading ? (
        <section className="home-section">
          <div className="section-heading">
            <div>
              <h2>지금 풀기 좋은 문제</h2>
            </div>
          </div>
          <div className="empty-state">불러오는 중입니다…</div>
        </section>
      ) : recommended.length ? (
        <CardSlider
          title="지금 풀기 좋은 문제"
          description={
            session
              ? "아직 해결하지 않은 문제부터 골라 도전해 보세요."
              : "관심 있는 문제부터 시작해 보세요."
          }
          label="추천 문제"
          count={recommended.length}
        >
          {recommended.map((problem) => (
            <Link
              className="problem-card"
              to={problemPath(problem.slug)}
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
          <Link className="problem-card problem-card-more" to="/problems">
            <span className="more-arrow" aria-hidden="true">
              →
            </span>
            <strong>전체보기</strong>
            <small>{problems.length}개 문제 모두 보기</small>
          </Link>
        </CardSlider>
      ) : (
        <section className="home-section">
          <div className="section-heading">
            <div>
              <h2>지금 풀기 좋은 문제</h2>
            </div>
            <Link className="inline-button" to="/problems">
              전체보기 →
            </Link>
          </div>
          <div className="empty-state">
            {problems.length
              ? "모든 문제를 해결했어요. 새 문제를 기다려 주세요."
              : "공개된 문제가 아직 없습니다."}
          </div>
        </section>
      )}
    </div>
  );
}
