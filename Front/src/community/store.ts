import type { CategoryKey } from "./types";

// 글·답변·추천은 커뮤니티 API에 저장하고, 브라우저에는 계정별 작성 초안만 둔다.
// 소유자를 알 수 없는 v1 초안은 그대로 보관하고 어느 계정에도 자동으로 넘기지 않는다.
const draftKey = "unsolvable-oj-community-draft-v2";

/** 새 글·글 수정 초안 (임시 저장 · 이탈 후 복원) */
export interface PostDraft {
  category: CategoryKey;
  title: string;
  tags: string[];
  tagText?: string;
  body: string;
  code?: string;
  language?: string;
  problemId?: string | null;
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
