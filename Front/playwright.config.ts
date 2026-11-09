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

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
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
    { name: "firefox", testIgnore: unitSpecs, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: unitSpecs, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
