import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import type { VibeAttempt } from "../src/vibe/types";
import { authenticate, mockProblemApi } from "./fixtures";
import { checkoutProvenance } from "./checkout-provenance";

// Only this new finite observation receives the authorized 90-second ceiling.
// Existing test timeouts remain unchanged. No screenshots or network traces
// retain the synthetic session or the editor's typed source.
test.setTimeout(90_000);
test.use({ trace: "off", screenshot: "off" });

type Heap = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
type Sample = { label: string; elapsedMs: number; visibilityState: string;
  heap: { value: Heap | null; reason: string | null } };
type EventRow = { name: string; region: "editor" | "file-tab" | null; startTime: number;
  duration: number; processingStart: number | null; processingEnd: number | null; interactionId: number | null };
type Events = { value: EventRow[] | null; reason: string | null; truncated: boolean;
  discardedEntries: number; observedDurationMs: number };
declare global {
  interface Window {
    __ojEditorObservation: { sample: (label: string) => Sample; finish: () => Events };
  }
}

function installProbe() {
  const started = performance.now();
  const rows: EventRow[] = [];
  let observer: PerformanceObserver | undefined;
  let reason: string | null = null;
  let discarded = 0;
  const names = new Set(["keydown", "keyup", "keypress", "beforeinput", "input", "click", "pointerdown", "pointerup", "mousedown", "mouseup"]);
  const collect = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime < started || !names.has(entry.name)) continue;
      if (rows.length === 200) { discarded++; continue; }
      const value = entry as PerformanceEntry & { target?: Element; processingStart?: number; processingEnd?: number; interactionId?: number };
      // Fixed regions and numerical timing only: no target text, selectors,
      // source, key values, URLs or session/storage contents leave the page.
      const target = value.target instanceof Element ? value.target : undefined;
      rows.push({ name: entry.name, region: target?.closest(".code-editor") ? "editor"
        : target?.closest(".vibe-file-tab") ? "file-tab" : null,
      startTime: entry.startTime - started, duration: entry.duration,
      processingStart: value.processingStart === undefined ? null : value.processingStart - started,
      processingEnd: value.processingEnd === undefined ? null : value.processingEnd - started,
      interactionId: value.interactionId ?? null });
    }
  };
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes("event")) {
    reason = "EventTiming is not advertised by this browser.";
  } else {
    try {
      observer = new PerformanceObserver(list => collect(list.getEntries()));
      const options: PerformanceObserverInit & { durationThreshold: number } = { type: "event", buffered: false, durationThreshold: 16 };
      observer.observe(options);
    } catch { reason = "The browser rejected the bounded EventTiming observer."; }
  }
  window.__ojEditorObservation = {
    sample(label) {
      const memory = (performance as Performance & { memory?: Heap }).memory;
      const valid = memory && [memory.usedJSHeapSize, memory.totalJSHeapSize, memory.jsHeapSizeLimit]
        .every(value => Number.isFinite(value) && value >= 0);
      return { label, elapsedMs: performance.now() - started, visibilityState: document.visibilityState,
        heap: { value: valid ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit } : null,
        reason: valid ? null : "performance.memory is unavailable or did not expose finite heap sizes." } };
    },
    finish() {
      if (observer) { collect(observer.takeRecords()); observer.disconnect(); }
      return { value: reason ? null : rows, reason: reason ?? (rows.length ? null
        : "No entries met the requested 16 ms threshold; this does not mean zero interaction latency."),
      truncated: discarded > 0, discardedEntries: discarded, observedDurationMs: performance.now() - started };
    },
  };
}

test("bounded editor heap and interaction observation with mocked persistence", async ({ page }, testInfo) => {
  const checkout = checkoutProvenance();
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")) as { pull_request?: { head?: { sha?: string }; base?: { sha?: string } } }
    : undefined;
  const samples: Sample[] = [];
  const actions: Record<string, number | string | boolean>[] = [];
  const raw: { heapSamples: Sample[]; actions: typeof actions; eventTiming: Events | null } = { heapSamples: samples, actions, eventTiming: null };
  const report: Record<string, unknown> = {
    schemaVersion: 1, status: "FAIL", timestamp: new Date().toISOString(),
    source: { checkout: checkout.sha, tree: checkout.tree, sourceHead: event?.pull_request?.head?.sha ?? checkout.sha,
      base: event?.pull_request?.base?.sha ?? null, workflowRunId: process.env.GITHUB_RUN_ID ?? null,
      workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, trackedTreeClean: checkout.trackedTreeClean },
    environment: { project: testInfo.project.name, browser: page.context().browser()?.browserType().name(),
      browserVersion: page.context().browser()?.version(), viewport: page.viewportSize() },
    protocol: { trials: 1, scope: "Real frontend editor with deterministic browser-routed mock API and synthetic authentication; no real backend, native executor or provider.",
      plannedObservationMs: 40_000, maximumObservationMs: 45_000, testTimeoutMs: testInfo.timeout,
      budgetScope: "Actions, autosave and heap sampling; observer disposal/reporting use the remaining 90-second test ceiling.",
      initialIdleMs: 5000, cycles: 10, scheduledCycleMs: 3000, finalIdleMs: 5000,
      editorWrites: 10, fileToggles: 10, charactersPerWrite: 8, plannedHeapSamples: 13,
      eventDurationThresholdMs: 16, maximumEventEntries: 200, initialLinesPerFile: 81, fixtureDeclarationsPerFile: 80, gcForced: false,
      actionWallTiming: "Includes automation, assertions and the mock autosave debounce; not a processing/paint latency.",
      clocks: "Actions use Node monotonic time; heap/EventTiming use browser monotonic time from probe installation. These nearby origins are not identical." },
    raw,
    fieldINP: { value: null, reason: "A finite automated laboratory interaction sample is not field INP." },
    limitations: ["Heap values are optional nonstandard browser JS-heap estimates, may be coarse or shared, and exclude whole-platform/native memory.",
      "The page, instrumentation and browser runtime contribute to the heap; this does not isolate editor allocation.",
      "One 40-second schedule cannot establish a leak, absence of leaks, long-term capacity, a speedup or a population latency distribution.",
      "EventTiming is thresholded and may be empty, rounded, unsupported or truncated. No latency or heap-size acceptance threshold is imposed."],
  };
  let observationStart: number | undefined;
  let probeInstalled = false;
  let pageErrors = 0;
  let writes = 0;
  let unexpectedRequests = 0;
  page.on("pageerror", () => { pageErrors++; });
  try {
    const id = "75000000-0000-4000-8000-000000000001";
    const source = (prefix: string) => Array.from({ length: 80 }, (_, index) => `export const ${prefix}${index} = ${index};`).join("\n") + "\n// ";
    const expected: Record<string, string> = { "src/search.ts": source("search"), "src/tags.ts": source("tag") };
    const state: VibeAttempt = {
      id, challenge: { id: "phase5-editor-fixture", title: "편집기 관찰", summary: "고정된 브라우저 실험용 과제", stack: "TypeScript",
        difficulty: "연습", durationMin: 45, requirements: [], rubric: [] },
      revision: 0, startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 2_700_000).toISOString(),
      submittedAt: null, busyUntil: null, files: { ...expected }, editablePaths: Object.keys(expected),
      messages: [], events: [], runs: [], report: null, canUndo: false, remainingAiRequests: 0, remainingRuns: 0,
      availability: { ai: false, runner: false }, limits: { aiRequests: 0, runs: 0, dailyAttempts: 1, fileBytes: 30_000, minutes: 45 },
    };
    await mockProblemApi(page);
    await authenticate(page);
    await page.route("**/api/v1/vibe/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/v1/vibe/attempts/${id}` && route.request().method() === "GET") return route.fulfill({ json: state });
      if (path === `/api/v1/vibe/attempts/${id}/files` && route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { revision: number; files: Record<string, string> };
        expect(body.revision).toBe(state.revision);
        expect(Object.keys(body.files).sort()).toEqual(Object.keys(expected).sort());
        expect(Object.values(body.files).every(value => typeof value === "string" && value.length < 8000)).toBe(true);
        state.files = { ...body.files };
        state.revision++;
        state.canUndo = true;
        state.events.push({ id: `save-${state.revision}`, type: "save", createdAt: new Date().toISOString(), revision: state.revision });
        writes++;
        return route.fulfill({ json: state });
      }
      unexpectedRequests++;
      return route.fulfill({ status: 404, json: { message: "Unexpected bounded editor fixture request" } });
    });
    await page.goto(`/vibe/attempts/${id}`);
    const editor = page.getByRole("textbox", { name: "TypeScript 소스 코드", exact: true });
    await expect(editor).toBeVisible();
    await editor.focus();
    await expect(editor).toBeFocused();
    await page.evaluate(installProbe);
    probeInstalled = true;
    observationStart = performance.now();
    const remaining = () => {
      const value = 45_000 - (performance.now() - observationStart!);
      if (value <= 0) throw new Error("Finite editor observation exceeded its 45-second protocol budget");
      return Math.min(5000, value);
    };
    const waitUntil = async (offsetMs: number) => {
      while (performance.now() < observationStart! + offsetMs) {
        remaining();
        await delay(Math.min(1000, observationStart! + offsetMs - performance.now()));
      }
    };
    const snapshot = async (label: string) => { samples.push(await page.evaluate(label => window.__ojEditorObservation.sample(label), label)); };
    await snapshot("ready");
    await waitUntil(5000);
    await snapshot("baseline-after-idle");
    for (let cycle = 0; cycle < 10; cycle++) {
      const path = cycle % 2 === 0 ? "src/search.ts" : "src/tags.ts";
      const nextPath = cycle % 2 === 0 ? "src/tags.ts" : "src/search.ts";
      const marker = `tick_${String(cycle + 1).padStart(2, "0")} `;
      expected[path] += marker;
      await editor.press("ControlOrMeta+End", { timeout: remaining() });
      const saved = page.waitForResponse(response => response.request().method() === "PATCH"
        && new URL(response.url()).pathname === `/api/v1/vibe/attempts/${id}/files`, { timeout: remaining() });
      const editStart = performance.now();
      await editor.pressSequentially(marker, { delay: 5, timeout: remaining() });
      // Boolean comparisons avoid serializing source into assertion errors.
      expect(await editor.evaluate((node, value) => (node as HTMLTextAreaElement).value === value, expected[path])).toBe(true);
      await expect(editor).toBeFocused({ timeout: remaining() });
      expect((await saved).status()).toBe(200);
      await expect(page.getByRole("status").filter({ hasText: "서버에 저장됨" })).toBeVisible({ timeout: remaining() });
      expect(state.files[path] === expected[path]).toBe(true);
      expect(writes).toBe(cycle + 1);
      actions.push({ cycle: cycle + 1, kind: "edit-autosave", elapsedMs: performance.now() - observationStart,
        wallDurationMs: performance.now() - editStart, revision: state.revision, valueMatched: true, focusRetained: true });
      const toggleStart = performance.now();
      const tab = page.getByRole("tab", { name: nextPath, exact: true });
      await tab.click({ timeout: remaining() });
      await expect(tab).toBeFocused({ timeout: remaining() });
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: remaining() });
      expect(await editor.evaluate((node, value) => (node as HTMLTextAreaElement).value === value, expected[nextPath])).toBe(true);
      await editor.focus({ timeout: remaining() });
      await expect(editor).toBeFocused({ timeout: remaining() });
      actions.push({ cycle: cycle + 1, kind: "file-toggle", elapsedMs: performance.now() - observationStart,
        wallDurationMs: performance.now() - toggleStart, valueMatched: true, tabFocused: true, editorFocusRestored: true });
      await waitUntil(5000 + (cycle + 1) * 3000);
      await snapshot(`cycle-${cycle + 1}`);
    }
    await waitUntil(performance.now() - observationStart + 5000);
    await snapshot("final-after-idle");
    remaining();
    expect(samples).toHaveLength(13);
    expect(actions).toHaveLength(20);
    expect(writes).toBe(10);
    expect(Object.keys(expected).every(path => state.files[path] === expected[path])).toBe(true);
    expect(unexpectedRequests).toBe(0);
    expect(pageErrors).toBe(0);
    report.status = "PASS";
  } finally {
    report.protocolElapsedMs = observationStart === undefined ? null : performance.now() - observationStart;
    const cleanupStarted = performance.now();
    let observerCleanupFailed = false;
    if (probeInstalled) {
      try { raw.eventTiming = await page.evaluate(() => window.__ojEditorObservation.finish()); }
      catch { observerCleanupFailed = true; report.status = "FAIL"; report.observerCleanup = "Browser observer cleanup was unavailable."; }
    }
    report.observerCleanupMs = performance.now() - cleanupStarted;
    report.actualObservationMs = observationStart === undefined ? null : performance.now() - observationStart;
    report.actual = { heapSamples: samples.length, actions: actions.length, autosaveWrites: writes, unexpectedRequests, pageErrors };
    await mkdir(resolve("reports"), { recursive: true });
    const output = resolve("reports/phase5-editor-observation.json");
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("phase5-editor-observation", { path: output, contentType: "application/json" });
    if (observerCleanupFailed) throw new Error("Editor observer cleanup failed");
  }
});
