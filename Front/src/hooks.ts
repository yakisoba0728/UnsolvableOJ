import {
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type RefObject,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { getMyPosts } from "./community/api";
import { fetchAll } from "./pagination";
import { DIFFICULTIES } from "./difficulty";
import type {
  ProblemSummary,
  RankingEntry,
  Session,
  Submission,
  UserProfile,
} from "./types";

/** load가 있으면 요청해 결과·로딩·오류를 돌려준다. deps가 바뀌면 이전 요청을 취소하고 다시 받는다. */
export function useRequest<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  initial: T,
  failure: string,
  deps: DependencyList,
) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(Boolean(load));
  const [error, setError] = useState("");
  useEffect(() => {
    setData(initial);
    setError("");
    setLoading(Boolean(load));
    if (!load) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, deps);
  return { data, loading, error };
}

/** 공개 문제 전체. 서버에 검색 API가 없어 목록·검색·필터를 클라이언트에서 처리한다. */
export function useAllProblems() {
  const { data: problems, loading, error } = useRequest(
    (signal) => fetchAll<ProblemSummary>("/problems", signal),
    [],
    "문제를 불러오지 못했습니다.",
    [],
  );
  return { problems, loading, error };
}

/** 내 제출 기록에서 해결/시도한 문제를 계산한다. */
export function useSubmissionHistory(session: Session | null) {
  const { data: submissions, loading, error } = useRequest(
    session
      ? (signal) =>
          fetchAll<Submission>("/submissions", signal, session.accessToken)
      : null,
    [],
    "제출 기록을 불러오지 못했습니다.",
    [session],
  );
  const solved = new Set<string>();
  const attempted = new Set<string>();
  for (const item of submissions) {
    attempted.add(item.problem.id);
    if (item.status === "ACCEPTED") solved.add(item.problem.id);
  }
  return { submissions, solved, attempted, loading, error };
}

/** 내가 쓴 글·추천한 글·저장한 글과 팔로우한 작성자 id (프로필·미션·커뮤니티 목록) */
export function useMyCommunityPosts(session: Session | null) {
  return useRequest(
    session ? (signal) => getMyPosts(session.accessToken, signal) : null,
    { written: [], voted: [], saved: [], following: [] as string[] },
    "커뮤니티 글을 불러오지 못했습니다.",
    [session],
  );
}

/** 임시 저장 시각을 "오후 03:12"처럼 보여 준다. */
export const savedTime = (at: Date | number) =>
  new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

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

/** 내 프로필과 전체 랭킹·내 순위. 랭킹은 홈의 랭킹 카드를 위해 로그인하지 않아도 받는다. */
export function useMyStanding(session: Session | null) {
  const profile = useRequest(
    session
      ? (signal) =>
          api<UserProfile>("/users/me", { signal }, session.accessToken)
      : null,
    null,
    "프로필을 불러오지 못했습니다.",
    [session],
  );
  const rankings = useRequest(
    (signal) => api<RankingEntry[]>("/rankings", { signal }),
    [],
    "랭킹을 불러오지 못했습니다.",
    [session],
  );
  return {
    profile: profile.data,
    rankings: rankings.data,
    rank: session
      ? rankings.data.findIndex((entry) => entry.id === session.user.id)
      : -1,
    profileLoading: profile.loading,
    rankLoading: rankings.loading,
    profileError: profile.error,
    rankError: rankings.error,
  };
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

/**
 * 목록 조건(검색어 q·쪽 page 등)을 URL에 저장한다. 뒤로 가도 같은 목록이 복원되고 주소를 공유할 수 있다.
 * 검색어는 입력은 즉시 반영하고 URL에는 잠시 멈춘 뒤 저장한다(한글 입력 중 끊김 방지).
 * hold가 참을 돌려주는 입력은 아직 URL에 쓰지 않는다.
 */
export function useUrlFilters(hold?: (text: string) => boolean) {
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const urlQuery = params.get("q") ?? "";
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);

  /** 빈 값은 지우고, 배열은 같은 키를 반복해 쓴다. 조건이 바뀌면 첫 쪽으로 돌아간다. */
  function update(
    patch: Record<string, string | string[] | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(paramsRef.current);
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
      else if (value) next.set(key, value);
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    paramsRef.current = next;
    setParams(next, { replace: true });
  }

  const [queryText, setQueryText] = useState(urlQuery);
  const lastWritten = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastWritten.current) {
      lastWritten.current = urlQuery;
      setQueryText(urlQuery);
    }
  }, [urlQuery]);
  useEffect(() => {
    if (queryText === urlQuery || hold?.(queryText)) return;
    // 다듬지 않고 저장한다: 주소 값이 입력칸으로 되돌아오므로 다듬으면 입력 중인 공백이 사라진다.
    const timer = setTimeout(() => {
      lastWritten.current = queryText;
      update({ q: queryText || null });
    }, 250);
    return () => clearTimeout(timer);
  }, [queryText, urlQuery]);

  return { params, update, urlQuery, queryText, setQueryText, page };
}

/** "/" 키로 검색창에 바로 이동한다(LeetCode·GitHub 방식). 다른 칸에 입력 중일 때는 가로채지 않는다. */
export function useSlashFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (event.key !== "/" || typing || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
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
