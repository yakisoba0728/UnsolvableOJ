import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import {
  dayKey,
  streakDays,
  submissionsByDay,
  useSubmissionHistory,
  useDocumentTitle,
} from "../hooks";
import { allPosts, useActivity } from "../community/store";
import type { RankingEntry, UserProfile } from "../types";

const WEEKS_WIDE = 16;
const WEEKS_NARROW = 12;
const languageLabels: Record<string, string> = {
  C: "C",
  CPP: "C++",
  JAVA: "Java",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  GO: "Go",
  RUST: "Rust",
};
/** 다른 사용자들이 많이 쓰는 순서. 내가 쓰지 않은 언어는 이 순서로 0%를 채운다. */
const popularLanguages = [
  "PYTHON",
  "CPP",
  "JAVA",
  "C",
  "JAVASCRIPT",
  "TYPESCRIPT",
  "GO",
  "RUST",
];
const LANGUAGE_ROWS = 4;
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

/** 서버 규칙: level = 1 + xp / 100 */
const XP_PER_LEVEL = 100;

function heatLevel(count: number) {
  return count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 6 ? 3 : 4;
}

export function ProfilePage() {
  useDocumentTitle("내 학습 기록");
  const { session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [error, setError] = useState("");
  const activity = useActivity();
  const upvotedPosts = allPosts(activity).filter((post) =>
    activity.upvoted.includes(post.id),
  );
  const [selected, setSelected] = useState(dayKey(new Date()));
  const history = useSubmissionHistory(session);
  // 넓은 화면에서는 폭을 채우도록 주 수를 늘리고, 좁은 화면에서는 가로 스크롤이 생기지 않게 줄인다.
  const [weeks, setWeeks] = useState(() =>
    window.matchMedia("(max-width: 650px)").matches ? WEEKS_NARROW : WEEKS_WIDE,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 650px)");
    const update = () => setWeeks(media.matches ? WEEKS_NARROW : WEEKS_WIDE);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setError("");
    Promise.all([
      api<UserProfile>(
        "/users/me",
        { signal: controller.signal },
        session.accessToken,
      ).then(setProfile),
      api<RankingEntry[]>("/rankings", { signal: controller.signal }).then(
        setRankings,
      ),
    ]).catch((cause) => {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "정보를 불러오지 못했습니다.",
        );
    });
    return () => controller.abort();
  }, [session]);

  const counts = submissionsByDay(history.submissions);
  const streak = streakDays(counts);
  const rank = rankings.findIndex((entry) => entry.id === session?.user.id);

  // 오늘이 속한 주를 마지막 열로, 일요일 시작 12주 격자
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7);
  const columns = Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      return {
        date,
        future: date > today,
        count: counts.get(dayKey(date)) ?? 0,
      };
    }),
  );
  const totalSubmissions = history.submissions.length;
  const acceptedSubmissions = history.submissions.filter(
    (item) => item.status === "ACCEPTED",
  ).length;
  const accuracy = totalSubmissions
    ? Math.round((acceptedSubmissions / totalSubmissions) * 100)
    : null;
  const languageCounts = new Map<string, number>();
  for (const item of history.submissions)
    languageCounts.set(
      item.language,
      (languageCounts.get(item.language) ?? 0) + 1,
    );
  const languageStats = [
    ...[...languageCounts.entries()].sort((x, y) => y[1] - x[1]),
    ...popularLanguages
      .filter((language) => !languageCounts.has(language))
      .map((language): [string, number] => [language, 0]),
  ].slice(0, LANGUAGE_ROWS);
  const selectedCount = counts.get(selected) ?? 0;
  const [sy, sm, sd] = selected.split("-").map(Number);
  const selectedSubmissions = history.submissions.filter(
    (item) => dayKey(new Date(item.createdAt)) === selected,
  );

  if (!profile)
    return (
      <div className="page-width standalone-section">
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : (
          <div className="empty-state">학습 기록을 불러오는 중입니다…</div>
        )}
      </div>
    );

  const xpInLevel = profile.xp % XP_PER_LEVEL;

  return (
    <div className="page-width profile-page">
      <PageHeader
        title="내 학습 기록"
        description="쌓아 온 실력과 꾸준함을 한눈에 확인하세요."
      />
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}

      <section className="profile-card">
        <div className="avatar avatar-large" aria-hidden="true">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="profile-main">
          <h2>
            {profile.username} <small>@{profile.username}</small>
          </h2>
          <div className="profile-level">
            <span className="pill pill-warning">Lv.{profile.level}</span>
            <span className="muted">
              {xpInLevel} / {XP_PER_LEVEL} XP · 다음 레벨까지{" "}
              {XP_PER_LEVEL - xpInLevel} XP
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="레벨 진행률"
            aria-valuemin={0}
            aria-valuemax={XP_PER_LEVEL}
            aria-valuenow={xpInLevel}
          >
            <span style={{ width: `${xpInLevel}%` }} />
          </div>
        </div>
        <dl className="profile-stats">
          <div>
            <dt>해결한 문제</dt>
            <dd>{profile.solvedCount}</dd>
          </div>
          <div>
            <dt>전체 랭킹</dt>
            <dd>{rank >= 0 ? `#${rank + 1}` : "—"}</dd>
          </div>
          <div>
            <dt>연속 학습</dt>
            <dd>{streak}일</dd>
          </div>
          <div>
            <dt>레이팅</dt>
            <dd>{profile.rating.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <div className="profile-grid">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <h2>최근 제출 활동</h2>
              <p>
                최근 {weeks}주 · 총 {history.submissions.length}회 제출 · 현재{" "}
                {streak}일 연속 학습
              </p>
            </div>
          </div>
          <div className="activity">
            <div className="activity-graph">
              <div className="heatmap" role="group" aria-label="일별 제출 활동">
                <div className="heat-days" aria-hidden="true">
                  {weekdays.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                {columns.map((column, index) => (
                  <div className="heat-col" key={index}>
                    {column.map((cell) => {
                      const key = dayKey(cell.date);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={cell.future}
                          className={`heat-cell level-${heatLevel(cell.count)} ${selected === key ? "selected" : ""}`}
                          aria-pressed={selected === key}
                          aria-label={`${cell.date.getMonth() + 1}월 ${cell.date.getDate()}일 제출 ${cell.count}회`}
                          title={`${cell.date.getMonth() + 1}/${cell.date.getDate()} · ${cell.count}회`}
                          onClick={() => setSelected(key)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="heat-legend" aria-hidden="true">
                <span>적음</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <i key={level} className={`heat-cell level-${level}`} />
                ))}
                <span>많음</span>
              </div>
            </div>
            <div className="day-detail">
              <span className="muted">
                {sm}월 {sd}일{selected === dayKey(today) ? " · 오늘" : ""}
                <span className="sr-only"> {sy}년</span>
              </span>
              <p className="day-count">
                <strong>{selectedCount}회</strong> 코드를 제출했어요.
              </p>
              {selectedSubmissions.length ? (
                <ul className="history-list">
                  {selectedSubmissions.slice(0, 3).map((item) => (
                    <li key={item.id}>
                      <Link to={`/submissions/${item.id}`}>
                        <span
                          className={`verdict verdict-${item.status.toLowerCase()}`}
                        >
                          {item.status.replaceAll("_", " ")}
                        </span>
                        <span>{item.problem.title ?? "문제"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedSubmissions.length > 3 ? (
                <Link className="inline-button day-more" to="/submissions">
                  제출 {selectedSubmissions.length}건 모두 보기 →
                </Link>
              ) : null}
              {selectedSubmissions.length === 0 ? (
                selected === dayKey(today) ? (
                  <div className="day-empty">
                    <p className="muted">
                      오늘 제출이 없어요. 문제 하나로 하루를 시작해 보세요.
                    </p>
                    <Link className="button" to="/problems">
                      문제 풀러 가기 <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                ) : (
                  <p className="muted">이 날은 제출 기록이 없어요.</p>
                )
              ) : null}
            </div>
          </div>
        </section>

        <aside className="profile-side" aria-label="학습 통계">
          <section className="panel stats-panel">
            <div className="section-heading compact">
              <div>
                <h2>학습 통계</h2>
              </div>
            </div>
            <div className="stat-row">
              <span>푼 문제</span>
              <strong>{profile.solvedCount}개</strong>
            </div>
            <div className="stat-row">
              <span>정답률</span>
              <span className="muted">
                {accuracy === null ? "—" : `${accuracy}%`}
              </span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="정답률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={accuracy ?? 0}
            >
              <span style={{ width: `${accuracy ?? 0}%` }} />
            </div>
          </section>
          <section className="panel stats-panel">
            <div className="section-heading compact">
              <div>
                <h2>사용 언어</h2>
              </div>
            </div>
            <ul className="lang-stats">
              {languageStats.map(([language, count]) => {
                const percent = totalSubmissions
                  ? Math.round((count / totalSubmissions) * 100)
                  : 0;
                return (
                  <li key={language}>
                    <div className="lang-row">
                      <span>{languageLabels[language] ?? language}</span>
                      <span className="muted">{percent}%</span>
                    </div>
                    <div className="progress" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>

      <section className="panel upvoted-panel" aria-label="추천한 글">
        <div className="section-heading compact">
          <div>
            <h2>추천한 글</h2>
          </div>
        </div>
        {upvotedPosts.length ? (
          <ul className="upvoted-list">
            {upvotedPosts.map((post) => (
              <li key={post.id}>
                <Link to={`/community/${post.id}`}>{post.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">아직 추천한 글이 없어요.</p>
        )}
      </section>

      <section className="panel soon-inline">
        <div>
          <span className="pill">준비 중</span>
          <h2>나의 배지</h2>
          <p className="muted">
            연속 학습, 정확도 같은 성과 배지가 곧 추가됩니다.
          </p>
        </div>
      </section>
    </div>
  );
}
