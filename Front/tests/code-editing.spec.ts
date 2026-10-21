import { expect, test } from "@playwright/test";
import {
  INDENT,
  addUnits,
  backspaceUnit,
  cursorPosition,
  deleteUnit,
  handleBackspace,
  handleCharacter,
  handleEnter,
  handleTab,
  remapUnits,
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

  test("Enter on a whitespace-only line does not carry its indentation over", () => {
    for (const value of ["", "    ", "\t"]) {
      expect(handleEnter(at(value, value.length), "PYTHON")).toEqual({
        value: `${value}\n`,
        start: value.length + 1,
        end: value.length + 1,
        units: [], // 이어받은 들여쓰기가 없으니 새 Tab 단위도 없다
      });
    }
    // 내용이 있는 줄 가운데에서 치면 뒤쪽 글자는 들여쓰기를 유지한다
    expect(handleEnter(at("    foo", 4), "CPP")).toMatchObject({
      value: "    \n    foo",
      start: 9,
    });
  });

  test("closing quotes skip the existing pair after string content", () => {
    for (const quote of ['"', "'", "`"])
      expect(handleCharacter(at(`${quote}hello${quote}`, 6), quote)).toEqual({
        value: `${quote}hello${quote}`,
        start: 7,
        end: 7,
      });
  });

  test("line commands exclude the line at the selection's exclusive end", () => {
    expect(handleTab(at("\na", 0, 1), false).value).toBe("\na");
    expect(handleTab(at("a\nb", 0, 2), false)).toEqual({
      value: "    a\nb",
      start: 4,
      end: 6,
      units: [0],
    });
    expect(handleTab(at("    a\n    b", 0, 6), true)).toEqual({
      value: "a\n    b",
      start: 0,
      end: 2,
      units: [],
    });
    expect(toggleComment(at("a\nb", 0, 2), "PYTHON")).toEqual({
      value: "# a\nb",
      start: 2,
      end: 4,
    });
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

// Tab으로 넣은 들여쓰기 한 단계(공백 4칸)를 기억해 Backspace·Delete에서 한 번에 지우는 규칙.
// 공백만으로는 Tab으로 넣은 것과 직접 친 공백을 구분할 수 없어, 편집기가 넣은 위치를 따로 기억한다.
test.describe("tab-unit indentation tracking", () => {
  test("Tab and Shift+Tab report the units they insert (new-value coordinates)", () => {
    const single = handleTab(at("ab", 1), false);
    expect(single.value).toBe(`a${INDENT}b`);
    expect(single.units).toEqual([1]);

    // 여러 줄: 내용이 있는 줄의 앞에만 한 단계가 생기고 빈 줄은 건너뛴다
    const multi = handleTab(at("a\n\nb", 0, 5), false);
    expect(multi.value).toBe(`${INDENT}a\n\n${INDENT}b`);
    // 첫 줄 "    a"(5칸)+줄바꿈+빈 줄+줄바꿈 뒤인 7번째 위치
    expect(multi.units).toEqual([0, 7]);

    // Shift+Tab은 새로 넣는 단위가 없다
    expect(handleTab(at(`${INDENT}a`, 4), true).units).toEqual([]);
    expect(handleTab(at("", 0), false).units).toEqual([0]);
  });

  test("Enter reports the units of the new line: carried tab indentation and the level opened by a bracket", () => {
    // 윗줄이 Tab으로 들여쓴 줄이면 새 줄의 이어받은 들여쓰기도 Tab 단위다
    const tracked = `${INDENT}foo`;
    const carried = handleEnter(at(tracked, tracked.length), "CPP", [0]);
    expect(carried.value).toBe(`${tracked}\n${INDENT}`);
    expect(carried.units).toEqual([tracked.length + 1]);
    // 직접 친 공백(기억에 없음)은 이어받아도 Tab 단위가 아니다
    expect(handleEnter(at(tracked, tracked.length), "CPP", []).units).toEqual(
      [],
    );
    // 블록을 여는 문자 뒤의 한 단계는 Tab 단위다
    expect(handleEnter(at("if (x) {", 8), "CPP").units).toEqual([9]);
    expect(handleEnter(at("def f():", 8), "PYTHON").units).toEqual([9]);
    // 닫는 괄호 사이: 안쪽 줄의 단위와 아랫줄(닫는 괄호 줄)의 이어받은 단위
    const braces = handleEnter(at(`${INDENT}{}`, 5), "JAVA", [0]);
    expect(braces.value).toBe(`${INDENT}{\n${INDENT}${INDENT}\n${INDENT}}`);
    expect(braces.units).toEqual([6, 10, 6 + 4 + 4 + 1]);
  });

  test("Backspace removes a whole remembered unit, but typed spaces are removed one at a time", () => {
    const value = `${INDENT}x`;
    // Tab으로 넣은 한 단계: 한 번에 지운다
    expect(backspaceUnit(at(value, 4), [0])).toEqual(at("x", 0));
    // 같은 글자라도 기억에 없으면(직접 친 공백) 기본 동작(한 글자씩)
    expect(backspaceUnit(at(value, 4), [])).toBeNull();
    // 커서가 단위 끝이 아니면 기본 동작
    for (const caret of [0, 1, 2, 3, 5])
      expect(backspaceUnit(at(value, caret), [0])).toBeNull();
    // 선택 범위가 있으면 기본 동작
    expect(backspaceUnit(at(value, 0, 4), [0])).toBeNull();
    // 단위의 글자가 이미 바뀌었으면 기본 동작
    expect(backspaceUnit(at("  a  x", 4), [0])).toBeNull();
    // 이어진 두 단계: 뒤의 한 단계만 지운다
    const two = `${INDENT}${INDENT}x`;
    expect(backspaceUnit(at(two, 8), [0, 4])).toEqual(at(`${INDENT}x`, 4));
    // 앞의 한 단계만 기억되고 뒤의 4칸은 직접 친 것이면 뒤쪽은 한 글자씩
    expect(backspaceUnit(at(two, 8), [0])).toBeNull();
  });

  test("Delete removes a remembered unit that starts at the caret", () => {
    const value = `${INDENT}x`;
    expect(deleteUnit(at(value, 0), [0])).toEqual(at("x", 0));
    expect(deleteUnit(at(value, 0), [])).toBeNull();
    expect(deleteUnit(at(value, 1), [0])).toBeNull();
    expect(deleteUnit(at(value, 0, 2), [0])).toBeNull();
    expect(deleteUnit(at("", 0), [0])).toBeNull();
  });

  test("remembered units follow edits before and after them and are dropped when edited", () => {
    const base = `a\n${INDENT}b\n${INDENT}c`;
    const units = [2, 2 + 4 + 2];
    expect(remapUnits(units, base, base)).toEqual(units);
    // 앞에서 글자를 넣으면 뒤의 단위가 따라 움직인다
    const typed = `aXY\n${INDENT}b\n${INDENT}c`;
    expect(remapUnits(units, base, typed)).toEqual([4, 10]);
    // 한 줄의 단위 안쪽을 건드리면 그 줄의 단위만 버려지고, 다른 줄의 단위는 그대로 남는다
    const broken = `a\n  Z b\n${INDENT}c`;
    expect(remapUnits(units, base, broken)).toEqual([8]);
    // 여러 줄 들여쓰기: 줄 수가 같으므로 줄마다 따로 비교해 기존 단위가 모두 따라간다
    const indented = base
      .split("\n")
      .map((line) => (line ? INDENT + line : line))
      .join("\n");
    const moved = remapUnits(units, base, indented);
    expect(moved.every((u) => indented.slice(u, u + 4) === INDENT)).toBe(true);
    expect(moved.length).toBe(2);
    // 내어쓰기(Shift+Tab)로 한 단계가 사라지면 그 단위는 버려진다
    expect(remapUnits([0], `${INDENT}a`, "a")).toEqual([]);
    // 줄 수가 바뀌는 편집(Enter)은 뒤쪽 단위만 밀린다
    expect(remapUnits([2], `a\n${INDENT}b`, `a\n\n${INDENT}b`)).toEqual([3]);
  });

  test("a full editing session: Tab, type, Backspace — units stay consistent with the text", () => {
    // 작은 편집기 시뮬레이터: 편집기와 같은 순서(기억 갱신 → 편집 → 새 단위 추가)로 키를 처리한다
    let state = at("", 0);
    let units: number[] = [];
    const apply = (next: {
      value: string;
      start: number;
      end: number;
      units?: number[];
    }) => {
      units = remapUnits(units, state.value, next.value);
      units = addUnits(units, next.units ?? [], next.value);
      state = { value: next.value, start: next.start, end: next.end };
    };
    const type = (text: string) =>
      apply({
        value:
          state.value.slice(0, state.start) +
          text +
          state.value.slice(state.end),
        start: state.start + text.length,
        end: state.start + text.length,
      });
    const tab = () => apply(handleTab(state, false));
    const backspace = () => {
      const unit = backspaceUnit(state, units);
      if (unit) return apply(unit);
      if (state.start === 0) return;
      apply({
        value:
          state.value.slice(0, state.start - 1) + state.value.slice(state.end),
        start: state.start - 1,
        end: state.start - 1,
      });
    };

    tab();
    tab();
    type("x");
    expect(state.value).toBe(`${INDENT}${INDENT}x`);
    backspace(); // x
    backspace(); // 한 단계
    expect(state.value).toBe(INDENT);
    backspace(); // 마지막 한 단계
    expect(state.value).toBe("");

    // 직접 친 공백 4칸은 한 글자씩
    type("    ");
    backspace();
    expect(state.value).toBe("   ");
    // Tab으로 넣은 단위 앞에 글자를 끼워 넣어도 단위는 유지된다
    state = at("", 0);
    units = [];
    tab();
    type("y");
    state = { ...state, start: 0, end: 0 };
    type("Q");
    expect(state.value).toBe(`Q${INDENT}y`);
    state = { ...state, start: 5, end: 5 };
    backspace();
    expect(state.value).toBe("Qy");
  });

  test("extreme values never throw and never keep stale units", () => {
    const junk = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9, 0, 0, 0];
    expect(() => remapUnits(junk, INDENT, `${INDENT}x`)).not.toThrow();
    expect(remapUnits(junk, INDENT, `${INDENT}x`)).toEqual([0]);
    expect(remapUnits([0], "", "")).toEqual([]);
    expect(remapUnits([], "", "abc")).toEqual([]);
    expect(addUnits([], [-5, 1e9, Number.NaN], "abc")).toEqual([]);
    // 줄바꿈이 CRLF·빈 줄뿐인 값, 이모지(서로게이트 쌍), 한글, 아주 긴 값
    for (const value of [
      `\r\n${INDENT}x\r\n`,
      "\n\n\n",
      `😀${INDENT}😀`,
      `한글${INDENT}한글`,
      "\u202e" + INDENT,
    ]) {
      const at0 = value.indexOf(INDENT);
      expect(remapUnits([at0], value, value + "x")).toEqual(
        at0 >= 0 ? [at0] : [],
      );
      // 단위가 있는 값에서만 지워지고, 줄바꿈뿐인 값(음수 위치로 부른 경우)에서는 아무것도 지우지 않는다
      if (at0 >= 0)
        expect(backspaceUnit(at(value, at0 + 4), [at0])).not.toBeNull();
      else expect(backspaceUnit(at(value, 3), [at0])).toBeNull();
    }
    const huge = `${"x".repeat(300_000)}${INDENT}y`;
    expect(remapUnits([300_000], huge, `Z${huge}`)).toEqual([300_001]);
    expect(backspaceUnit(at(huge, 300_004), [300_000])?.value).toBe(
      `${"x".repeat(300_000)}y`,
    );
    // 선택 범위·잘못된 위치
    expect(backspaceUnit(at("abc", 99), [0])).toBeNull();
    expect(deleteUnit(at("abc", -3), [0])).toBeNull();
  });
});

test("remapUnits stays fast and correct with very many lines and units", () => {
  const lines = 20_000;
  const value = Array.from({ length: lines }, () => "    x").join("\n");
  const units = Array.from({ length: lines }, (_, line) => line * 6);
  const edited = "y" + value; // 첫 줄 앞에 글자 하나: 줄 수는 그대로
  const started = performance.now();
  const next = remapUnits(units, value, edited);
  const elapsed = performance.now() - started;
  // 모든 단위가 남고(첫 줄의 공백 네 칸은 "y" 뒤로 한 칸 밀린다) 나머지도 한 글자씩 밀린다
  expect(next.length).toBe(lines);
  expect(next[0]).toBe(1);
  expect(next[1]).toBe(7);
  expect(next.at(-1)).toBe((lines - 1) * 6 + 1);
  expect(elapsed).toBeLessThan(250);
  // 정렬되지 않거나 중복된 입력도 같은 결과
  expect(remapUnits([...units].reverse().concat(units), value, edited)).toEqual(
    next,
  );
});
