import { expect, test } from "@playwright/test";
import {
  blankCase,
  blankForm,
  editCases,
  reviewForm,
  validate,
  type ProblemForm,
} from "../src/problems/editor";

const filled = (): ProblemForm => ({
  ...blankForm(),
  title: "두 수의 합",
  slug: "a-plus-b",
  statement: "A+B를 출력한다.",
  inputDescription: "A와 B",
  outputDescription: "A+B",
  cases: [blankCase(true), blankCase(false)],
});

test.describe("test case list edits", () => {
  test("no-op edits return the same array so the form is not rebuilt", () => {
    const one = [blankCase()];
    expect(editCases(one, { type: "remove", key: one[0].key })).toBe(one);
    const two = [blankCase(), blankCase(false)];
    expect(editCases(two, { type: "move", key: two[0].key, step: -1 })).toBe(two);
    expect(editCases(two, { type: "move", key: two[1].key, step: 1 })).toBe(two);
    expect(editCases(two, { type: "duplicate", key: "missing" })).toBe(two);
  });

  test("move, duplicate, remove and update change only the targeted case", () => {
    const [a, b] = [blankCase(), blankCase(false)];
    expect(editCases([a, b], { type: "move", key: b.key, step: -1 })).toEqual([b, a]);

    const copied = editCases([{ ...a, input: "1 2", collapsed: true }, b], {
      type: "duplicate",
      key: a.key,
    });
    expect(copied).toHaveLength(3);
    expect(copied[1]).toMatchObject({ input: "1 2", collapsed: false });
    expect(copied[1].key).not.toBe(a.key);
    expect(copied[2]).toBe(b);

    expect(editCases([a, b], { type: "remove", key: a.key })).toEqual([b]);
    const updated = editCases([a, b], {
      type: "update",
      key: b.key,
      change: { expectedOutput: "3" },
    });
    expect(updated[0]).toBe(a);
    expect(updated[1].expectedOutput).toBe("3");
  });
});

test.describe("form review", () => {
  test("a blank new form points at the title first and lists what is missing", () => {
    const form = blankForm();
    const review = reviewForm(form, validate(form, true), false, false);
    expect(review.firstErrorTarget).toBe("title");
    expect(review.checklist.map((item) => item.target)).toContain("slug");
    expect(review.checklist.find((item) => item.target === "title")?.ok).toBe(false);
    expect(Object.values(review.stepDone)).toEqual([false, false, true, false]);
    expect(review.warnings).toHaveLength(2);
  });

  test("a complete form passes every step, but a taken slug still blocks saving", () => {
    const form = filled();
    const errors = validate(form, true);
    const review = reviewForm(form, errors, false, false);
    expect(review.firstErrorTarget).toBeNull();
    expect(review.checklist.every((item) => item.ok)).toBe(true);
    expect(Object.values(review.stepDone).every(Boolean)).toBe(true);
    expect(review.warnings).toEqual([]);
    expect([review.sampleCount, review.hiddenCount]).toEqual([1, 1]);

    const taken = reviewForm(form, errors, false, true);
    expect(taken.firstErrorTarget).toBe("slug");
    expect(taken.stepDone["sec-basic"]).toBe(false);
    expect(taken.stepDone["sec-review"]).toBe(false);

    // 수정 화면에는 주소 항목이 없다.
    const editing = reviewForm(form, validate(form, false), true, false);
    expect(editing.checklist.some((item) => item.target === "slug")).toBe(false);
  });
});
