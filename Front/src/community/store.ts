import { useSyncExternalStore } from "react";
import { authorStats, seedAccepted, seedAnswers, seedPosts } from "./data";
import type {
  AuthorStats,
  CategoryKey,
  CommunityAnswer,
  CommunityAuthor,
  CommunityPost,
} from "./types";

/** 이 브라우저에만 저장되는 사용자 활동. 더미 데이터 위에 겹쳐서 보여준다. */
interface Activity {
  posts: CommunityPost[];
  answers: CommunityAnswer[];
  /** 추천한 글·답변 id */
  upvoted: string[];
  saved: string[];
  followed: string[];
  /** 게시글 id → 채택한 답변 id (사용자가 바꾼 값만) */
  accepted: Record<string, string | null>;
}

const storageKey = "unsolvable-oj-community-v1";
const draftKey = "unsolvable-oj-community-draft-v1";

const empty: Activity = {
  posts: [],
  answers: [],
  upvoted: [],
  saved: [],
  followed: [],
  accepted: {},
};

function load(): Activity {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw
      ? { ...empty, ...(JSON.parse(raw) as Partial<Activity>) }
      : empty;
  } catch {
    return empty;
  }
}

let state: Activity = load();
const listeners = new Set<() => void>();

function commit(next: Activity) {
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 방문에는 반영한다 */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      state = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => state;

export const useActivity = () => useSyncExternalStore(subscribe, snapshot);

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

export const communityActions = {
  addPost(input: {
    category: CategoryKey;
    title: string;
    body: string;
    tags: string[];
    code?: string;
    language?: string;
    author: CommunityAuthor;
  }): CommunityPost {
    const post: CommunityPost = {
      id: `u-${Date.now().toString(36)}`,
      ...input,
      createdAt: new Date().toISOString(),
      upvotes: 0,
      views: 1,
      pinned: input.category === "notice" ? true : undefined,
    };
    commit({ ...state, posts: [post, ...state.posts] });
    return post;
  },
  addAnswer(postId: string, body: string, author: CommunityAuthor) {
    const answer: CommunityAnswer = {
      id: `ua-${Date.now().toString(36)}`,
      postId,
      author,
      body,
      createdAt: new Date().toISOString(),
      upvotes: 0,
    };
    commit({ ...state, answers: [...state.answers, answer] });
    return answer;
  },
  toggleUpvote: (id: string) =>
    commit({ ...state, upvoted: toggle(state.upvoted, id) }),
  toggleSaved: (id: string) =>
    commit({ ...state, saved: toggle(state.saved, id) }),
  toggleFollow: (name: string) =>
    commit({ ...state, followed: toggle(state.followed, name) }),
  setAccepted: (postId: string, answerId: string | null) =>
    commit({ ...state, accepted: { ...state.accepted, [postId]: answerId } }),
};

export const allPosts = (activity: Activity) => [
  ...activity.posts,
  ...seedPosts,
];

export const answersOf = (activity: Activity, postId: string) =>
  [...seedAnswers, ...activity.answers].filter(
    (answer) => answer.postId === postId,
  );

export function acceptedAnswerId(activity: Activity, postId: string) {
  if (postId in activity.accepted) return activity.accepted[postId];
  return seedAccepted[postId] ?? null;
}

/** 내가 추천했다면 +1 (추천 취소는 더미 값 그대로) */
export const upvoteCount = (activity: Activity, id: string, base: number) =>
  base + (activity.upvoted.includes(id) ? 1 : 0);

export function statsOf(activity: Activity, name: string): AuthorStats {
  const known = authorStats[name];
  if (known) return known;
  return {
    reputation: 0,
    acceptedAnswers: activity.answers.filter(
      (answer) =>
        answer.author.name === name &&
        acceptedAnswerId(activity, answer.postId) === answer.id,
    ).length,
    posts: activity.posts.filter((post) => post.author.name === name).length,
  };
}

/** 글 작성 초안 (임시 저장 · 이탈 후 복원) */
export interface PostDraft {
  category: CategoryKey;
  title: string;
  tags: string[];
  body: string;
  savedAt: number;
  code?: string;
  language?: string;
  problemId?: string | null;
}

export function readDraft(scope = "demo"): PostDraft | null {
  try {
    const raw = localStorage.getItem(draftKey + ":" + scope);
    if (!raw) return null;
    const value = JSON.parse(raw) as PostDraft;
    if (
      !value ||
      !["question", "solution", "review", "free", "notice"].includes(
        value.category,
      ) ||
      typeof value.title !== "string" ||
      typeof value.body !== "string" ||
      !Array.isArray(value.tags) ||
      value.tags.some((t) => typeof t !== "string")
    )
      return null;
    if (
      (value.code !== undefined && typeof value.code !== "string") ||
      (value.language !== undefined && typeof value.language !== "string") ||
      (value.problemId != null && typeof value.problemId !== "string")
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function writeDraft(draft: PostDraft, scope = "demo"): boolean {
  try {
    localStorage.setItem(draftKey + ":" + scope, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(scope = "demo") {
  try {
    localStorage.removeItem(draftKey + ":" + scope);
  } catch {
    /* 무시 */
  }
}

const answerDraftKey = (postId: string) =>
  `unsolvable-oj-community-answer-draft-v1:${postId}`;

export function readAnswerDraft(postId: string) {
  try {
    return localStorage.getItem(answerDraftKey(postId)) ?? "";
  } catch {
    return "";
  }
}

export function writeAnswerDraft(postId: string, text: string) {
  try {
    if (text) localStorage.setItem(answerDraftKey(postId), text);
    else localStorage.removeItem(answerDraftKey(postId));
  } catch {
    /* 무시 */
  }
}

/** "2시간 전" · "어제" 같은 짧은 상대 시각 */
export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}
