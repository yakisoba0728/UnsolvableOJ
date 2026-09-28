import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type {
  Page,
  ProblemSummary,
  RankingEntry,
  Submission,
  UserProfile,
} from "../types";
import { difficultyLabel } from "./ProblemsPage";

export function HomePage() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [latestSubmission, setLatestSubmission] = useState<Submission | null>(
    null,
  );
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const tasks: Promise<void>[] = [
      api<Page<ProblemSummary>>("/problems?page=1&limit=5", {
        signal: controller.signal,
      }).then((data) => setProblems(data.items)),
      api<RankingEntry[]>("/rankings", { signal: controller.signal }).then(
        setRankings,
      ),
    ];
    if (session) {
      tasks.push(
        api<UserProfile>(
          "/users/me",
          { signal: controller.signal },
          session.accessToken,
        ).then(setProfile),
      );
      tasks.push(
        api<Page<Submission>>(
          "/submissions?page=1&limit=1",
          { signal: controller.signal },
          session.accessToken,
        ).then((data) => setLatestSubmission(data.items[0] ?? null)),
      );
    }
    Promise.all(tasks)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "정보를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  const myRank = session
    ? rankings.findIndex((entry) => entry.id === session.user.id)
    : -1;
  const topRankings = rankings.slice(0, 5);

  return (
    <div className="page-width content-section standalone-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">DASHBOARD</span>
          <h1>홈</h1>
          <p>오늘도 한 문제, 어제보다 나은 실력을 만들어보세요.</p>
        </div>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <div className="home-top-grid">
        <div className="continue-card">
          {session && latestSubmission ? (
            <>
              <span className="eyebrow">계속 풀어보기</span>
              <h2>{latestSubmission.problem.title ?? "문제"}</h2>
              <p className="muted">
                {latestSubmission.language} · 최근 제출{" "}
                {new Date(latestSubmission.updatedAt).toLocaleDateString(
                  "ko-KR",
                )}
              </p>
              <Link
                className="button"
                to={
                  latestSubmission.problem.slug
                    ? `/problems/${latestSubmission.problem.slug}`
                    : "/problems"
                }
              >
                다시 풀기 <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : session ? (
            <>
              <span className="eyebrow">시작해보세요</span>
              <h2>아직 제출한 문제가 없어요.</h2>
              <p className="muted">첫 문제를 골라 도전해보세요.</p>
              <Link className="button" to="/problems">
                문제 둘러보기 <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : (
            <>
              <span className="eyebrow">못풀준과 함께</span>
              <h2>로그인하고 학습 기록을 남겨보세요.</h2>
              <p className="muted">
                문제 풀이, 랭킹, 성장 기록을 확인할 수 있어요.
              </p>
              <Link className="button" to="/auth">
                로그인 <span aria-hidden="true">→</span>
              </Link>
            </>
          )}
        </div>
        <div className="ranking-card">
          <div className="ranking-card-heading">
            <h2>랭킹</h2>
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
                    {rankings[myRank].username}
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
        </div>
      </div>
      {profile ? (
        <div className="result-stats home-stats">
          <div>
            <small>레벨</small>
            <strong>Lv.{profile.level}</strong>
          </div>
          <div>
            <small>누적 XP</small>
            <strong>{profile.xp.toLocaleString()}</strong>
          </div>
          <div>
            <small>레이팅</small>
            <strong>{profile.rating.toLocaleString()}</strong>
          </div>
          <div>
            <small>해결한 문제</small>
            <strong>{profile.solvedCount}</strong>
          </div>
        </div>
      ) : null}
      <section className="content-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PROBLEM SET</span>
            <h2>추천 문제</h2>
            <p>새롭게 추가된 문제부터 도전해보세요.</p>
          </div>
          <Link className="inline-button" to="/problems">
            전체보기 ↗
          </Link>
        </div>
        {loading ? (
          <div className="empty-state">불러오는 중입니다…</div>
        ) : problems.length ? (
          <div className="problem-list">
            {problems.map((problem) => (
              <Link
                className="problem-row"
                to={`/problems/${problem.slug}`}
                key={problem.id}
              >
                <span className="problem-title">
                  <strong>{problem.title}</strong>
                  <small>/{problem.slug}</small>
                </span>
                <span
                  className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
                >
                  {difficultyLabel(problem.difficulty)}
                </span>
                <span className="problem-limit">
                  {problem.timeLimitMs}ms · {problem.memoryLimitMb}MB
                </span>
                <span className="row-arrow" aria-hidden="true">
                  ↗
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">공개된 문제가 아직 없습니다.</div>
        )}
      </section>
    </div>
  );
}
