import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, type CDPSession, type Page, type TestInfo } from "@playwright/test";
import type { LearningDashboard, LearningDays } from "../src/learning/types";

type Metric<T> = { value: T | null; reason: string | null };
type LcpEntry = { startTime: number; renderTime: number; loadTime: number; size: number };
type Geometry = { x: number; y: number; width: number; height: number };
type ShiftSource = { region: string | null; tag: string | null; previous: Geometry; current: Geometry };
type ShiftEntry = { startTime: number; value: number; hadRecentInput: boolean; sources: ShiftSource[]; sourcesTruncated: boolean };
type EventEntry = {
  name: string; startTime: number; duration: number; processingStart: number | null;
  processingEnd: number | null; interactionId: number | null;
};
type PeriodSample = {
  days: LearningDays; clickStartMs: number; verifiedRenderFrameMs: number;
  clickToVerifiedRenderFrameMs: number;
};
type BrowserSnapshot = {
  timeOrigin: number; observedThroughMs: number; visibilityState: string;
  lcpCandidate: Metric<LcpEntry>; observedCls: Metric<number>;
  firstContentfulPaintMs: Metric<number>;
  navigation: Metric<Record<string, number | string>>;
  observerReasons: Record<string, string | null>;
  truncated: Record<string, boolean>;
  lcpEntries: LcpEntry[]; layoutShifts: ShiftEntry[]; eventTiming: Metric<EventEntry[]>;
  layout: { viewport: { width: number; height: number }; document: { width: number; height: number };
    fontStatus: string | null; regions: { region: string; box: Geometry | null }[] };
};
declare global {
  interface Window {
    __ojLearningProbe: {
      snapshot: () => BrowserSnapshot;
      beginPeriod: (days: LearningDays) => void;
      periodSample: () => PeriodSample | null;
    };
  }
}

/** This function runs before app code in each measured document, never in production bundles. */
function installProbe() {
  const lcpEntries: LcpEntry[] = [];
  const layoutShifts: ShiftEntry[] = [];
  const eventTiming: EventEntry[] = [];
  const reasons: Record<string, string | null> = {};
  const truncated: Record<string, boolean> = {};
  const collectors: { observer: PerformanceObserver; collect: (entries: PerformanceEntry[]) => void }[] = [];
  // Only fixed, source-owned region names and numbers leave the browser. Never
  // retain DOM nodes, text, arbitrary IDs/classes, URLs, account data or input.
  const regions = [".learning-goal", ".learning-toolbar", "dl.learning-summary", ".learning-scope",
    ".learning-panel", ".page-header", ".site-header", ".site-footer"];
  const tags = new Set(["DIV", "P", "SPAN", "DL", "DT", "DD", "SECTION", "H1", "H2", "BUTTON", "A",
    "HEADER", "FOOTER", "MAIN", "NAV", "UL", "OL", "LI", "PROGRESS"]);
  const geometry = (rect: DOMRectReadOnly): Geometry => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  const observe = (type: string, collect: (entry: PerformanceEntry) => void) => {
    reasons[type] = null;
    truncated[type] = false;
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes(type)) {
      reasons[type] = "This browser does not advertise this PerformanceObserver entry type.";
      return;
    }
    let count = 0;
    const collectEntries = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        if (count++ < 1000) collect(entry);
        else truncated[type] = true;
      }
    };
    try {
      const observer = new PerformanceObserver(list => collectEntries(list.getEntries()));
      observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) });
      collectors.push({ observer, collect: collectEntries });
    } catch {
      reasons[type] = "The browser rejected this observer configuration.";
    }
  };
  observe("largest-contentful-paint", entry => {
    const value = entry as PerformanceEntry & LcpEntry;
    lcpEntries.push({ startTime: value.startTime, renderTime: value.renderTime, loadTime: value.loadTime, size: value.size });
  });
  observe("layout-shift", entry => {
    const value = entry as PerformanceEntry & { value: number; hadRecentInput: boolean;
      sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
    const sources = value.sources ?? [];
    layoutShifts.push({ startTime: value.startTime, value: value.value, hadRecentInput: value.hadRecentInput,
      sources: sources.slice(0, 5).map(source => {
        const element = source.node instanceof Element ? source.node : source.node?.parentElement;
        return { region: regions.find(selector => element?.closest(selector)) ?? null,
          tag: element && tags.has(element.tagName) ? element.tagName.toLowerCase() : null,
          previous: geometry(source.previousRect), current: geometry(source.currentRect) };
      }), sourcesTruncated: sources.length > 5 });
  });
  observe("event", entry => {
    const value = entry as PerformanceEntry & Partial<EventEntry>;
    eventTiming.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration,
      processingStart: value.processingStart ?? null, processingEnd: value.processingEnd ?? null,
      interactionId: value.interactionId ?? null });
  });

  let pending: { days: LearningDays; start: number | null; scheduled: boolean } | null = null;
  let periodSample: PeriodSample | null = null;
  let mutations: MutationObserver | null = null;
  const ready = (days: LearningDays) => {
    const summary = document.querySelector(`dl.learning-summary[aria-label="최근 ${days}일 학습 요약"]`);
    const values = summary?.querySelectorAll("dd");
    return values?.length === 4 && values[0].textContent === "2건"
      && values[1].textContent === "1 / 시도 1문제" && values[3].textContent === "50%1건 성공";
  };
  const inspect = () => {
    if (!pending || pending.start === null || pending.scheduled || !ready(pending.days)) return;
    const current = pending;
    current.scheduled = true;
    // Two rAF callbacks provide a render opportunity after verified DOM, not a paint timestamp.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pending !== current || !ready(current.days)) {
        current.scheduled = false;
        return;
      }
      const frame = performance.now();
      periodSample = { days: current.days, clickStartMs: current.start!, verifiedRenderFrameMs: frame,
        clickToVerifiedRenderFrameMs: frame - current.start! };
      mutations?.disconnect();
      pending = null;
    }));
  };
  document.addEventListener("click", event => {
    if (!pending || pending.start !== null || !(event.target instanceof Element)) return;
    const button = event.target.closest(".learning-periods button");
    if (button?.textContent !== `최근 ${pending.days}일`) return;
    pending.start = event.timeStamp;
    inspect();
  }, true);

  window.__ojLearningProbe = {
    beginPeriod(days) {
      mutations?.disconnect();
      pending = { days, start: null, scheduled: false };
      periodSample = null;
      mutations = new MutationObserver(inspect);
      mutations.observe(document.querySelector(".learning-page")!, { childList: true, subtree: true, characterData: true });
    },
    periodSample: () => periodSample,
    snapshot() {
      for (const item of collectors) item.collect(item.observer.takeRecords());
      let cls = 0;
      let sessionScore = 0;
      let sessionStart = -Infinity;
      let lastShift = -Infinity;
      for (const shift of [...layoutShifts].sort((a, b) => a.startTime - b.startTime)) {
        if (shift.hadRecentInput) continue;
        if (shift.startTime - lastShift < 1000 && shift.startTime - sessionStart < 5000) sessionScore += shift.value;
        else { sessionStart = shift.startTime; sessionScore = shift.value; }
        lastShift = shift.startTime;
        cls = Math.max(cls, sessionScore);
      }
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint", "paint")[0];
      const lastLcp = lcpEntries.at(-1) ?? null;
      const lcpReason = reasons["largest-contentful-paint"] || (truncated["largest-contentful-paint"]
        ? "Entry cap reached; latest LCP candidate is unavailable." : !lastLcp ? "No LCP candidate arrived within this observation window." : null);
      const clsReason = reasons["layout-shift"] || (truncated["layout-shift"] ? "Entry cap reached; complete observed CLS is unavailable." : null);
      return {
        timeOrigin: performance.timeOrigin, observedThroughMs: performance.now(), visibilityState: document.visibilityState,
        lcpCandidate: { value: lcpReason ? null : lastLcp, reason: lcpReason },
        observedCls: { value: clsReason ? null : cls, reason: clsReason },
        firstContentfulPaintMs: { value: fcp?.startTime ?? null, reason: fcp ? null : "No first-contentful-paint entry was exposed." },
        navigation: { value: nav ? {
          type: nav.type, redirectCount: nav.redirectCount, startTime: nav.startTime,
          fetchStart: nav.fetchStart, requestStart: nav.requestStart, responseStart: nav.responseStart,
          responseEnd: nav.responseEnd, domInteractive: nav.domInteractive,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd, loadEventEnd: nav.loadEventEnd,
          transferSize: nav.transferSize, encodedBodySize: nav.encodedBodySize, decodedBodySize: nav.decodedBodySize,
        } : null, reason: nav ? null : "No document Navigation Timing entry was exposed." },
        observerReasons: { ...reasons }, truncated: { ...truncated },
        lcpEntries: [...lcpEntries], layoutShifts: [...layoutShifts],
        eventTiming: { value: reasons.event ? null : [...eventTiming], reason: reasons.event || (eventTiming.length
          ? null : "No entries met the requested threshold in this window; this does not mean zero interaction latency.") },
        layout: { viewport: { width: innerWidth, height: innerHeight },
          document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          fontStatus: document.fonts?.status ?? null,
          regions: regions.map(region => {
            const element = document.querySelector(region);
            return { region, box: element ? geometry(element.getBoundingClientRect()) : null };
          }) },
      };
    },
  };
}

async function verifyDashboard(page: Page, days: LearningDays, response: Awaited<ReturnType<Page["waitForResponse"]>>) {
  expect(response.status(), "The measured dashboard must come from the real authorized API").toBe(200);
  const data = await response.json() as LearningDashboard;
  expect(data.days).toBe(days);
  expect(data.timeZone).toBe("Asia/Seoul");
  expect(data.summary).toMatchObject({ submissions: 2, acceptedSubmissions: 1, solvedProblems: 1, attemptedProblems: 1 });
  expect(data.activity).toHaveLength(days);
  expect(data.activity.reduce((sum, day) => sum + day.submissions, 0)).toBe(2);
  expect(data.activity.reduce((sum, day) => sum + day.acceptedSubmissions, 0)).toBe(1);
  expect(data.difficulties).toHaveLength(5);
  expect(data.review).toEqual([]);
  const summary = page.locator(`dl.learning-summary[aria-label="최근 ${days}일 학습 요약"]`);
  await expect(summary.locator("dd").nth(0)).toHaveText("2건");
  await expect(summary.locator("dd").nth(1)).toHaveText("1 / 시도 1문제");
  await expect(summary.locator("dd").nth(2)).toHaveText(`${data.summary.activeDays} / ${days}일`);
  await expect(summary.locator("dd").nth(3)).toHaveText("50%1건 성공");
  await expect(page.getByRole("button", { name: `최근 ${days}일`, exact: true })).toHaveAttribute("aria-pressed", "true");
  // Only numeric, owned fixture summaries are retained; never tokens, source, titles or raw response bodies.
  const retainedSummary = {
    submissions: data.summary.submissions,
    acceptedSubmissions: data.summary.acceptedSubmissions,
    solvedProblems: data.summary.solvedProblems,
    attemptedProblems: data.summary.attemptedProblems,
    activeDays: data.summary.activeDays,
  };
  for (const [field, value] of Object.entries(retainedSummary)) {
    expect(Number.isSafeInteger(value) && value >= 0, `Retained ${field} must be a nonnegative safe integer`).toBe(true);
  }
  return { days, status: response.status(), summary: retainedSummary, activityRows: data.activity.length, reviewRows: data.review.length };
}

async function heapSample(session: CDPSession | null): Promise<Metric<Record<string, number>>> {
  if (!session) return { value: null, reason: "This browser/context did not provide a Chromium CDP session." };
  try {
    const heap = await session.send("Runtime.getHeapUsage");
    return { value: { usedBytes: heap.usedSize, allocatedBytes: heap.totalSize,
      ...(typeof heap.embedderHeapUsedSize === "number" ? { embedderBytes: heap.embedderHeapUsedSize } : {}),
      ...(typeof heap.backingStorageSize === "number" ? { backingStorageBytes: heap.backingStorageSize } : {}),
    }, reason: null };
  } catch {
    return { value: null, reason: "Runtime.getHeapUsage was unavailable in this browser/context." };
  }
}

/** Bounded lab probe attached to the already owned fixture in the real Compose judge flow. */
export async function measureLearningPerformance(page: Page, testInfo: TestInfo) {
  const reportPath = resolve("reports/phase3-browser-performance.json");
  const samples: {
    navigation: number; api: Awaited<ReturnType<typeof verifyDashboard>>;
    initial: BrowserSnapshot; heapBefore: Awaited<ReturnType<typeof heapSample>>;
    periods: { api: Awaited<ReturnType<typeof verifyDashboard>>; timing: Metric<PeriodSample> }[];
    final: BrowserSnapshot | null; heapAfter: Awaited<ReturnType<typeof heapSample>> | null;
  }[] = [];
  const report = {
    schemaVersion: 2, probeVersion: "phase5-layout-attribution-v1", status: "incomplete", startedAt: new Date().toISOString(), completedAt: null as string | null,
    checkout: { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
      workflowRunId: process.env.GITHUB_RUN_ID ?? null, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
    fixture: { ownership: "created by this disposable Compose test", publishedPublicProblems: 1,
      ordinarySubmissions: 2, acceptedSubmissions: 1, wrongAnswerSubmissions: 1, solvedProblems: 1 },
    environment: { browser: page.context().browser()?.browserType().name() ?? null,
      browserVersion: page.context().browser()?.version() ?? null, viewport: page.viewportSize(),
      node: process.version, platform: process.platform, architecture: process.arch,
      composeMode: (process.env.COMPOSE_FILE ?? "").replaceAll("\\", "/").includes("/deploy/compose.yaml") ? "production" : "development",
      userAgent: await page.evaluate(() => navigator.userAgent) },
    protocol: { navigations: 3, periodsPerNavigation: [7, 90, 30, 7, 90], initialObservationAfterUiReadyMs: 500,
      finalEventDeliveryWaitMs: 100, maximumRenderFrameWaitMs: 250,
      cache: "warm context reused after existing learning visits; no cache clearing",
      networkOrCpuThrottling: "none", maximumEntriesPerTypePerDocument: 1000, forcedGarbageCollection: false },
    definitions: {
      lcpCandidate: "Latest browser-reported candidate by the bounded initial snapshot before scripted input; not a full-lifetime or field LCP.",
      observedCls: "Maximum session sum of non-recent-input shifts, gap <1s and session <5s, in this top-level document's observation window.",
      layoutAttribution: "Up to five browser-exposed sources per shift, fixed region labels and numerical viewport rectangles; source nodes are impacted elements, not proof of the initiating cause. Snapshot geometry includes font-loading status, without DOM text or URLs.",
      navigation: "Browser document Navigation Timing relative to timeOrigin, not API server processing time; period switches are same-document updates, not new document navigations.",
      periodLatency: "Browser click event timestamp to the second animation frame after fixture-correct new-period DOM; includes API/render work, not an actual paint timestamp or INP.",
      eventTiming: "Raw browser Event Timing, requested durationThreshold=16ms; reported durations have 8ms granularity. Faster events may be absent; absence is not zero latency.",
      heap: "CDP Runtime.getHeapUsage bytes for the inspected JavaScript isolate, without forced GC; not process RSS or a leak/long-duration stability claim.",
    },
    inp: { value: null, reason: "Three finite scripted page visits do not establish page-lifetime or field INP. Event Timing samples are retained separately." },
    limitations: ["One CI browser/viewport, warm cache, no CPU/network throttling, two-submission fixture.",
      "Small dependent samples do not establish population p95/p99, device-wide performance or before/after improvement.",
      "Observers and DOM checks add measurement overhead; late paints/shifts outside each bounded window are not measured.",
      "Unsupported metrics are null with reasons; functional API/UI assertions remain required without latency pass thresholds."],
    samples,
  };
  let session: CDPSession | null = null;
  try {
    try { session = await page.context().newCDPSession(page); } catch { /* Explicit null heap reason below. */ }
    await page.addInitScript(installProbe);
    for (let index = 0; index < 3; index++) {
      const response = page.waitForResponse(value => {
        const url = new URL(value.url());
        return url.pathname === "/api/v1/users/me/learning" && url.searchParams.get("days") === "30";
      });
      await page.goto("/learning?days=30", { waitUntil: "load" });
      const api = await verifyDashboard(page, 30, await response);
      // Deliberately bounded observation window, not an assertion delay or latency budget.
      await page.waitForTimeout(500);
      const sample: typeof samples[number] = { navigation: index + 1, api,
        initial: await page.evaluate(() => window.__ojLearningProbe.snapshot()),
        heapBefore: await heapSample(session), periods: [], final: null, heapAfter: null };
      samples.push(sample);
      for (const days of [7, 90, 30, 7, 90] as const) {
        await page.evaluate(value => window.__ojLearningProbe.beginPeriod(value), days);
        const update = page.waitForResponse(value => {
          const url = new URL(value.url());
          return url.pathname === "/api/v1/users/me/learning" && url.searchParams.get("days") === String(days);
        });
        await page.getByRole("button", { name: `최근 ${days}일`, exact: true }).click();
        const periodApi = await verifyDashboard(page, days, await update);
        // Give the observer two frames; hidden/throttled contexts must not hang optional measurement.
        // This is a collection bound, not a latency pass/fail threshold.
        await page.evaluate(() => new Promise<void>(done => {
          const timeout = setTimeout(done, 250);
          requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); done(); }));
        }));
        const timing = await page.evaluate(() => window.__ojLearningProbe.periodSample());
        sample.periods.push({ api: periodApi, timing: { value: timing,
          reason: timing ? null : "The click/DOM/render-frame observer did not complete in the bounded window; API/UI assertions passed." } });
      }
      await page.waitForTimeout(100);
      sample.final = await page.evaluate(() => window.__ojLearningProbe.snapshot());
      sample.heapAfter = await heapSample(session);
    }
    report.status = "complete";
  } finally {
    report.completedAt = new Date().toISOString();
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("phase3-browser-performance", { path: reportPath, contentType: "application/json" });
    console.log("Phase III bounded browser lab:", JSON.stringify({ status: report.status,
      samples: samples.map(sample => ({ navigation: sample.navigation, lcpCandidateMs: sample.initial.lcpCandidate.value?.startTime ?? null,
        observedCls: sample.final?.observedCls.value ?? null,
        clickToVerifiedRenderFrameMs: sample.periods.map(period => period.timing.value?.clickToVerifiedRenderFrameMs ?? null),
        heapBeforeBytes: sample.heapBefore.value?.usedBytes ?? null, heapAfterBytes: sample.heapAfter?.value?.usedBytes ?? null })),
      inp: null, rawReport: "reports/phase3-browser-performance.json" }));
    await session?.detach();
  }
}
