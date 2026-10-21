import { expect, test } from "@playwright/test";
import {
  blankForm,
  clearProblemDraft,
  hasErrors,
  isPristine,
  problemDraftScope,
  readProblemDraft,
  validate,
  writeProblemDraft,
  type ProblemDraft,
} from "../src/problems/editor";
import { readSourceDraft, resetSourceDraft, writeSourceDraft } from "../src/editor/sourceDrafts";

class StorageFixture {
  values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  failRemoves = false;
  getItem(key: string) {
    if (this.failReads) throw new Error("read denied");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemoves) throw new Error("remove denied");
    this.values.delete(key);
  }
}

let local: StorageFixture;
let tab: StorageFixture;
let descriptors: (PropertyDescriptor | undefined)[];
test.beforeEach(() => {
  local = new StorageFixture();
  tab = new StorageFixture();
  descriptors = ["localStorage", "sessionStorage"].map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: tab });
});
test.afterEach(() => {
  ["localStorage", "sessionStorage"].forEach((name, index) => {
    const descriptor = descriptors[index];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
});

const draft = (revision: string): ProblemDraft => ({
  form: { ...blankForm(), title: revision },
  slugTouched: false,
  revision,
  savedAt: 1,
});

test("hidden-only cases and empty/whitespace output are valid, but no test cases is not", () => {
  const form = {
    ...blankForm(), title: "No output", slug: "no-output", statement: "Do nothing",
    inputDescription: "No input", outputDescription: "No output",
  };
  form.cases[0].isSample = false;
  for (const expectedOutput of ["", " \n\t"]) {
    form.cases[0].expectedOutput = expectedOutput;
    expect(hasErrors(validate(form, true))).toBe(false);
    expect(hasErrors(validate(form, false))).toBe(false);
  }
  expect(validate({ ...form, cases: [] }, false).testCases).toBeTruthy();
});

test("only the default case and limits are pristine", () => {
  expect(isPristine(blankForm())).toBe(true);
  for (const change of [{ difficulty: "HARD" as const }, { timeLimitMs: 2000 }, { memoryLimitMb: 512 }])
    expect(isPristine({ ...blankForm(), ...change })).toBe(false);
  const form = blankForm();
  form.cases[0].isSample = false;
  expect(isPristine(form)).toBe(false);
});

test("author drafts do not adopt or delete ownerless legacy data and stay owner/problem-scoped", () => {
  const legacy = JSON.stringify({ form: { ...blankForm(), title: "legacy private" }, savedAt: 1, slugTouched: false });
  local.setItem("unsolvable-oj-problem-draft-v1", legacy);
  const scope = problemDraftScope("owner-a", "p-1");
  const value = draft("owner-scoped");
  expect(readProblemDraft(scope).draft).toBeNull();
  expect(writeProblemDraft(scope, value)).toBe(true);
  expect(readProblemDraft(problemDraftScope("owner-b", "p-1")).draft).toBeNull();
  expect(readProblemDraft(problemDraftScope("owner-a", "p-2")).draft).toBeNull();
  expect(readProblemDraft(problemDraftScope("owner-a")).draft).toBeNull();
  expect(clearProblemDraft(scope, value)).toBe(true);
  expect(local.getItem("unsolvable-oj-problem-draft-v1")).toBe(legacy);
});

test("an older submit cannot clear a newer draft revision", () => {
  const scope = problemDraftScope("revision-owner");
  const old = draft("submitted");
  const next = draft("typed-later");
  writeProblemDraft(scope, old);
  writeProblemDraft(scope, next);
  expect(clearProblemDraft(scope, old)).toBe(false);
  expect(readProblemDraft(scope).draft).toEqual(next);
  expect(clearProblemDraft(scope, next)).toBe(true);
  expect(readProblemDraft(scope).draft).toBeNull();
});

test("quota/read failures retain the latest author work in memory; discard never restores it", () => {
  const scope = problemDraftScope("quota-owner");
  writeProblemDraft(scope, draft("old"));
  tab.failWrites = true;
  const latest = draft("latest");
  expect(writeProblemDraft(scope, latest)).toBe(false);
  tab.failReads = true;
  expect(readProblemDraft(scope)).toEqual({ draft: latest, failed: true });
  tab.failRemoves = true;
  expect(clearProblemDraft(scope, latest)).toBe(false);
  expect(readProblemDraft(scope).draft).toBeNull();
});

test("discard can overwrite a stale record with a tombstone if remove fails", () => {
  const scope = problemDraftScope("tombstone-owner");
  const value = draft("discarded");
  writeProblemDraft(scope, value);
  tab.failRemoves = true;
  expect(clearProblemDraft(scope, value)).toBe(true);
  expect([...tab.values.values()]).toEqual(["null"]);
});

test("stored author drafts are validated and read failures are explicit", () => {
  const scope = problemDraftScope("malformed-owner");
  const key = `unsolvable-oj-problem-draft-v2:${scope}`;
  for (const value of ["{", "{}", JSON.stringify({ ...draft("bad"), form: { cases: [{}] } })]) {
    tab.setItem(key, value);
    expect(readProblemDraft(scope)).toEqual({ draft: null, failed: true });
  }
  tab.setItem(key, JSON.stringify(draft("readable")));
  expect(readProblemDraft(scope).draft?.revision).toBe("readable");
  tab.failReads = true;
  expect(readProblemDraft(problemDraftScope("unreadable-owner"))).toEqual({ draft: null, failed: true });
});

test("source writes beat stale storage across language/problem switches and reset clears memory too", () => {
  local.setItem("unsolvable-oj-draft-v1:source-p:PYTHON", "old");
  expect(readSourceDraft("source-p", "PYTHON").value).toBe("old");
  local.failWrites = true;
  expect(writeSourceDraft("source-p", "PYTHON", "latest").failed).toBe(true);
  expect(writeSourceDraft("source-p", "CPP", "cpp latest").failed).toBe(true);
  local.failReads = true;
  expect(readSourceDraft("source-p", "PYTHON").value).toBe("latest");
  expect(readSourceDraft("source-p", "CPP").value).toBe("cpp latest");
  expect(readSourceDraft("other-source-p", "PYTHON").failed).toBe(true);
  expect(resetSourceDraft("source-p", "PYTHON", "starter")).toBe(true);
  expect(readSourceDraft("source-p", "PYTHON").value).toBeNull();
  local.failRemoves = true;
  expect(resetSourceDraft("source-p", "CPP", "cpp starter")).toBe(false);
  expect(readSourceDraft("source-p", "CPP")).toMatchObject({ value: null, failed: true });
});

test("source reset overwrites stale storage with the starter when removal alone fails", () => {
  writeSourceDraft("reset-fallback-p", "PYTHON", "old source");
  local.failRemoves = true;
  expect(resetSourceDraft("reset-fallback-p", "PYTHON", "starter source")).toBe(true);
  expect(local.getItem("unsolvable-oj-draft-v1:reset-fallback-p:PYTHON")).toBe("starter source");
  expect(readSourceDraft("reset-fallback-p", "PYTHON").value).toBeNull();
});

test("source drafts: a clean persisted cache refreshes after an external write", () => {
  const problemId = "external-source-replacement";
  const key = `unsolvable-oj-draft-v1:${problemId}:PYTHON`;
  local.setItem(key, "print('old persisted source')");
  expect(readSourceDraft(problemId, "PYTHON")).toMatchObject({ value: "print('old persisted source')", failed: false });
  local.setItem(key, "print('other tab latest')");
  const restored = readSourceDraft(problemId, "PYTHON");
  expect(restored).toMatchObject({ value: "print('other tab latest')", failed: false });
});

test("source drafts: a cached absence refreshes after another tab first saves", () => {
  const problemId = "external-source-first-save";
  const key = `unsolvable-oj-draft-v1:${problemId}:PYTHON`;
  expect(readSourceDraft(problemId, "PYTHON")).toMatchObject({ value: null, failed: false });
  local.setItem(key, "print('other tab first save')");
  const restored = readSourceDraft(problemId, "PYTHON");
  expect(restored).toMatchObject({ value: "print('other tab first save')", failed: false });
});

test("source drafts: read failure falls back to clean memory without blocking later refresh", () => {
  const problemId = "source-read-recovery";
  const key = `unsolvable-oj-draft-v1:${problemId}:PYTHON`;
  const saved = writeSourceDraft(problemId, "PYTHON", "old source");
  expect(readSourceDraft(problemId, "PYTHON")).toBe(saved);
  local.failReads = true;
  expect(readSourceDraft(problemId, "PYTHON")).toEqual({ ...saved, failed: true });
  expect(saved.failed).toBe(false);
  local.setItem(key, "other tab latest");
  local.failReads = false;
  expect(readSourceDraft(problemId, "PYTHON")).toMatchObject({ value: "other tab latest", failed: false });
});

test("source drafts: failed-write memory still wins when shared storage is readable", () => {
  const problemId = "source-dirty-memory";
  const key = `unsolvable-oj-draft-v1:${problemId}:PYTHON`;
  local.setItem(key, "persisted source");
  local.failWrites = true;
  const unsaved = writeSourceDraft(problemId, "PYTHON", "memory-only latest");
  expect(unsaved.failed).toBe(true);
  local.failWrites = false;
  local.setItem(key, "other tab source");
  expect(readSourceDraft(problemId, "PYTHON")).toBe(unsaved);
  expect(local.getItem(key)).toBe("other tab source");
});

test("source drafts: a fallback reset refreshes only after its persisted value changes", () => {
  const problemId = "source-reset-refresh";
  const key = `unsolvable-oj-draft-v1:${problemId}:PYTHON`;
  writeSourceDraft(problemId, "PYTHON", "old source");
  local.failRemoves = true;
  expect(resetSourceDraft(problemId, "PYTHON", "starter")).toBe(true);
  expect(readSourceDraft(problemId, "PYTHON")).toEqual({ value: null, savedAt: null, failed: false });
  local.setItem(key, "other tab latest");
  expect(readSourceDraft(problemId, "PYTHON")).toMatchObject({ value: "other tab latest", failed: false });
  local.failRemoves = false;
  local.removeItem(key);
  expect(readSourceDraft(problemId, "PYTHON")).toEqual({ value: null, savedAt: null, failed: false });
});
