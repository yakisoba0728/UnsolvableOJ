import { expect, test } from "@playwright/test";
import { pageRange, pageRangeTitle } from "../src/pageRange";

test.describe("page range label", () => {
  test("shows the first and last item of this page over the total", () => {
    expect(pageRange(0, 10, 16)).toBe("1 - 10/16");
    expect(pageRange(10, 6, 16)).toBe("11 - 16/16");
    expect(pageRange(0, 1, 1)).toBe("1 - 1/1");
    expect(pageRange(20, 20, 9744)).toBe("21 - 40/9744");
  });

  test("an empty list reads 0/0", () => {
    expect(pageRange(0, 0, 0)).toBe("0/0");
    expect(pageRange(0, 0, 5)).toBe("0/0");
    expect(pageRange(0, 3, 0)).toBe("0/0");
  });

  test("impossible or broken numbers never produce a nonsense range", () => {
    for (const bad of [
      [-1, 5, 10],
      [0, -5, 10],
      [0, 5, -10],
      [Number.NaN, 5, 10],
      [0, Number.NaN, 10],
      [0, 5, Number.NaN],
      [0, 5, Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, 5, 10],
    ])
      expect(pageRange(bad[0], bad[1], bad[2])).toBe("0/0");
    // 이 페이지 끝이 총 개수를 넘을 수 없다
    expect(pageRange(0, 12, 10)).toBe("1 - 10/10");
    // 소수는 내림
    expect(pageRange(0.9, 2.9, 5.9)).toBe("1 - 2/5");
    // 아주 큰 수도 그대로
    expect(pageRange(0, 20, 1e9)).toBe("1 - 20/1000000000");
  });

  test("the spoken title says the same thing in words", () => {
    expect(pageRangeTitle(0, 10, 16)).toBe("전체 16개 중 1번부터 10번째까지");
    expect(pageRangeTitle(10, 6, 16)).toBe("전체 16개 중 11번부터 16번째까지");
    expect(pageRangeTitle(0, 0, 0)).toBe("표시할 항목이 없어요");
  });
});
