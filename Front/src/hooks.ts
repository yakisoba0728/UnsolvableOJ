import { useEffect, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { fetchAll } from "./pagination";
import { DIFFICULTIES } from "./difficulty";
export { fetchAll } from "./pagination";
import type {
  ProblemSummary,
  RankingEntry,
  Session,
  Submission,
  UserProfile,
} from "./types";

/** 공개 문제 전체. 서버에 검색 API가 없어 목록·검색·필터를 클라이언트에서 처리한다. */
export function useAllProblems() {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchAll<ProblemSummary>("/problems", controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setProblems(items);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "문제를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return { problems, loading, error };
}

/** 내 제출 기록에서 해결/시도한 문제와 마지막 제출을 계산한다. */
export function useSubmissionHistory(session: Session | null) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      setSubmissions([]);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setSubmissions([]);
    setError("");
    fetchAll<Submission>("/submissions", controller.signal, session.accessToken)
      .then((items) => {
        if (!controller.signal.aborted) setSubmissions(items);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "제출 기록을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  const solved = new Set<string>();
  const attempted = new Set<string>();
  for (const item of submissions) {
    attempted.add(item.problem.id);
    if (item.status === "ACCEPTED") solved.add(item.problem.id);
  }
  return {
    submissions,
    solved,
    attempted,
    latest: submissions[0] ?? null,
    loading,
    error,
  };
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 제출 기록의 날짜별 제출 횟수. */
export function submissionsByDay(submissions: Submission[]) {
  const counts = new Map<string, number>();
  for (const item of submissions) {
    const key = dayKey(new Date(item.createdAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 오늘(없으면 어제)부터 거꾸로 이어진 연속 제출 일수. */
export function streakDays(counts: Map<string, number>) {
  const cursor = new Date();
  if (!counts.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (counts.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 오늘 새로 해결(ACCEPTED)한 서로 다른 문제 수. */
export function solvedToday(submissions: Submission[]) {
  const today = dayKey(new Date());
  return new Set(
    submissions
      .filter(
        (item) =>
          item.status === "ACCEPTED" &&
          dayKey(new Date(item.createdAt)) === today,
      )
      .map((item) => item.problem.id),
  ).size;
}

/** 내 프로필과 전체 랭킹 순위. */
export function useMyStanding(session: Session | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rank, setRank] = useState(-1);
  const [profileLoading, setProfileLoading] = useState(Boolean(session));
  const [rankLoading, setRankLoading] = useState(Boolean(session));
  const [profileError, setProfileError] = useState("");
  const [rankError, setRankError] = useState("");

  useEffect(() => {
    setProfile(null);
    setRank(-1);
    setProfileError("");
    setRankError("");
    setProfileLoading(Boolean(session));
    setRankLoading(Boolean(session));
    if (!session) {
      return;
    }
    const controller = new AbortController();
    api<UserProfile>(
      "/users/me",
      { signal: controller.signal },
      session.accessToken,
    )
      .then((me) => {
        if (!controller.signal.aborted) setProfile(me);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setProfileError(
            cause instanceof Error
              ? cause.message
              : "프로필을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
    api<RankingEntry[]>("/rankings", { signal: controller.signal })
      .then((rankings) => {
        if (!controller.signal.aborted)
          setRank(rankings.findIndex((entry) => entry.id === session.user.id));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setRankError(
            cause instanceof Error
              ? cause.message
              : "순위를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRankLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  return { profile, rank, profileLoading, rankLoading, profileError, rankError };
}

/**
 * 다른 화면이 navigate state로 넘긴 안내(notice)를 한 번 읽고 기록에서는 지운다.
 * 남겨 두면 새로고침·뒤로 가기마다 다시 뜬다. listSearch 같은 나머지 state는 그대로 둔다.
 */
export function useFlashNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { notice?: string } | null;
  const [notice, setNotice] = useState(state?.notice ?? "");
  useEffect(() => {
    if (!state?.notice) return;
    setNotice(state.notice);
    const { notice: _shown, ...rest } = state;
    navigate(location.pathname + location.search + location.hash, {
      replace: true,
      state: rest,
    });
  }, [state, location.pathname, location.search, location.hash, navigate]);
  return [notice, setNotice] as const;
}

/** 탭·히스토리·공유에서 화면을 구분하도록 페이지별 제목을 설정한다. 제목이 없으면 기본 제목. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | 못풀준` : "못풀준 · UnsolvableOJ";
  }, [title]);
}

/** 공개 목록에 남아 있는 미해결 문제의 가장 최근 제출(이어서 풀 문제). */
export function pickResume(
  submissions: Submission[],
  solved: Set<string>,
  problems: ProblemSummary[],
) {
  const published = new Set(problems.map((problem) => problem.id));
  return (
    submissions.find(
      (item) =>
        !solved.has(item.problem.id) &&
        published.has(item.problem.id),
    ) ?? null
  );
}

/** 아직 해결하지 않은 문제 중 가장 쉬운 것(다음 도전). */
export function pickNextProblem(
  problems: ProblemSummary[],
  solved: Set<string>,
) {
  return (
    [...problems]
      .filter((problem) => !solved.has(problem.id))
      .sort(
        (a, b) =>
          DIFFICULTIES.indexOf(a.difficulty) -
          DIFFICULTIES.indexOf(b.difficulty),
      )[0] ?? null
  );
}

/**
 * 스크롤을 따라다니는(sticky) 사이드 영역의 top 값을 계산한다.
 * 영역이 화면보다 짧으면 `top`(머리글 아래)에 붙고, 더 길면 top을 음수로 줘서
 * 아래쪽 끝이 화면 아래에 닿을 때까지 스크롤된 뒤 멈춘다(내용이 잘리지 않는다).
 */
export function useStickyTop<T extends HTMLElement>(
  ref: RefObject<T | null>,
  top = 80,
  bottomGap = 16,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const fit = window.innerHeight - el.offsetHeight - bottomGap;
      el.style.setProperty("--side-top", `${Math.min(top, fit)}px`);
    };
    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
      el.style.removeProperty("--side-top");
    };
  }, [ref, top, bottomGap]);
}
