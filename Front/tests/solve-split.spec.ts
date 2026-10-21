import { expect, test } from "@playwright/test";
import {
  DEFAULT_RATIO,
  DEFAULT_SPLIT,
  HANDLE_WIDTH,
  KEY_STEP,
  MIN_CODE,
  MIN_STATEMENT,
  parseSplit,
  resolveSplit,
  splitFromKey,
  splitFromPointer,
  type SplitState,
} from "../src/solveSplit";

const TOTAL = 1200;
const AVAILABLE = TOTAL - HANDLE_WIDTH;
const state = (
  ratio: number,
  collapsed: SplitState["collapsed"] = "none",
): SplitState => ({
  ratio,
  collapsed,
});

test.describe("solve page split rules", () => {
  test("dragging inside the allowed range moves the ratio; the handle centre follows the pointer", () => {
    const next = splitFromPointer(500, TOTAL, DEFAULT_SPLIT);
    expect(next.collapsed).toBe("none");
    expect(next.ratio).toBeCloseTo((500 - HANDLE_WIDTH / 2) / AVAILABLE, 6);
    expect(resolveSplit(next, TOTAL)).toBe("split");
  });

  test("the statement panel vanishes below its minimum width and the code panel below its own", () => {
    // 경계: 문제 설명 폭이 정확히 최소면 아직 보인다, 1px 모자라면 사라진다
    const edge = MIN_STATEMENT + HANDLE_WIDTH / 2;
    expect(splitFromPointer(edge, TOTAL, DEFAULT_SPLIT).collapsed).toBe("none");
    expect(splitFromPointer(edge - 1, TOTAL, DEFAULT_SPLIT).collapsed).toBe(
      "statement",
    );
    expect(
      resolveSplit(splitFromPointer(edge - 1, TOTAL, DEFAULT_SPLIT), TOTAL),
    ).toBe("code");

    // 코드 작성 폭이 정확히 최소면 보이고, 모자라면 사라진다
    const codeEdge = AVAILABLE - MIN_CODE + HANDLE_WIDTH / 2;
    expect(splitFromPointer(codeEdge, TOTAL, DEFAULT_SPLIT).collapsed).toBe(
      "none",
    );
    expect(splitFromPointer(codeEdge + 1, TOTAL, DEFAULT_SPLIT).collapsed).toBe(
      "code",
    );
    expect(
      resolveSplit(splitFromPointer(codeEdge + 1, TOTAL, DEFAULT_SPLIT), TOTAL),
    ).toBe("statement");
  });

  test("a hidden panel keeps the last ratio so dragging back restores a sensible size", () => {
    const sized = splitFromPointer(600, TOTAL, DEFAULT_SPLIT);
    const hidden = splitFromPointer(10, TOTAL, sized);
    expect(hidden).toEqual({ ratio: sized.ratio, collapsed: "statement" });
    const back = splitFromPointer(700, TOTAL, hidden);
    expect(back.collapsed).toBe("none");
    expect(resolveSplit(back, TOTAL)).toBe("split");
  });

  test("extreme pointer positions never produce an impossible layout", () => {
    for (const x of [
      -1e9,
      -1,
      0,
      1,
      TOTAL,
      TOTAL + 1,
      1e9,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]) {
      const next = splitFromPointer(x, TOTAL, DEFAULT_SPLIT);
      expect(next.ratio).toBeGreaterThanOrEqual(0.05);
      expect(next.ratio).toBeLessThanOrEqual(0.95);
      expect(["none", "statement", "code"]).toContain(next.collapsed);
    }
    // 숫자가 아닌 값은 이전 상태를 그대로 둔다
    expect(splitFromPointer(Number.NaN, TOTAL, DEFAULT_SPLIT)).toEqual(
      DEFAULT_SPLIT,
    );
    // 전체 폭이 0이거나 음수여도 던지지 않는다
    for (const total of [0, -50, 1, HANDLE_WIDTH, Number.NaN]) {
      expect(() => splitFromPointer(100, total, DEFAULT_SPLIT)).not.toThrow();
      expect(() => resolveSplit(DEFAULT_SPLIT, total)).not.toThrow();
    }
  });

  test("a saved ratio that is too narrow for the current window hides the narrow panel instead of squeezing it", () => {
    // 같은 비율이라도 창이 좁아지면 문제 설명이 최소 폭 아래가 되어 사라진다
    expect(resolveSplit(state(0.3), 1400)).toBe("split");
    expect(resolveSplit(state(0.3), 800)).toBe("code");
    // 코드 작성이 좁아지는 경우
    expect(resolveSplit(state(0.9), 1400)).toBe("statement");
    // 닫아 둔 패널은 폭과 상관없이 닫혀 있다
    expect(resolveSplit(state(0.4, "statement"), 5000)).toBe("code");
    expect(resolveSplit(state(0.4, "code"), 5000)).toBe("statement");
  });

  test("saved values are read defensively", () => {
    expect(parseSplit(null)).toEqual(DEFAULT_SPLIT);
    expect(parseSplit("")).toEqual(DEFAULT_SPLIT);
    for (const bad of [
      "not json",
      "null",
      "[]",
      "42",
      '"text"',
      "{",
      "{}",
      '{"ratio":"a"}',
      '{"ratio":null}',
      "\u0000",
      "x".repeat(100_000),
    ]) {
      const parsed = parseSplit(bad);
      expect(parsed.ratio).toBeGreaterThanOrEqual(0.05);
      expect(parsed.ratio).toBeLessThanOrEqual(0.95);
      expect(parsed.collapsed).toBe("none");
    }
    // 범위를 벗어난 비율은 범위 안으로 맞춘다
    expect(parseSplit('{"ratio":-5}').ratio).toBe(0.05);
    expect(parseSplit('{"ratio":7}').ratio).toBe(0.95);
    // 1e999는 JSON.parse가 Infinity로 읽는다: 유한한 숫자가 아니므로 기본값
    expect(parseSplit('{"ratio":1e999}').ratio).toBe(DEFAULT_RATIO);
    // 올바른 값은 그대로, 알 수 없는 닫힘 값은 none
    expect(parseSplit('{"ratio":0.5,"collapsed":"code"}')).toEqual(
      state(0.5, "code"),
    );
    expect(parseSplit('{"ratio":0.5,"collapsed":"both"}')).toEqual(
      state(0.5, "none"),
    );
    expect(parseSplit('{"ratio":0.5,"collapsed":{"a":1}}')).toEqual(
      state(0.5, "none"),
    );
  });

  test("keyboard: arrows step, Home/End leave one panel, arrows bring a hidden panel back, Enter resets", () => {
    const start = state(0.4);
    const left = splitFromKey("ArrowLeft", TOTAL, start)!;
    const right = splitFromKey("ArrowRight", TOTAL, start)!;
    expect(left.ratio).toBeCloseTo(0.4 - KEY_STEP / AVAILABLE, 6);
    expect(right.ratio).toBeCloseTo(0.4 + KEY_STEP / AVAILABLE, 6);

    const codeOnly = splitFromKey("Home", TOTAL, start)!;
    expect(resolveSplit(codeOnly, TOTAL)).toBe("code");
    const statementOnly = splitFromKey("End", TOTAL, start)!;
    expect(resolveSplit(statementOnly, TOTAL)).toBe("statement");

    // 숨겨진 패널은 방향키로 마지막 비율로 되살아난다(너무 좁게 되살아나지 않는다)
    const restoredStatement = splitFromKey("ArrowRight", TOTAL, codeOnly)!;
    expect(resolveSplit(restoredStatement, TOTAL)).toBe("split");
    expect(restoredStatement.ratio * AVAILABLE).toBeGreaterThanOrEqual(
      MIN_STATEMENT,
    );
    const restoredCode = splitFromKey("ArrowLeft", TOTAL, statementOnly)!;
    expect(resolveSplit(restoredCode, TOTAL)).toBe("split");
    expect((1 - restoredCode.ratio) * AVAILABLE).toBeGreaterThanOrEqual(
      MIN_CODE,
    );
    // 숨겨진 쪽에서 반대 방향 키는 할 일이 없다
    expect(splitFromKey("ArrowLeft", TOTAL, codeOnly)).toBeNull();
    expect(splitFromKey("ArrowRight", TOTAL, statementOnly)).toBeNull();

    // Enter·Space는 기본 비율, 상관없는 키는 null
    expect(splitFromKey("Enter", TOTAL, codeOnly)).toEqual(DEFAULT_SPLIT);
    expect(splitFromKey(" ", TOTAL, statementOnly)).toEqual(DEFAULT_SPLIT);
    for (const key of ["a", "Tab", "Escape", "", "ArrowUp", "Shift"])
      expect(splitFromKey(key, TOTAL, start)).toBeNull();
  });

  test("repeated arrow presses always end in a valid, reversible state", () => {
    let current = state(DEFAULT_RATIO);
    for (let press = 0; press < 400; press += 1) {
      const next = splitFromKey("ArrowLeft", TOTAL, current);
      if (next) current = next;
      expect(current.ratio).toBeGreaterThanOrEqual(0.05);
      expect(current.ratio).toBeLessThanOrEqual(0.95);
    }
    expect(resolveSplit(current, TOTAL)).toBe("code");
    // 되돌리기: 오른쪽 키 한 번으로 문제 설명이 다시 나타난다
    current = splitFromKey("ArrowRight", TOTAL, current)!;
    expect(resolveSplit(current, TOTAL)).toBe("split");
    for (let press = 0; press < 400; press += 1) {
      const next = splitFromKey("ArrowRight", TOTAL, current);
      if (next) current = next;
    }
    expect(resolveSplit(current, TOTAL)).toBe("statement");
    current = splitFromKey("ArrowLeft", TOTAL, current)!;
    expect(resolveSplit(current, TOTAL)).toBe("split");
  });
});
