import { expect, test } from "@playwright/test";
import {
  cursorPosition,
  handleBackspace,
  handleCharacter,
  handleEnter,
  handleTab,
  toggleComment,
} from "../src/editor/codeEditing";

const at = (value: string, start: number, end = start) => ({
  value,
  start,
  end,
});

test.describe("code editing rules", () => {
  test("Enter keeps the indentation and adds one level after an opening bracket or a Python colon", () => {
    expect(handleEnter(at("  foo", 5), "CPP")).toMatchObject({
      value: "  foo\n  ",
      start: 8,
    });
    expect(handleEnter(at("if (x) {", 8), "CPP")).toMatchObject({
      value: "if (x) {\n    ",
      start: 13,
    });
    expect(handleEnter(at("def f():", 8), "PYTHON")).toMatchObject({
      value: "def f():\n    ",
      start: 13,
    });
    // 닫는 괄호 바로 앞에서는 가운데에 커서를 둔 채 닫는 괄호를 아래 줄로 내린다
    expect(handleEnter(at("{}", 1), "JAVA")).toMatchObject({
      value: "{\n    \n}",
      start: 6,
    });
  });

  test("brackets and quotes are paired, skipped over, wrapped around a selection and removed together", () => {
    expect(handleCharacter(at("", 0), "(")).toMatchObject({
      value: "()",
      start: 1,
    });
    expect(handleCharacter(at("()", 1), ")")).toMatchObject({
      value: "()",
      start: 2,
    });
    expect(handleCharacter(at("abc", 1, 3), '"')).toMatchObject({
      value: 'a"bc"',
      start: 2,
      end: 4,
    });
    // 단어 중간의 작은따옴표(don't)와 글자 앞의 여는 괄호에는 짝을 넣지 않는다
    expect(handleCharacter(at("don", 3), "'")).toBeNull();
    expect(handleCharacter(at("x", 0), "(")).toBeNull();
    expect(handleBackspace(at("()", 1))).toMatchObject({ value: "", start: 0 });
    expect(handleBackspace(at("(a)", 2))).toBeNull();
  });

  test("Tab indents and Shift+Tab outdents one line or every selected line", () => {
    expect(handleTab(at("x", 1), false)).toMatchObject({
      value: "x    ",
      start: 5,
    });
    expect(handleTab(at("a\nb", 0, 3), false)).toMatchObject({
      value: "    a\n    b",
    });
    expect(handleTab(at("    a\n  b", 0, 9), true)).toMatchObject({
      value: "a\nb",
    });
    expect(handleTab(at("\ta", 2), true)).toMatchObject({
      value: "a",
      start: 1,
    });
  });

  test("Ctrl/⌘+/ comments and uncomments lines with the language's comment marker", () => {
    expect(toggleComment(at("a\nb", 0, 3), "PYTHON").value).toBe("# a\n# b");
    expect(toggleComment(at("# a\n# b", 0, 7), "PYTHON").value).toBe("a\nb");
    expect(toggleComment(at("  x = 1;", 4), "JAVASCRIPT").value).toBe(
      "  // x = 1;",
    );
    expect(toggleComment(at("  // x = 1;", 4), "JAVASCRIPT").value).toBe(
      "  x = 1;",
    );
    // 빈 줄은 건드리지 않는다
    expect(toggleComment(at("a\n\nb", 0, 4), "GO").value).toBe("// a\n\n// b");
  });

  test("cursorPosition reports a 1-based line and column", () => {
    expect(cursorPosition("ab\ncde", 0)).toEqual({ line: 1, column: 1 });
    expect(cursorPosition("ab\ncde", 5)).toEqual({ line: 2, column: 3 });
  });
});
