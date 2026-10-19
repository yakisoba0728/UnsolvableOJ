import { expect, test } from "@playwright/test";
import {
  applySuggestion,
  currentWord,
  suggest,
} from "../src/editor/autocomplete";

test.describe("code autocomplete", () => {
  test("suggests snippets first, then keywords, then names already used", () => {
    const items = suggest("x = 1\nfo", 8, "PYTHON");
    expect(items[0]).toMatchObject({ label: "for", kind: "snippet" });
    expect(items.map((item) => item.label)).toContain("format");
    const named = suggest("count_total = 0\ncount_", 22, "PYTHON");
    expect(named.map((item) => item.label)).toContain("count_total");
  });

  test("needs two letters, ignores the middle of a word and the exact match", () => {
    expect(suggest("f", 1, "PYTHON")).toEqual([]);
    expect(
      suggest("print", 5, "PYTHON").map((item) => item.label),
    ).not.toContain("print");
    // 커서 뒤에 단어가 이어져 있으면 제안하지 않는다
    expect(suggest("forx", 2, "PYTHON")).toEqual([]);
    expect(suggest("zzzz", 4, "PYTHON")).toEqual([]);
    // 스니펫은 이름을 끝까지 쳐도 펼칠 수 있다
    expect(suggest("for", 3, "PYTHON")[0]).toMatchObject({
      label: "for",
      kind: "snippet",
    });
  });

  test("applying a snippet replaces the word, keeps the line indent and puts the caret at $0", () => {
    const value = "if x:\n    fo";
    const forSnippet = suggest(value, value.length, "PYTHON").find(
      (item) => item.label === "for",
    )!;
    const result = applySuggestion(value, value.length, forSnippet);
    expect(result.value).toBe("if x:\n    for i in range():\n        ");
    expect(result.start).toBe("if x:\n    for i in range(".length);
    // 키워드는 단어만 바꾼다
    const keyword = suggest("pri", 3, "PYTHON").find(
      (item) => item.label === "print",
    )!;
    expect(applySuggestion("pri", 3, keyword)).toMatchObject({
      value: "print",
      start: 5,
    });
  });

  test("works for each language and finds the current word", () => {
    expect(suggest("cou", 3, "CPP").some((item) => item.label === "cout")).toBe(
      true,
    );
    expect(
      suggest("Syst", 4, "JAVA").some((item) => item.label === "System"),
    ).toBe(true);
    expect(suggest("fmt.Pr", 6, "GO").length).toBeGreaterThan(0);
    expect(currentWord("a + foo_bar", 11)).toEqual({
      text: "foo_bar",
      start: 4,
    });
  });
});
