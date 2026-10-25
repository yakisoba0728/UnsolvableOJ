import type { Page } from "@playwright/test";
import type { Problem, Role, Session } from "../src/types";

export const storageKey = "unsolvable-oj-session-v1";
export const session: Session = {
  accessToken: "browser-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: {
    id: "solver",
    email: "solver@example.com",
    username: "solver",
    role: "USER",
    level: 1,
    xp: 0,
    rating: 0,
  },
};
export const problem: Problem = {
  id: "problem-id",
  slug: "sum",
  title: "두 수의 합",
  difficulty: "BEGINNER",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  status: "PUBLISHED",
  statementMarkdown: "두 정수를 더하세요.",
  inputDescriptionMarkdown: "두 정수",
  outputDescriptionMarkdown: "합",
  samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

export async function authenticate(
  page: Page,
  role: Role = "USER",
  expiresAt = Date.now() + 900_000,
) {
  await page.addInitScript(
    ({ key, saved }) => {
      localStorage.setItem(key, JSON.stringify(saved));
    },
    {
      key: storageKey,
      saved: {
        session: { ...session, user: { ...session.user, role } },
        expiresAt,
      },
    },
  );
}

export async function mockProblemApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/problems") {
      await route.fulfill({
        json: { items: [problem], page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    } else if (path.startsWith("/api/v1/problems/by-slug/")) {
      await route.fulfill({
        json: { ...problem, slug: path.split("/").at(-1) },
      });
    } else {
      await route.fulfill({
        status: 404,
        json: { message: `Unexpected test request: ${path}` },
      });
    }
  });
}

export async function readAll(page: Page, path: string, token?: string) {
  return page.evaluate(async ({ path, token }) => {
    const modulePath = "/src/pagination.ts";
    const { fetchAll } = await import(modulePath);
    return fetchAll(path, new AbortController().signal, token);
  }, { path, token });
}

/** 테스트 글. 빠진 값은 기본값으로 채운다. author는 사용자 이름이자 id다. */
export interface SeedPost {
  id: string;
  title: string;
  category?: string;
  body?: string;
  tags?: string[];
  author?: string;
  createdAt?: string;
  upvotes?: number;
  views?: number;
  code?: string;
  language?: string;
  problem?: { id: string; slug: string; title: string } | null;
  /** 채택한 답변 id */
  accepted?: string | null;
}
export interface SeedAnswer {
  id: string;
  postId: string;
  body?: string;
  author?: string;
  createdAt?: string;
  upvotes?: number;
}

/**
 * 커뮤니티 API(/community/posts)를 메모리에서 흉내 낸다. 목록의 필터·정렬·개수 규칙은
 * Back/src/modules/community/community.service.ts와 같게 맞춘다. 로그인 사용자는 fixtures의 session이다.
 * fail이 상태 코드를 돌려주면 그 요청을 실패시킨다. 돌려준 state로 서버 쪽 값을 확인한다.
 */
export async function mockCommunityApi(
  page: Page,
  seed: {
    posts?: SeedPost[];
    answers?: SeedAnswer[];
    /** 내가 추천한 글·답변 id */
    voted?: string[];
    /** 내가 팔로우한 작성자 이름 */
    following?: string[];
  } = {},
) {
  const me = session.user.username;
  const person = (name: string) => ({ id: name, username: name, level: 1 });
  const state = {
    posts: (seed.posts ?? []).map((post, index) => ({
      category: "free",
      body: "본문",
      tags: [] as string[],
      author: me,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      upvotes: 0,
      views: 0,
      code: "",
      language: "",
      problem: null,
      accepted: null,
      ...post,
    })),
    answers: (seed.answers ?? []).map((answer, index) => ({
      body: "답변 본문",
      author: me,
      createdAt: new Date(Date.UTC(2026, 9, 2, 0, index)).toISOString(),
      upvotes: 0,
      ...answer,
    })),
    voted: new Set(seed.voted ?? []),
    following: new Set(seed.following ?? []),
    /** 요청을 실패시키려면 상태 코드를 돌려준다. */
    fail: (() => undefined) as (
      method: string,
      path: string,
    ) => number | undefined,
    requests: [] as { method: string; path: string; body: unknown }[],
  };
  const answersOf = (postId: string) =>
    state.answers.filter((answer) => answer.postId === postId);
  const toApi = (post: (typeof state.posts)[number], full = true) => ({
    id: post.id,
    authorId: post.author,
    author: person(post.author),
    category: post.category.toUpperCase(),
    title: post.title,
    tags: post.tags,
    views: post.views,
    problemId: post.problem?.id ?? null,
    problem: post.problem,
    acceptedCommentId: post.accepted,
    createdAt: post.createdAt,
    updatedAt: post.createdAt,
    voteCount: post.upvotes + (state.voted.has(post.id) ? 1 : 0),
    commentCount: answersOf(post.id).length,
    ...(full ? { body: post.body, code: post.code, language: post.language } : {}),
  });

  function list(query: URLSearchParams) {
    const limit = Number(query.get("limit") ?? 20);
    const pageNumber = Number(query.get("page") ?? 1);
    const keyword = query.get("q")?.toLowerCase();
    const tags = query.getAll("tag").map((tag) => tag.toLowerCase());
    const categories = query.get("categories")?.toLowerCase().split(",") ?? [];
    const statuses = query.get("status")?.split(",") ?? [];
    const base = state.posts.filter(
      (post) =>
        (!keyword || post.title.toLowerCase().includes(keyword)) &&
        tags.every((tag) =>
          post.tags.some((item) => item.toLowerCase() === tag),
        ) &&
        (!query.get("problemId") || post.problem?.id === query.get("problemId")),
    );
    const accepted = (post: (typeof state.posts)[number]) =>
      Boolean(post.accepted);
    const inCategory = (post: (typeof state.posts)[number], keys: string[]) =>
      !keys.length || keys.includes(post.category);
    const inStatus = (post: (typeof state.posts)[number], keys: string[]) =>
      !keys.length ||
      keys.includes(accepted(post) ? "accepted" : "unaccepted");
    const facets = { categories: {} as Record<string, number>, statuses: {} as Record<string, number> };
    for (const key of ["", "question", "solution", "review", "free", "notice"])
      facets.categories[key.toUpperCase()] = base.filter(
        (post) => inCategory(post, key ? [key] : []) && inStatus(post, statuses),
      ).length;
    for (const key of ["", "accepted", "unaccepted"])
      facets.statuses[key] = base.filter(
        (post) => inCategory(post, categories) && inStatus(post, key ? [key] : []),
      ).length;
    const filtered = base.filter(
      (post) =>
        (query.get("includePinned") === "true" && post.category === "notice") ||
        (inCategory(post, categories) && inStatus(post, statuses)),
    );
    const sort = query.get("sort") ?? "latest";
    const value = (post: (typeof state.posts)[number]) => {
      const api = toApi(post, false);
      return sort === "votes"
        ? api.voteCount
        : sort === "answers"
          ? api.commentCount
          : sort === "views"
            ? post.views
            : 0;
    };
    filtered.sort(
      (a, b) =>
        Number(b.category === "notice") - Number(a.category === "notice") ||
        value(b) - value(a) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
    return {
      items: filtered
        .slice((pageNumber - 1) * limit, pageNumber * limit)
        .map((post) => toApi(post, false)),
      total: filtered.length,
      facets,
      page: pageNumber,
      limit,
      totalPages: Math.ceil(filtered.length / limit),
    };
  }

  await page.route(
    (url) => url.pathname.startsWith("/api/v1/community/"),
    async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1/community/posts", "");
      const body = request.postDataJSON?.() ?? null;
      state.requests.push({ method, path: path + url.search, body });
      const reply = (json: unknown, status = 200) =>
        route.fulfill({ status, json });
      const failed = state.fail(method, path);
      if (failed) return reply({ message: "테스트에서 실패시킨 요청" }, failed);
      const signedIn = Boolean(request.headers()["authorization"]);
      if (method !== "GET" && !path.endsWith("/view") && !signedIn)
        return reply({ message: "로그인이 필요합니다." }, 401);
      if (method === "GET" && !path) return reply(list(url.searchParams));
      if (path === "/mine")
        return reply({
          written: state.posts
            .filter((post) => post.author === me)
            .map((post) => toApi(post, false)),
          voted: state.posts
            .filter((post) => state.voted.has(post.id))
            .map((post) => toApi(post, false)),
          following: [...state.following],
        });
      if (method === "POST" && !path) {
        const input = body as Record<string, unknown>;
        const post: (typeof state.posts)[number] = {
          id: `new-${state.posts.length + 1}`,
          category: String(input.category).toLowerCase(),
          title: String(input.title),
          body: String(input.body),
          tags: (input.tags as string[]) ?? [],
          code: String(input.code ?? ""),
          language: String(input.language ?? ""),
          problem: input.problemId
            ? { id: String(input.problemId), slug: "sum", title: "두 수의 합" }
            : null,
          author: me,
          createdAt: new Date().toISOString(),
          upvotes: 0,
          views: 0,
          accepted: null,
        };
        state.posts.unshift(post);
        return reply(toApi(post), 201);
      }
      const [, id, action, answerId, answerAction] = path.split("/");
      const post = state.posts.find((item) => item.id === id);
      if (!post) return reply({ message: "게시글을 찾을 수 없습니다." }, 404);
      const toggle = (set: Set<string>, key: string) =>
        method === "PUT" ? set.add(key) : set.delete(key);
      if (!action) {
        if (method === "GET") return reply(toApi(post));
        if (method === "DELETE") {
          state.posts = state.posts.filter((item) => item !== post);
          state.answers = state.answers.filter((item) => item.postId !== id);
          return reply({ ok: true });
        }
        const input = body as Record<string, unknown>;
        if (String(input.category).toLowerCase() !== post.category)
          return reply({ message: "게시판 종류는 변경할 수 없습니다." }, 400);
        Object.assign(post, {
          title: input.title,
          body: input.body,
          tags: input.tags ?? [],
          code: input.code ?? "",
          language: input.language ?? "",
        });
        return reply(toApi(post));
      }
      if (action === "view") {
        post.views += 1;
        return reply(toApi(post), 201);
      }
      if (action === "author-stats")
        return reply({
          posts: state.posts.filter((item) => item.author === post.author).length,
          acceptedAnswers: state.posts.filter((item) =>
            state.answers.some(
              (answer) => answer.id === item.accepted && answer.author === post.author,
            ),
          ).length,
        });
      if (action === "interaction")
        return reply({
          voted: state.voted.has(id),
          following: state.following.has(post.author),
          commentVotes: answersOf(id)
            .map((answer) => answer.id)
            .filter((answerKey) => state.voted.has(answerKey)),
        });
      if (action === "vote") {
        toggle(state.voted, id);
        return reply({ voted: state.voted.has(id), voteCount: toApi(post).voteCount });
      }
      if (action === "follow") {
        toggle(state.following, post.author);
        return reply({ ok: true });
      }
      if (action === "accepted-answer") {
        post.accepted = method === "PUT" ? answerId : null;
        return reply(toApi(post));
      }
      if (action === "comments" && !answerId) {
        if (method === "POST") {
          const answer = {
            id: `answer-${state.answers.length + 1}`,
            postId: id,
            body: String((body as { body: string }).body),
            author: me,
            createdAt: new Date().toISOString(),
            upvotes: 0,
          };
          state.answers.push(answer);
          return reply({ id: answer.id }, 201);
        }
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const pageNumber = Number(url.searchParams.get("page") ?? 1);
        const items = answersOf(id).sort(
          (a, b) =>
            Number(b.id === post.accepted) - Number(a.id === post.accepted) ||
            a.createdAt.localeCompare(b.createdAt),
        );
        return reply({
          items: items
            .slice((pageNumber - 1) * limit, pageNumber * limit)
            .map((answer) => ({
              id: answer.id,
              authorId: answer.author,
              author: person(answer.author),
              body: answer.body,
              createdAt: answer.createdAt,
              updatedAt: answer.createdAt,
              voteCount: answer.upvotes + (state.voted.has(answer.id) ? 1 : 0),
            })),
          total: items.length,
          page: pageNumber,
          limit,
          totalPages: Math.ceil(items.length / limit),
        });
      }
      if (action === "comments" && answerAction === "vote") {
        toggle(state.voted, answerId);
        return reply({ ok: true });
      }
      return reply({ message: `Unexpected community request: ${method} ${path}` }, 404);
    },
  );
  return state;
}
