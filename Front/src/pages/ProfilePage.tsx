import { useEffect, useState } from "react";
import { verdictLabel } from "../verdict";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { PageHeader } from "../components/PageHeader";
import {
  dayKey,
  streakDays,
  learningByDay,
  submissionsByDay,
  useMyCommunityPosts,
  useMyStanding,
  useProblemPage,
  useSubmissionHistory,
  useDocumentTitle,
} from "../hooks";
import { PostScroller } from "../components/PostScroller";
import { BADGE_LABELS, LANGUAGE_LABELS } from "../types";
import { difficultyOptions } from "../difficulty";
import { calendarDate, parseCalendarDate } from "../calendar";
import { userPath } from "../paths";

const WEEKS_WIDE = 16;
const WEEKS_NARROW = 12;
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
  const { profile, rank, rankLoading, profileError, rankError, retryProfile, retryRank } =
    useMyStanding(session);
  const communityPosts = useMyCommunityPosts(session);
  const [selected, setSelected] = useState(dayKey(new Date()));
  const history = useSubmissionHistory(session);
  // 푼 공개 문제의 난이도별 수는 목록 API의 칩 숫자로 받는다(문제 전체를 받지 않는다).
  const {
    data: solvedList,
    loading: problemsLoading,
    error: problemsError,
    retry: retryProblems,
  } = useProblemPage("limit=1&solve=solved", session);
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

  const counts = submissionsByDay(history.submissions);
  const streak = streakDays(learningByDay(history.submissions));

  // 오늘이 속한 주를 마지막 열로, 일요일 시작 주 단위 격자(넓은 화면 16주, 좁은 화면 12주)
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
  const solvedByDifficulty = solvedList?.facets?.difficulties ?? {};
  const solvedTotal = solvedByDifficulty[""] ?? 0;
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
  const selectedIso = calendarDate(new Date(sy, sm - 1, sd));
  const visibleDays = columns.flat().filter((cell) => !cell.future);
  const focusDay = visibleDays.some((cell) => dayKey(cell.date) === selected)
    ? selected : dayKey(visibleDays[visibleDays.length - 1].date);

  if (profileError)
    return (
      <div className="page-width standalone-section">
        <p className="error-message" role="alert">
          {profileError}{" "}
          <button type="button" className="inline-button" onClick={retryProfile}>
            다시 시도
          </button>
        </p>
      </div>
    );
  // 프로필·랭킹·제출 기록·문제 목록이 모두 도착하기 전에는 0 같은 임시 값을 보이지 않는다.
  if (
    !profile ||
    rankLoading ||
    history.loading ||
    problemsLoading ||
    communityPosts.loading
  )
    return (
      <div className="page-width profile-page">
        <PageHeader
          title="내 학습 기록"
          description="쌓아 온 실력과 꾸준함을 한눈에 확인하세요."
        />
        <SkeletonRegion
          className="profile-skeleton"
          label="학습 기록을 불러오는 중입니다"
        >
          <div className="profile-skeleton-card">
            <Skeleton width={72} height={72} radius="50%" />
            <div className="profile-skeleton-lines">
              <Skeleton width={180} height={22} />
              <Skeleton width={240} height={14} />
              <Skeleton height={10} />
            </div>
          </div>
          <div className="profile-skeleton-grid">
            <Skeleton height={220} radius={14} />
            <Skeleton height={220} radius={14} />
          </div>
          <Skeleton height={180} radius={14} />
        </SkeletonRegion>
      </div>
    );

  const xpInLevel = profile.xp % XP_PER_LEVEL;

  return (
    <div className="page-width profile-page">
      <PageHeader
        title="내 학습 기록"
        description="쌓아 온 실력과 꾸준함을 한눈에 확인하세요."
        aside={
          <div className="account-links">
            <Link className="button button-small button-outline" to={userPath(profile.username)}>
              공개 프로필
            </Link>
            <Link className="button button-small button-outline" to="/settings">
              계정 설정
            </Link>
          </div>
        }
      />
      {rankError || history.error || problemsError || communityPosts.error ? (
        <p className="error-message" role="alert">
          {rankError || history.error || problemsError || communityPosts.error}{" "}
          <button
            type="button"
            className="inline-button"
            onClick={() => {
              if (rankError) retryRank();
              if (history.error) history.retry();
              if (problemsError) retryProblems();
              if (communityPosts.error) communityPosts.retry();
            }}
          >
            다시 시도
          </button>
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
          <div aria-label="획득한 배지">
            {profile.badges?.map((b) => (
              <span className="pill" key={b.badge}>
                {BADGE_LABELS[b.badge] ?? b.badge}
              </span>
            ))}
          </div>
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
            <span style={{ width: `${(xpInLevel / XP_PER_LEVEL) * 100}%` }} />
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
        </dl>
      </section>

      <div className="profile-grid">
        <div className="profile-main-col">
          <section className="panel activity-panel">
            <div className="section-heading compact">
              <div>
                <h2>최근 제출 활동</h2>
                <p>
                  최근 {weeks}주 · 총 {history.submissions.length}회 제출 · 현재{" "}
                  {streak}일 연속 학습
                </p>
              </div>
              <div className="heat-legend" aria-hidden="true">
                <span>적음</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <i key={level} className={`heat-cell level-${level}`} />
                ))}
                <span>많음</span>
              </div>
            </div>
            <div className="activity">
              <div className="activity-graph">
                <div
                  className="heatmap"
                  role="group"
                  aria-label="일별 제출 활동"
                  onKeyDown={(event) => {
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                    const index = buttons.indexOf(event.target as HTMLButtonElement);
                    if (index < 0) return;
                    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
                    let next = index + (offsets[event.key] ?? 0);
                    if (event.key === "Home") next = event.ctrlKey ? 0 : Math.floor(index / 7) * 7;
                    else if (event.key === "End") next = event.ctrlKey ? buttons.length - 1 : Math.floor(index / 7) * 7 + 6;
                    else if (offsets[event.key] === undefined) return;
                    event.preventDefault();
                    const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
                    setSelected(button.dataset.day!);
                    button.focus();
                  }}
                >
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
                            data-day={key}
                            tabIndex={key === focusDay ? 0 : -1}
                            className={`heat-cell level-${heatLevel(cell.count)} ${selected === key ? "selected" : ""}`}
                            aria-pressed={selected === key}
                            aria-label={`${cell.date.getFullYear()}년 ${cell.date.getMonth() + 1}월 ${cell.date.getDate()}일 제출 ${cell.count}회`}
                            title={`${cell.date.getMonth() + 1}/${cell.date.getDate()} · ${cell.count}회`}
                            onClick={() => setSelected(key)}
                          />
                        );
                      })}
                    </div>
                  ))}
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
                            {verdictLabel(item.status)}
                          </span>
                          <span>{item.problem.title ?? "문제"}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {selectedSubmissions.length > 3 ? (
                  <Link className="inline-button day-more" to={`/submissions?date=${selectedIso}`}>
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

          <details className="activity-list-alternative">
            <summary>일별 활동 목록 (히트맵 대안)</summary>
            <p className="muted">히트맵은 방향키로 이동합니다. 날짜 입력으로도 기록을 확인할 수 있어요.</p>
            <label htmlFor="activity-date">활동 날짜 (기기 현지 시간)</label>
            <input id="activity-date" type="date" value={selectedIso} max={calendarDate(today)} onChange={(event) => {
              const date = parseCalendarDate(event.target.value);
              if (date && date <= today) setSelected(dayKey(date));
            }} />
            <ul>{[...visibleDays].reverse().filter((cell) => cell.count > 0).map((cell) => <li key={dayKey(cell.date)}>
              <Link to={`/submissions?date=${calendarDate(cell.date)}`}>{calendarDate(cell.date)} · 제출 {cell.count}회</Link>
            </li>)}</ul>
            <Link to={`/submissions?date=${selectedIso}`}>{selectedIso} 제출 내역 보기</Link>
          </details>
          <div className="profile-post-pair">
            <PostScroller
              title="작성한 글"
              posts={communityPosts.data.written}
              emptyText="아직 작성한 글이 없어요. 궁금한 점이나 나만의 풀이를 첫 글로 남겨 보세요."
              emptyAction={{ label: "글 작성하러 가기", to: "/community/new" }}
            />
            <PostScroller
              title="추천한 글"
              posts={communityPosts.data.voted}
              emptyText="아직 추천한 글이 없어요. 도움이 된 글에 추천을 눌러 보세요."
              emptyAction={{ label: "커뮤니티 둘러보기", to: "/community" }}
            />
            <PostScroller
              title="저장한 글"
              posts={communityPosts.data.saved}
              emptyText="아직 저장한 글이 없어요. 다시 보고 싶은 글을 저장해 보세요."
              emptyAction={{ label: "커뮤니티 둘러보기", to: "/community" }}
            />
          </div>
        </div>

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
                      <span className="lang-name">
                        {LANGUAGE_LABELS[language] ?? language}
                      </span>
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
          <section className="panel stats-panel difficulty-panel">
            <div className="section-heading compact">
              <div>
                <h2>푼 문제 난이도</h2>
              </div>
            </div>
            <ul className="lang-stats">
              {difficultyOptions.map((row) => {
                const count = solvedByDifficulty[row.value] ?? 0;
                const percent = solvedTotal
                  ? Math.round((count / solvedTotal) * 100)
                  : 0;
                return (
                  <li key={row.value}>
                    <div className="lang-row">
                      <span className="lang-name">
                        {row.label}
                        <span className="lang-sep" aria-hidden="true">
                          |
                        </span>
                        <span className="lang-detail muted">{count}문제</span>
                      </span>
                      <span className="muted">{percent}%</span>
                    </div>
                    <div className="progress" aria-hidden="true">
                      <span
                        className={`diff-${row.value.toLowerCase()}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
