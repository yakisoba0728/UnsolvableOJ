import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const [worktree, probeDirectory, reportName = "community-session-dom.json"] = process.argv.slice(2);
if (!worktree || !probeDirectory || path.basename(reportName) !== reportName)
  throw new Error("usage: node consolidation-session-dom-probe.mjs WORKTREE JSDOM_DIRECTORY [REPORT_BASENAME]");
const root = path.resolve(worktree);
const probe = path.resolve(probeDirectory);
const require = createRequire(path.join(root, "Front/package.json"));
const probeRequire = createRequire(path.join(probe, "package.json"));
const { JSDOM } = probeRequire("jsdom");
const { build } = require("esbuild");
const bundle = path.join(probe, "community-session.cjs");
await build({
  stdin: { contents: `
    import { act } from 'react';
    import { createRoot } from 'react-dom/client';
    import { createMemoryRouter, RouterProvider } from 'react-router-dom';
    import { AuthProvider } from './src/auth';
    import { App } from './src/App';
    export { act };
    export function mount(route) {
      let version = 0;
      const router = createMemoryRouter([{ path: '*', element:
        <AuthProvider><App getNavigationVersion={() => version}/></AuthProvider>
      }], { initialEntries: [route] });
      let location = router.state.location;
      router.subscribe(state => { if (state.location !== location) version++; location = state.location; });
      const app = createRoot(document.getElementById('root'));
      app.render(<RouterProvider router={router}/>);
      return { app, router };
    }`, resolveDir: path.join(root, "Front"), loader: "tsx" },
  outfile: bundle, platform: "node", bundle: true, format: "cjs", jsx: "automatic", logLevel: "silent",
  define: { "import.meta.env": "{}" }, loader: { ".css": "empty", ".png": "dataurl" },
});
const storageKey = "unsolvable-oj-session-v1";
const token = (generation, sid = "same-login", sub = "solver") =>
  `e30.${Buffer.from(JSON.stringify({ sub, sid, tokenVersion: 0, generation })).toString("base64url")}.test`;
const session = {
  accessToken: token(1), refreshToken: "disposable-refresh", expiresIn: "15m", tokenType: "Bearer",
  refreshTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  user: { id: "solver", username: "solver", role: "USER", email: "fixture@example.invalid", level: 1, xp: 0, rating: 0 },
};
const fresh = { ...session, accessToken: token(2), refreshToken: "disposable-rotated" };
const post = {
  id: "p1", authorId: "solver", author: { id: "solver", username: "solver", level: 1 },
  category: "QUESTION", title: "질문 제목", body: "질문 본문", tags: [], views: 0,
  problemId: null, problem: null, acceptedCommentId: null, createdAt: "2026-11-01T00:00:00Z",
  voteCount: 0, commentCount: 0,
};
const report = {
  source: { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    diff: execFileSync("git", ["diff", "--", "Front/src/App.tsx", "Front/src/pages/CommunityWritePage.tsx", "Front/src/pages/CommunityPostPage.tsx"], { cwd: root, encoding: "utf8" }).trim() },
  node: process.version, jsdom: probeRequire("jsdom/package.json").version, browser: false,
  limitations: "Actual React router/auth/community DOM execution with synthetic fetch. No native browser, layout, screen reader, backend authorization or performance claim.",
  cases: [],
};
for (const kind of ["post", "answer"]) for (const mode of ["refresh", "account", "login"]) {
  const route = kind === "post" ? "/community/new" : "/community/p1";
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://localhost${route}`, pretendToBeVisual: true });
  const win = dom.window;
  for (const key of ["window", "document", "localStorage", "sessionStorage", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "StorageEvent", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "getComputedStyle"])
    Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
  globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.scrollTo = () => {};
  win.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  localStorage.setItem(storageKey, JSON.stringify({ session, expiresAt: Date.now() + 900000 }));
  let release;
  let refreshes = 0;
  const writes = [];
  const answers = [];
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url, "http://localhost").pathname;
    const method = options.method ?? "GET";
    if (pathname === "/api/v1/notifications/unread-count") return Response.json({ unread: 0 });
    if (pathname === "/api/v1/auth/refresh") { refreshes++; return Response.json(fresh); }
    const writePath = kind === "post" ? "/api/v1/community/posts" : "/api/v1/community/posts/p1/comments";
    if (method === "POST" && pathname === writePath) {
      writes.push({ authorization: options.headers.Authorization, body: JSON.parse(options.body) });
      if (mode === "refresh" && options.headers.Authorization === `Bearer ${session.accessToken}`)
        return Response.json({ message: "Expired" }, { status: 401 });
      return new Promise(resolve => { release = () => {
        if (kind === "answer") answers.push({ id: "a1", authorId: "solver", author: post.author, body: "작성한 답변 내용", createdAt: post.createdAt, voteCount: 0 });
        resolve(Response.json(kind === "post" ? { ...post, title: "작성한 글 제목", body: "작성한 글 본문" } : { id: "a1" }, { status: 201 }));
      }; });
    }
    if (pathname === "/api/v1/community/posts/p1") return Response.json(post);
    if (pathname === "/api/v1/community/posts/p1/comments") return Response.json({ items: answers, total: answers.length, page: 1, totalPages: 1 });
    if (pathname.endsWith("/author-stats")) return Response.json({ posts: 1, acceptedAnswers: 0, followers: 0, following: 0 });
    if (pathname.endsWith("/interaction")) return Response.json({ voted: false, saved: false, following: false, commentVotes: [] });
    if (pathname.endsWith("/view")) return Response.json({ ok: true });
    return Response.json({ message: "Unexpected fixture request" }, { status: 404 });
  };
  delete require.cache[bundle];
  const { mount, act } = require(bundle);
  const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  const wait = async condition => {
    for (let index = 0; index < 200; index++) { if (condition()) return; await tick(); }
    throw new Error("Bounded DOM fixture did not settle");
  };
  const fill = async (element, value) => act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  let mounted;
  const observed = {};
  try {
    await act(async () => { mounted = mount(route); });
    const selector = kind === "post" ? 'input[placeholder^="예: 다익스트라"]' : 'textarea[aria-label="답변 내용"]';
    await wait(() => document.querySelector(selector));
    const input = document.querySelector(selector);
    await fill(input, kind === "post" ? "작성한 글 제목" : "작성한 답변 내용");
    if (kind === "post") await fill(document.querySelector("#body-input"), "작성한 글 본문");
    await act(async () => input.closest("form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
    await wait(() => release);
    if (mode !== "refresh") await act(async () => {
      const next = mode === "login"
        ? { ...fresh, accessToken: token(2, "new-login") }
        : { ...fresh, accessToken: token(2, "second-login", "second"), user: { ...session.user, id: "second", username: "second" } };
      const oldValue = localStorage.getItem(storageKey);
      const newValue = JSON.stringify({ session: next, expiresAt: Date.now() + 900000 });
      localStorage.setItem(storageKey, newValue);
      win.dispatchEvent(new win.StorageEvent("storage", { key: storageKey, oldValue, newValue, storageArea: localStorage }));
    });
    await tick();
    observed.sameInput = document.querySelector(selector) === input;
    observed.pending = document.querySelector(selector)?.matches(":disabled");
    await act(async () => release());
    for (let i = 0; i < 8; i++) await tick();
    observed.path = mounted.router.state.location.pathname;
    observed.notice = document.body.textContent.includes(kind === "post" ? "글을 등록했어요." : "답변을 등록했어요.");
    observed.refreshes = refreshes;
    observed.writes = writes.length;
    if (mode === "refresh") {
      assert.equal(observed.sameInput, true, "routine refresh must keep the in-flight form mounted");
      assert.equal(observed.pending, true, "routine refresh must keep the pending write locked");
      assert.equal(observed.notice, true, "the confirmed write must complete in the same login");
      assert.equal(observed.refreshes, 1);
      assert.equal(observed.writes, 2);
      if (kind === "post") assert.equal(observed.path, "/community/p1");
      else assert.equal(document.querySelector(selector).value, "");
    } else {
      assert.equal(observed.sameInput, false, "a different login must replace the old component");
      assert.equal(observed.notice, false, "a stale write must not update the new login");
      assert.equal(observed.path, route);
      assert.equal(observed.writes, 1);
    }
    report.cases.push({ name: `${kind}-${mode}`, passed: true, observed });
  } catch (error) {
    report.cases.push({ name: `${kind}-${mode}`, passed: false, observed, error: String(error) });
  } finally {
    release?.();
    if (mounted) { await act(async () => mounted.app.unmount()); mounted.router.dispose(); }
    win.close();
  }
}
await fs.writeFile(path.join(probe, reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.cases.every(item => item.passed) ? 0 : 1);
