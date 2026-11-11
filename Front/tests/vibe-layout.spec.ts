import { expect, test } from "@playwright/test";
import {
  DEFAULT_COLUMNS,
  DEFAULT_DOCK_STATE,
  HANDLE,
  KEY_STEP,
  MIN_CENTER,
  MIN_DOCK,
  MIN_EDITOR,
  MIN_LEFT,
  MIN_RIGHT,
  SNAP,
  columnsFromKey,
  columnsFromLeftPointer,
  columnsFromRightPointer,
  dockFromKey,
  dockFromPointer,
  visibleWidths,
} from "../src/vibeLayout";

const TOTAL = 1400;

test("dragging the left handle follows the pointer, stops at the minimum and folds past the snap distance", () => {
  const dragged = columnsFromLeftPointer(400 + HANDLE / 2, TOTAL, DEFAULT_COLUMNS);
  expect(dragged.left).toBe(400);
  expect(dragged.leftHidden).toBe(false);
  // 최소 폭 아래로 조금 더 끌어도 최소 폭에서 멈춘다
  const stuck = columnsFromLeftPointer(MIN_LEFT - SNAP + 1 + HANDLE / 2, TOTAL, DEFAULT_COLUMNS);
  expect(stuck.left).toBe(MIN_LEFT);
  expect(stuck.leftHidden).toBe(false);
  // 여유 거리를 넘으면 접힌다
  const folded = columnsFromLeftPointer(MIN_LEFT - SNAP - 1 + HANDLE / 2, TOTAL, DEFAULT_COLUMNS);
  expect(folded.leftHidden).toBe(true);
  // 접힌 뒤 다시 끌면 펴진다
  expect(columnsFromLeftPointer(300, TOTAL, folded).leftHidden).toBe(false);
});

test("the code column never gets narrower than its minimum while dragging either handle", () => {
  const wide = columnsFromLeftPointer(TOTAL, TOTAL, DEFAULT_COLUMNS);
  expect(TOTAL - 2 * HANDLE - wide.left - DEFAULT_COLUMNS.right).toBeGreaterThanOrEqual(MIN_CENTER);
  const right = columnsFromRightPointer(0, TOTAL, DEFAULT_COLUMNS);
  expect(TOTAL - 2 * HANDLE - DEFAULT_COLUMNS.left - right.right).toBeGreaterThanOrEqual(MIN_CENTER);
  expect(columnsFromRightPointer(TOTAL, TOTAL, DEFAULT_COLUMNS).rightHidden).toBe(true);
  expect(MIN_RIGHT).toBeGreaterThan(0);
});

test("keys step, fold, unfold and reset each side independently", () => {
  const left = columnsFromKey("left", "ArrowRight", TOTAL, DEFAULT_COLUMNS)!;
  expect(left.left).toBe(DEFAULT_COLUMNS.left + KEY_STEP);
  expect(columnsFromKey("right", "ArrowLeft", TOTAL, DEFAULT_COLUMNS)!.right).toBe(
    DEFAULT_COLUMNS.right + KEY_STEP,
  );
  const hidden = columnsFromKey("left", "Home", TOTAL, DEFAULT_COLUMNS)!;
  expect(hidden.leftHidden).toBe(true);
  expect(columnsFromKey("left", "ArrowLeft", TOTAL, hidden)).toBeNull();
  expect(columnsFromKey("left", "ArrowRight", TOTAL, hidden)!.leftHidden).toBe(false);
  expect(columnsFromKey("left", "End", TOTAL, hidden)!.leftHidden).toBe(false);
  expect(columnsFromKey("right", "Enter", TOTAL, { ...DEFAULT_COLUMNS, right: 500 })).toEqual(
    DEFAULT_COLUMNS,
  );
  expect(columnsFromKey("left", "a", TOTAL, DEFAULT_COLUMNS)).toBeNull();
  // 최소 폭에서 한 번 더 줄이면 접힌다
  const atMin = { ...DEFAULT_COLUMNS, left: MIN_LEFT };
  expect(columnsFromKey("left", "ArrowLeft", TOTAL, atMin)!.leftHidden).toBe(true);
});

test("a slightly narrow window shrinks the side panels before folding any", () => {
  const grid = 1053; // 1101px 화면의 작업 영역
  const shrunk = visibleWidths(DEFAULT_COLUMNS, grid);
  expect(shrunk.right).toBeGreaterThanOrEqual(MIN_RIGHT);
  expect(shrunk.right).toBeLessThan(DEFAULT_COLUMNS.right);
  expect(shrunk.left).toBe(DEFAULT_COLUMNS.left);
  expect(shrunk.center).toBeGreaterThanOrEqual(MIN_CENTER);
});

test("a narrow window folds the partner first so the code column keeps its minimum", () => {
  const roomy = visibleWidths(DEFAULT_COLUMNS, 1400);
  expect(roomy.left).toBe(DEFAULT_COLUMNS.left);
  expect(roomy.right).toBe(DEFAULT_COLUMNS.right);
  const tight = visibleWidths(DEFAULT_COLUMNS, 900);
  expect(tight.right).toBe(0);
  expect(tight.center).toBeGreaterThanOrEqual(MIN_CENTER);
});

test("the bottom dock follows the pointer, folds to its bar and returns with keys", () => {
  const total = 700;
  const dragged = dockFromPointer(total - 300 - HANDLE / 2, total, DEFAULT_DOCK_STATE);
  expect(dragged).toEqual({ height: 300, collapsed: false });
  expect(dockFromPointer(total - (MIN_DOCK - SNAP - 1) - HANDLE / 2, total, DEFAULT_DOCK_STATE).collapsed).toBe(true);
  // 편집기도 최소 높이를 지킨다
  expect(dockFromPointer(0, total, DEFAULT_DOCK_STATE).height).toBe(total - HANDLE - MIN_EDITOR);
  expect(dockFromKey("ArrowUp", total, DEFAULT_DOCK_STATE)!.height).toBe(
    DEFAULT_DOCK_STATE.height + KEY_STEP,
  );
  const folded = dockFromKey("Home", total, DEFAULT_DOCK_STATE)!;
  expect(folded.collapsed).toBe(true);
  expect(dockFromKey("ArrowDown", total, folded)).toBeNull();
  expect(dockFromKey("ArrowUp", total, folded)!.collapsed).toBe(false);
  expect(dockFromKey("Enter", total, folded)).toEqual(DEFAULT_DOCK_STATE);
});
