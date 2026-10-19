import { expect, test } from "@playwright/test";
import {
  applySuggestion,
  currentWord,
  fuzzyMatch,
  inferType,
  memberContext,
  moveStop,
  reconcileSession,
  recordAccepted,
  resetAcceptedHistory,
  scanContext,
  suggest,
  type Suggestion,
} from "../src/editor/autocomplete";
import type { Language } from "../src/types";

const labels = (items: Suggestion[]) => items.map((item) => item.label);
const at = (value: string, language: Language, manual = false) =>
  suggest(value, value.length, language, { manual });
const pick = (items: Suggestion[], label: string) =>
  items.find((item) => item.label === label)!;

test.beforeEach(() => resetAcceptedHistory());

test.describe("fuzzy matching", () => {
  test("matches subsequences, initials and camel-case humps", () => {
    expect(fuzzyMatch("pb", "push_back")?.indices).toEqual([0, 5]);
    expect(fuzzyMatch("aL", "ArrayList")?.indices).toEqual([0, 5]);
    expect(fuzzyMatch("sw", "swap")?.indices).toEqual([0, 1]);
    expect(fuzzyMatch("zz", "swap")).toBeNull();
    // 첫 글자는 단어의 시작이나 경계에서 맞아야 한다
    expect(fuzzyMatch("ush", "push_back")).toBeNull();
    expect(fuzzyMatch("ba", "push_back")?.indices).toEqual([5, 6]);
  });

  test("prefix matches outrank scattered ones", () => {
    const prefix = fuzzyMatch("pri", "print")!.score;
    const scattered = fuzzyMatch("pri", "pair_remove_index")!.score;
    expect(prefix).toBeGreaterThan(scattered);
  });
});

test.describe("suggestions", () => {
  test("starts after one letter and ranks the best match first", () => {
    expect(labels(at("p", "PYTHON")).length).toBeGreaterThan(0);
    expect(labels(at("pri", "PYTHON"))[0]).toBe("print");
    // 약어: pq → priority_queue, SB → StringBuilder
    expect(labels(at("pq", "CPP"))).toContain("priority_queue");
    expect(labels(at("SB", "JAVA"))).toContain("StringBuilder");
  });

  test("includes names already written, tagged by kind", () => {
    const items = at(
      "count_total = 0\ndef count_items():\n    pass\ncount_",
      "PYTHON",
    );
    expect(pick(items, "count_total").kind).toBe("variable");
    expect(pick(items, "count_items").kind).toBe("function");
    expect(pick(items, "count_items").insert).toBe("count_items($0)");
  });

  test("a finished word is not offered again, but snippets still expand", () => {
    expect(labels(at("pass", "PYTHON"))).not.toContain("pass");
    // 함수는 괄호를 붙여 주려고 이름을 다 쳐도 계속 제안한다
    expect(pick(at("print", "PYTHON"), "print").kind).toBe("function");
    expect(pick(at("for", "PYTHON"), "for").kind).toBe("snippet");
    // 단어 중간에서는 제안하지 않는다
    expect(suggest("forx", 2, "PYTHON")).toEqual([]);
  });

  test("Ctrl+Space (manual) lists suggestions even with nothing typed", () => {
    expect(at("", "PYTHON")).toEqual([]);
    expect(at("", "PYTHON", true).length).toBeGreaterThan(5);
  });

  test("stays silent inside strings and comments", () => {
    expect(at('x = "pri', "PYTHON")).toEqual([]);
    expect(at("# pri", "PYTHON")).toEqual([]);
    expect(at("// pri", "CPP")).toEqual([]);
    expect(at("/* pri\n pri", "JAVA")).toEqual([]);
    expect(at('s = """pri', "PYTHON")).toEqual([]);
    expect(at("a = 1 # note\npri", "PYTHON").length).toBeGreaterThan(0);
    expect(scanContext("x = 'it\\'s pri", 14, "PYTHON")).toBe("string");
    expect(scanContext("let a = 1;\n", 11, "RUST")).toBe("code");
  });

  test("remembers what you picked and ranks it higher next time", () => {
    const before = labels(at("so", "CPP"));
    const last = before[before.length - 1];
    expect(before.indexOf(last)).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) recordAccepted(last);
    expect(labels(at("so", "CPP")).indexOf(last)).toBeLessThan(
      before.indexOf(last),
    );
  });
});

test.describe("member completion", () => {
  test("detects what comes before the dot", () => {
    expect(memberContext("v.pu", 4)).toEqual({
      operator: ".",
      receiver: "v",
      typed: "pu",
    });
    expect(memberContext("std::", 5)).toMatchObject({
      operator: "::",
      receiver: "std",
    });
    expect(memberContext("p->", 3)).toMatchObject({
      operator: "->",
      receiver: "p",
    });
    expect(memberContext("x = 1.", 6)).toBeNull();
    expect(memberContext("input().", 8)?.receiver).toBe("input()");
    expect(memberContext('"abc".', 6)?.receiver).toBe('"abc"');
  });

  test("infers types from declarations", () => {
    expect(inferType("s", "s = input()\n", "PYTHON")).toBe("str");
    expect(
      inferType("a", "a = list(map(int, input().split()))\n", "PYTHON"),
    ).toBe("list");
    expect(inferType("d", "d = {}\nd2 = {1: 2}\n", "PYTHON")).toBe("dict");
    expect(inferType("d2", "d = {}\nd2 = {1: 2}\n", "PYTHON")).toBe("dict");
    expect(inferType("v", "vector<int> v;\n", "CPP")).toBe("vector");
    expect(inferType("m", "std::unordered_map<int, int> m;\n", "CPP")).toBe(
      "map",
    );
    expect(
      inferType("sc", "Scanner sc = new Scanner(System.in);\n", "JAVA"),
    ).toBe("Scanner");
    expect(inferType("arr", "int[] arr = new int[3];\n", "JAVA")).toBe("array");
    expect(inferType("xs", "const xs = [1, 2];\n", "JAVASCRIPT")).toBe("array");
    expect(
      inferType("names", "let names: string[] = [];\n", "TYPESCRIPT"),
    ).toBe("array");
    expect(inferType("out", "let mut out = String::new();\n", "RUST")).toBe(
      "String",
    );
    expect(inferType("r", "r := bufio.NewReader(os.Stdin)\n", "GO")).toBe(
      "reader",
    );
  });

  test("offers the members of the inferred type, with signatures", () => {
    const python = at("s = input()\ns.sp", "PYTHON");
    expect(labels(python)[0]).toBe("split");
    expect(pick(python, "split")).toMatchObject({
      kind: "method",
      detail: "(sep)",
      insert: "split($0)",
    });
    expect(labels(at("a = []\na.", "PYTHON"))).toContain("append");
    expect(labels(at("a = []\na.", "PYTHON"))).not.toContain("split");
    expect(labels(at("vector<int> v;\nv.pu", "CPP"))[0]).toBe("push_back");
    expect(
      labels(at("vector<int> v;\nv.pb", "CPP")).slice(0, 2).sort(),
    ).toEqual(["pop_back", "push_back"]);
    expect(labels(at("System.out.pri", "JAVA"))).toEqual([
      "println",
      "print",
      "printf",
    ]);
    expect(
      labels(at("Scanner sc = new Scanner(System.in);\nsc.nextI", "JAVA"))[0],
    ).toBe("nextInt");
    expect(labels(at("fmt.Pr", "GO"))[0]).toBe("Println");
    expect(labels(at("std::so", "CPP"))[0]).toBe("sort");
    expect(labels(at("let v = vec![1];\nv.pu", "RUST"))[0]).toBe("push");
    expect(labels(at("Vec::", "RUST"))).toContain("with_capacity");
    expect(labels(at("import sys\nsys.stdin.rea", "PYTHON"))).toContain(
      "readline",
    );
  });

  test("properties insert without parentheses; zero-argument calls keep the caret after them", () => {
    expect(pick(at("v = [1]\nv.", "PYTHON"), "pop").insert).toBe("pop()");
    expect(pick(at("System.out.", "JAVA"), "println").insert).toBe(
      "println($0)",
    );
    expect(
      pick(at("int[] arr = new int[2];\narr.", "JAVA"), "length").insert,
    ).toBe("length");
  });

  test("falls back to every member of the language when the type is unknown", () => {
    const items = at("foo(x).", "PYTHON");
    expect(labels(items)).toContain("append");
    expect(labels(items)).toContain("split");
  });
});

test.describe("headers and imports", () => {
  test("#include <… lists headers and closes the bracket", () => {
    const items = at("#include <io", "CPP");
    expect(labels(items)[0]).toBe("iostream");
    const done = applySuggestion("#include <io", 12, items[0]);
    expect(done.value).toBe("#include <iostream>");
    // 이미 닫는 기호가 있으면 겹치지 않는다
    const closed = applySuggestion("#include <io>", 12, items[0]);
    expect(closed.value).toBe("#include <iostream>");
    expect(labels(at("#include <bits/s", "CPP"))[0]).toBe("bits/stdc++.h");
  });

  test("Python and Java import lines list modules and packages", () => {
    expect(labels(at("import he", "PYTHON"))[0]).toBe("heapq");
    expect(labels(at("from col", "PYTHON"))[0]).toBe("collections");
    expect(labels(at("import java.util.Sc", "JAVA"))).toContain(
      "java.util.Scanner",
    );
  });
});

test.describe("applying", () => {
  test("functions insert parentheses with the caret inside; an existing ( is reused", () => {
    const print = pick(at("pri", "PYTHON"), "print");
    const done = applySuggestion("pri", 3, print);
    expect(done.value).toBe("print()");
    expect(done.session).toBeNull();
    expect(done.start).toBe(6);
    expect(done.end).toBe(6);
    const reuse = applySuggestion("pri(1)", 3, print);
    expect(reuse.value).toBe("print(1)");
  });

  test("keywords only replace the word; qualifiers are not repeated", () => {
    const keyword = pick(at("ret", "PYTHON"), "return");
    expect(applySuggestion("ret", 3, keyword).value).toBe("return");
    const incl = pick(at("#incl", "CPP"), "include");
    expect(applySuggestion("#incl", 5, incl).value).toBe(
      "#include <bits/stdc++.h>",
    );
  });

  test("a snippet keeps the line indent and selects the first placeholder", () => {
    const value = "if x:\n    fo";
    const snippet = pick(at(value, "PYTHON"), "for");
    const result = applySuggestion(value, value.length, snippet);
    expect(result.value).toBe("if x:\n    for i in range(n):\n        ");
    expect(result.value.slice(result.start, result.end)).toBe("i");
    expect(result.session?.current).toBe(1);
  });

  test("Tab walks through the placeholders and ends at the final position", () => {
    const applied = applySuggestion("fo", 2, pick(at("fo", "PYTHON"), "for"));
    expect(applied.value).toBe("for i in range(n):\n    ");
    const second = moveStop(applied.session!)!;
    expect(applied.value.slice(second.start, second.end)).toBe("n");
    const last = moveStop(second.session!)!;
    expect(last.session).toBeNull();
    expect(last.start).toBe(applied.value.length);
    // Shift+Tab 은 이전 칸으로
    const back = moveStop(second.session!, true)!;
    expect(applied.value.slice(back.start, back.end)).toBe("i");
    expect(moveStop(applied.session!, true)).toBeNull();
  });

  test("mirrored placeholders follow what you type", () => {
    const applied = applySuggestion(
      "fori",
      4,
      pick(at("fori", "JAVA"), "fori"),
    );
    expect(applied.value).toBe("for (int i = 0; i < n; i++) {\n    \n}");
    // 선택된 첫 i 를 j 로 바꿔 친 상황을 흉내 낸다
    const typed =
      applied.value.slice(0, applied.start) +
      "j" +
      applied.value.slice(applied.end);
    const synced = reconcileSession(
      applied.session!,
      applied.value,
      typed,
      applied.start + 1,
    );
    expect(synced.value).toBe("for (int j = 0; j < n; j++) {\n    \n}");
    expect(synced.session).not.toBeNull();
    // 이어서 n 칸으로 옮겨도 위치가 맞는다
    const next = moveStop(synced.session!)!;
    expect(synced.value.slice(next.start, next.end)).toBe("n");
    // 칸 밖을 고치면 세션이 끝난다
    const outside = reconcileSession(
      synced.session!,
      synced.value,
      `x${synced.value}`,
      1,
    );
    expect(outside.session).toBeNull();
  });

  test("current word helper", () => {
    expect(currentWord("a + foo_bar", 11)).toEqual({
      text: "foo_bar",
      start: 4,
    });
    expect(currentWord("a + ", 4)).toBeNull();
  });
});

test.describe("regressions found in review", () => {
  test("a number-literal suffix is not a word", () => {
    expect(at("long x = 10L", "JAVA")).toEqual([]);
    expect(at("double y = 1.5f", "CPP")).toEqual([]);
    expect(at("int z = 0xff", "C")).toEqual([]);
    expect(currentWord("x = 10L", 7)).toBeNull();
  });

  test("an already complete module or header offers nothing, so Enter is left alone", () => {
    expect(at("import sys", "PYTHON")).toEqual([]);
    expect(at("#include <iostream", "CPP")).toEqual([]);
  });

  test("names already used do not hide the richer built-in entry", () => {
    const python = at("print(1)\npri", "PYTHON");
    expect(pick(python, "print")).toMatchObject({
      kind: "function",
      insert: "print($0)",
    });
    expect(pick(at("printf(1);\nprint", "C"), "printf").kind).not.toBe("word");
  });

  test("type inference follows the final call and ignores value-type annotations", () => {
    expect(inferType("d", "d = {}\n", "PYTHON")).toBe("dict");
    expect(inferType("a", 'a = "x,y".split(",")\n', "PYTHON")).toBe("list");
    expect(inferType("a", "const a = 'x,y'.split(',');\n", "JAVASCRIPT")).toBe(
      "array",
    );
    expect(
      inferType("n", "let n: usize = s.trim().parse().unwrap();\n", "RUST"),
    ).toBeNull();
    expect(inferType("v", "let v = s.parse::<i32>();\n", "RUST")).toBe(
      "Option",
    );
  });

  test("optional chaining and non-null assertions keep member completion", () => {
    expect(memberContext("a?.", 3)?.receiver).toBe("a");
    expect(memberContext("a!.", 3)?.receiver).toBe("a");
    expect(labels(at("const xs = [1];\nxs?.pu", "TYPESCRIPT"))[0]).toBe("push");
  });

  test("Rust lifetimes do not open a string, and docstrings do not get module hints", () => {
    expect(scanContext("fn f(x: &'a str) { pri", 22, "RUST")).toBe("code");
    expect(scanContext("let c = 'x'; pri", 16, "RUST")).toBe("code");
    expect(at('"""\nfrom the', "PYTHON")).toEqual([]);
  });
});
