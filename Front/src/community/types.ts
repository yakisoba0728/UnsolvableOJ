export type CategoryKey = "question" | "solution" | "free" | "notice";

export const categories: { key: CategoryKey; label: string }[] = [
  { key: "question", label: "질문" },
  { key: "solution", label: "풀이 공유" },
  { key: "free", label: "자유" },
  { key: "notice", label: "공지" },
];

export const categoryLabel = (key: CategoryKey) =>
  categories.find((item) => item.key === key)?.label ?? key;

/** 상세 화면 머리말·돌아가기 링크에 쓰는 이름 (Figma: "질문과 답변") */
export const categoryLongLabel = (key: CategoryKey) =>
  key === "question" ? "질문과 답변" : categoryLabel(key);

export interface CommunityAuthor {
  name: string;
  tier: string;
}

export interface CommunityPost {
  id: string;
  category: CategoryKey;
  title: string;
  body: string;
  tags: string[];
  author: CommunityAuthor;
  createdAt: string;
  upvotes: number;
  views: number;
  pinned?: boolean;
}

export interface CommunityAnswer {
  id: string;
  postId: string;
  author: CommunityAuthor;
  body: string;
  createdAt: string;
  upvotes: number;
}

export interface AuthorStats {
  acceptedAnswers: number;
  posts: number;
}
