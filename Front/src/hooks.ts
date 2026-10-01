import { useEffect, useState } from "react";
import { api } from "./api";
import type {
  Page,
  ProblemSummary,
  RankingEntry,
  Session,
  Submission,
  UserProfile,
} from "./types";

const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

async function fetchAll<T>(
  path: string,
  signal: AbortSignal,
  token?: string,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await api<Page<T>>(
      `${path}${separator}page=${page}&limit=${PAGE_LIMIT}`,
      { signal },
      token,
    );
    items.push(...data.items);
    if (page >= data.totalPages) break;
  }
  return items;
}

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
      .then(setProblems)
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

  useEffect(() => {
    if (!session) {
      setSubmissions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchAll<Submission>(
      "/submissions",
      controller.signal,
      session.accessToken,
    )
      .then(setSubmissions)
      .catch(() => {
        if (!controller.signal.aborted) setSubmissions([]);
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
  return { submissions, solved, attempted, latest: submissions[0] ?? null, loading };
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

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setRank(-1);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      api<UserProfile>(
        "/users/me",
        { signal: controller.signal },
        session.accessToken,
      ),
      api<RankingEntry[]>("/rankings", { signal: controller.signal }),
    ])
      .then(([me, rankings]) => {
        setProfile(me);
        setRank(rankings.findIndex((entry) => entry.id === me.id));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [session]);

  return { profile, rank };
}

/** 탭·히스토리·공유에서 화면을 구분하도록 페이지별 제목을 설정한다. 제목이 없으면 기본 제목. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | 못풀준` : "못풀준 · UnsolvableOJ";
  }, [title]);
}
