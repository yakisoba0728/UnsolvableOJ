import { useSyncExternalStore } from "react";
import type {
  AuthorStats,
  CategoryKey,
  CommunityAnswer,
  CommunityAuthor,
  CommunityPost,
} from "./types";

/** 이 브라우저에만 저장되는 사용자 활동. 커뮤니티 서버가 생기기 전까지 화면에 보여 준다. */
interface Activity {
  posts: CommunityPost[];
  answers: CommunityAnswer[];
  /** 추천한 글·답변 id */
  upvoted: string[];
  followed: string[];
  /** 게시글 id → 채택한 답변 id (사용자가 바꾼 값만) */
  accepted: Record<string, string | null>;
}

const storageKey = "unsolvable-oj-community-v1";
// 소유자를 알 수 없는 v1 초안은 그대로 보관하고 어느 계정에도 자동으로 넘기지 않는다.
const draftKey = "unsolvable-oj-community-draft-v2";

const empty: Activity = {
  posts: [],
  answers: [],
  upvoted: [],
  followed: [],
  accepted: {},
};

// 예전 기록에 남은 saved·deleted 키는 읽어도 쓰지 않는다.
function load(strict = false, raw?: string | null): Activity {
  try {
    const saved = raw === undefined ? localStorage.getItem(storageKey) : raw;
    return saved
      ? { ...empty, ...(JSON.parse(saved) as Partial<Activity>) }
      : empty;
  } catch (cause) {
    if (strict) throw cause;
    return empty;
  }
}

let state: Activity = load();
let snapshotRaw: string | null | undefined;
const listeners = new Set<() => void>();

function commit(update: (current: Activity) => Activity) {
  // shortcut: 탭 사이의 읽기·쓰기가 원자적이지 않다. 동시 수정을 차례로 처리해야 하면 잠금을 추가한다.
  const next = update(load(true));
  const serialized = JSON.stringify(next);
  localStorage.setItem(storageKey, serialized);
  state = next;
  snapshotRaw = serialized;
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  snapshot();
  listeners.forEach((listener) => listener());
}

// 다른 탭의 변경은 커뮤니티 화면을 벗어난 동안에도 반영한다.
window.addEventListener("storage", onStorage);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== snapshotRaw) {
      // 폼의 useState 초기화 전에 읽되, 같은 저장값은 같은 스냅샷을 반환한다.
      state = load(false, raw);
      snapshotRaw = raw;
    }
  } catch {
    // 읽기가 막히면 마지막 스냅샷을 유지한다. 변경은 commit의 엄격한 읽기에서 거절된다.
  }
  return state;
}

export const useActivity = () => useSyncExternalStore(subscribe, snapshot);

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

function requirePost(activity: Activity, postId: string) {
  if (!activity.posts.some((post) => post.id === postId))
    throw new Error("글이 삭제되었거나 존재하지 않아요.");
}

export const communityActions = {
  addPost(input: {
    category: CategoryKey;
    title: string;
    body: string;
    tags: string[];
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
    commit((current) => ({ ...current, posts: [post, ...current.posts] }));
    return post;
  },
  /** 내가 쓴 글의 분류·제목·본문·태그를 고친다. */
  updatePost(
    postId: string,
    input: {
      category: CategoryKey;
      title: string;
      body: string;
      tags: string[];
    },
  ) {
    commit((current) => {
      requirePost(current, postId);
      return {
        ...current,
        posts: current.posts.map((post) =>
          post.id === postId
            ? {
                ...post,
                ...input,
                pinned: input.category === "notice" ? true : undefined,
              }
            : post,
        ),
      };
    });
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
    commit((current) => {
      requirePost(current, postId);
      return { ...current, answers: [...current.answers, answer] };
    });
    return answer;
  },
  /** 글을 지운다. 그 글의 답변·채택·추천 기록도 함께 정리한다. */
  deletePost(postId: string) {
    commit((current) => {
      const answerIds = current.answers
        .filter((answer) => answer.postId === postId)
        .map((answer) => answer.id);
      const { [postId]: _removed, ...accepted } = current.accepted;
      return {
        ...current,
        posts: current.posts.filter((post) => post.id !== postId),
        answers: current.answers.filter((answer) => answer.postId !== postId),
        accepted,
        upvoted: current.upvoted.filter(
          (id) => id !== postId && !answerIds.includes(id),
        ),
      };
    });
  },
  toggleUpvote: (id: string) =>
    commit((current) => ({ ...current, upvoted: toggle(current.upvoted, id) })),
  toggleFollow: (name: string) =>
    commit((current) => ({ ...current, followed: toggle(current.followed, name) })),
  setAccepted: (postId: string, answerId: string | null) =>
    commit((current) => ({
      ...current,
      accepted: { ...current.accepted, [postId]: answerId },
    })),
};

export const allPosts = (activity: Activity) => activity.posts;

export const answersOf = (activity: Activity, postId: string) =>
  activity.answers.filter((answer) => answer.postId === postId);

export function acceptedAnswerId(activity: Activity, postId: string) {
  return activity.accepted[postId] ?? null;
}

/** 내가 추천했다면 +1 */
export const upvoteCount = (activity: Activity, id: string, base: number) =>
  base + (activity.upvoted.includes(id) ? 1 : 0);

export function statsOf(activity: Activity, name: string): AuthorStats {
  return {
    acceptedAnswers: activity.answers.filter(
      (answer) =>
        answer.author.name === name &&
        acceptedAnswerId(activity, answer.postId) === answer.id,
    ).length,
    posts: activity.posts.filter((post) => post.author.name === name).length,
  };
}

/** 새 글·글 수정 초안 (임시 저장 · 이탈 후 복원) */
export interface PostDraft {
  category: CategoryKey;
  title: string;
  tags: string[];
  tagText?: string;
  body: string;
  savedAt: number;
}

const postDraftKey = (ownerId: string, postId?: string) =>
  `${draftKey}:${encodeURIComponent(ownerId)}:${postId ? `edit:${encodeURIComponent(postId)}` : "new"}`;

/** 계정이 없거나 저장소를 쓸 수 없으면(쿠키 차단·용량 초과) fallback을 돌려준다. */
function ownedStorage<T>(ownerId: string, fallback: T, run: () => T): T {
  if (!ownerId) return fallback;
  try {
    return run();
  } catch {
    return fallback;
  }
}

export const readDraft = (ownerId: string, postId?: string) =>
  ownedStorage<PostDraft | null>(ownerId, null, () => {
    const raw = localStorage.getItem(postDraftKey(ownerId, postId));
    return raw ? (JSON.parse(raw) as PostDraft) : null;
  });

export const writeDraft = (ownerId: string, draft: PostDraft, postId?: string) =>
  ownedStorage(ownerId, false, () => {
    localStorage.setItem(postDraftKey(ownerId, postId), JSON.stringify(draft));
    return true;
  });

export const clearDraft = (ownerId: string, postId?: string) =>
  ownedStorage(ownerId, false, () => {
    localStorage.removeItem(postDraftKey(ownerId, postId));
    return true;
  });

const answerDraftKey = (ownerId: string, postId: string) =>
  `unsolvable-oj-community-answer-draft-v2:${encodeURIComponent(ownerId)}:${encodeURIComponent(postId)}`;

export const readAnswerDraft = (ownerId: string, postId: string) =>
  ownedStorage(ownerId, "", () => localStorage.getItem(answerDraftKey(ownerId, postId)) ?? "");

export const writeAnswerDraft = (ownerId: string, postId: string, text: string) =>
  ownedStorage(ownerId, false, () => {
    if (text) localStorage.setItem(answerDraftKey(ownerId, postId), text);
    else localStorage.removeItem(answerDraftKey(ownerId, postId));
    return true;
  });

/** "2시간 전" · "어제" · "3개월 전" 같은 상대 시각(항상 상대 표기로 통일) */
export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  // 360–364일은 12개월이지만 365일 미만이라 0년이 되지 않게 한다.
  return `${Math.max(1, Math.floor(days / 365))}년 전`;
}
