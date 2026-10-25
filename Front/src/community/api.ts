import { api } from "../api";
import type {
  AuthorStats,
  CategoryKey,
  CommunityAnswer,
  CommunityPost,
} from "./types";

interface ApiPost {
  id: string;
  authorId: string;
  category: string;
  title: string;
  body?: string;
  code?: string;
  language?: string;
  tags: string[];
  views: number;
  problemId: string | null;
  problem: { id: string; slug: string; title: string } | null;
  author: { id: string; username: string; level: number };
  createdAt: string;
  voteCount: number;
  commentCount: number;
  acceptedCommentId: string | null;
}
interface ApiComment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  voteCount: number;
  author: ApiPost["author"];
}
export interface Page<T> {
  facets?: {
    categories: Record<string, number>;
    statuses: Record<string, number>;
  };
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}
export interface Interaction {
  voted: boolean;
  following: boolean;
  commentVotes: string[];
}
export const emptyInteraction: Interaction = {
  voted: false,
  following: false,
  commentVotes: [],
};
export const endpoint = "/community/posts";
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "요청에 실패했습니다. 다시 시도해 주세요.";
const author = (a: ApiPost["author"]) => ({
  id: a.id,
  name: a.username,
  tier: `Lv. ${a.level}`,
});
export function convertPost(p: ApiPost): CommunityPost {
  return {
    ...p,
    category: p.category.toLowerCase() as CategoryKey,
    body: p.body ?? "",
    author: author(p.author),
    upvotes: p.voteCount,
    pinned: p.category === "NOTICE",
  };
}
export async function listPosts(query: URLSearchParams, signal?: AbortSignal) {
  const result = await api<Page<ApiPost>>(`${endpoint}?${query}`, { signal });
  return { ...result, items: result.items.map(convertPost) };
}
export async function getPost(id: string, signal?: AbortSignal) {
  return convertPost(await api<ApiPost>(`${endpoint}/${id}`, { signal }));
}
export async function getComments(
  id: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<CommunityAnswer>> {
  const result = await api<Page<ApiComment>>(
    `${endpoint}/${id}/comments?page=${page}&limit=20`,
    { signal },
  );
  return {
    ...result,
    items: result.items.map((c) => ({
      ...c,
      postId: id,
      author: author(c.author),
      upvotes: c.voteCount,
    })),
  };
}
export interface PostInput {
  category: CategoryKey;
  title: string;
  body: string;
  tags: string[];
  code: string;
  language: string;
  problemId: string | null;
}
export async function savePost(input: PostInput, token: string, id?: string) {
  return convertPost(
    await api<ApiPost>(
      `${endpoint}${id ? `/${id}` : ""}`,
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          ...input,
          category: input.category.toUpperCase(),
        }),
      },
      token,
    ),
  );
}

/** 글 하나와 그 답변 한 쪽, 작성자 통계, 로그인했다면 내 추천·팔로우 상태를 함께 받는다. */
export async function getPostPage(
  id: string,
  answerPage: number,
  token: string | undefined,
  signal: AbortSignal,
) {
  const [post, answers, stats, interaction] = await Promise.all([
    getPost(id, signal),
    getComments(id, answerPage, signal),
    api<AuthorStats>(`${endpoint}/${id}/author-stats`, { signal }),
    token
      ? api<Interaction>(`${endpoint}/${id}/interaction`, { signal }, token)
      : emptyInteraction,
  ]);
  return { post, answers, stats, interaction };
}

/** 글에 딸린 동작(추천·팔로우·답변·채택·삭제). path는 글 주소 뒤에 붙는다. */
export const postAction = <T = unknown>(
  id: string,
  path: string,
  method: "POST" | "PUT" | "DELETE",
  token: string,
  body?: object,
) =>
  api<T>(
    `${endpoint}/${id}${path}`,
    { method, ...(body ? { body: JSON.stringify(body) } : {}) },
    token,
  );

/** 내가 쓴 글과 추천한 글(각각 최근 100편), 팔로우한 작성자 id */
export async function getMyPosts(token: string, signal: AbortSignal) {
  const result = await api<{
    written: ApiPost[];
    voted: ApiPost[];
    following: string[];
  }>(`${endpoint}/mine`, { signal }, token);
  return {
    written: result.written.map(convertPost),
    voted: result.voted.map(convertPost),
    following: result.following,
  };
}
