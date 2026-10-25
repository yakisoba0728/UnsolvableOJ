import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

const url = new URL(process.env.LIVE_BASE_URL ?? "http://invalid");
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
    !/^unsolvable-e2e-[a-f0-9]+$/.test(process.env.COMPOSE_PROJECT_NAME ?? "")) {
  throw new Error("Run live tests through node scripts/check-compose.mjs, never against a development or production database.");
}

export default defineConfig({
  ...base,
  testDir: "./tests-live",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  outputDir: "./reports/live-browser",
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/live-browser-report", open: "never" }],
    ["junit", { outputFile: "reports/live-browser.xml" }],
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: undefined,
  // Windows already ships Edge; Linux/CI uses Playwright's bundled Chromium.
  // LIVE_BROWSER_CHANNEL can explicitly select another installed channel.
  // Keep this confined to disposable-stack tests.
  use: {
    ...base.use,
    baseURL: url.origin,
    actionTimeout: 15_000,
    channel: process.env.LIVE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  },
});
