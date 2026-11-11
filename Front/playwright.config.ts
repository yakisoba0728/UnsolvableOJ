import { defineConfig, devices } from "@playwright/test";

// 브라우저 없이 src 모듈만 검사하는 스펙은 브라우저마다 반복하지 않는다.
const unitSpecs = [
  "autocomplete.spec.ts",
  "code-editing.spec.ts",
  "editor-persistence.spec.ts",
  "page-range.spec.ts",
  "problem-editor.spec.ts",
  "solve-split.spec.ts",
];

// 오래 걸리는 다중 탭·지연 로딩 회귀 시나리오. 로컬 기본 실행(npm run test:e2e)에서는 빼고
// CI와 npm run test:e2e:full에서 돌린다.
const slowSpecs = [
  "community-regressions.spec.ts",
  "data-regressions.spec.ts",
  "editor-recovery.spec.ts",
  "ui-harmony.spec.ts",
];

// WebKit은 전체를 돌리면 CI가 10분 넘게 늘어나므로, 브라우저마다 동작이 갈렸던 영역(인증·세션 갱신·레이아웃·편집기 포커스·복사)만 돌린다.
const webkitSpecs = [
  "auth.spec.ts",
  "editor-focus.spec.ts",
  "layout.spec.ts",
  "session-refresh.spec.ts",
  "ui-harmony.spec.ts",
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "unit", testMatch: unitSpecs },
    { name: "chromium", testIgnore: [...unitSpecs, ...slowSpecs], use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-slow", testMatch: slowSpecs, use: { ...devices["Desktop Chrome"] } },
    // html의 smooth 스크롤이 Playwright의 클릭 전 스크롤과 겹치면 Firefox·WebKit에서 클릭이 빗나가므로 움직임을 줄인다.
    // 크기를 바로 재는 테스트는 0.01ms 전환이 한 프레임 늦게 반영되므로 emulateMedia로 no-preference를 쓴다.
    { name: "firefox", testIgnore: unitSpecs, use: { ...devices["Desktop Firefox"], contextOptions: { reducedMotion: "reduce" } } },
    { name: "webkit", testMatch: webkitSpecs, use: { ...devices["Desktop Safari"], contextOptions: { reducedMotion: "reduce" } } },
  ],
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
