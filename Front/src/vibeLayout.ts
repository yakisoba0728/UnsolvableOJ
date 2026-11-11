/**
 * 바이브코딩 작업 공간의 크기 규칙: [해야 할 일 | 코드 작성 | 코딩 파트너] 세 열과, 코드 작성 안의 [편집기 / 실행·회고] 두 칸.
 * 풀이 화면(solveSplit.ts)과 같은 약속을 따른다. 화면 요소와 분리한 순수 함수라 단위 테스트한다.
 *
 * - 열은 손잡이를 끌어 조절한다. 최소 폭보다 `SNAP`만큼 더 줄이면 그 패널은 접히고, 손잡이를 다시 끌거나 키보드로 펼 수 있다.
 * - 코드 작성 열은 접히지 않는다(`MIN_CENTER`보다 좁아지지 않게 양옆이 먼저 멈춘다).
 * - 더블클릭·Enter·Space는 기본 크기로 되돌린다. 크기는 저장하지 않는다(풀이 화면과 같다): 화면을 열 때마다 기본값으로 시작한다.
 * - 키보드: ←→(↑↓)는 `KEY_STEP`씩, Home은 접기, End는 펴기.
 */
export const HANDLE = 16;
export const MIN_LEFT = 200;
export const MIN_RIGHT = 280;
export const MIN_CENTER = 420;
export const DEFAULT_LEFT = 260;
export const DEFAULT_RIGHT = 360;
export const MIN_DOCK = 140;
export const MIN_EDITOR = 160;
export const DEFAULT_DOCK = 240;
/** 접힌 하단 칸이 차지하는 높이: 탭 이름줄만 남는다. */
export const DOCK_COLLAPSED = 48;
export const KEY_STEP = 24;
export const SNAP = 72;

export interface ColumnState {
  left: number;
  right: number;
  leftHidden: boolean;
  rightHidden: boolean;
}
export interface DockState {
  height: number;
  collapsed: boolean;
}

export const DEFAULT_COLUMNS: ColumnState = {
  left: DEFAULT_LEFT,
  right: DEFAULT_RIGHT,
  leftHidden: false,
  rightHidden: false,
};
export const DEFAULT_DOCK_STATE: DockState = {
  height: DEFAULT_DOCK,
  collapsed: false,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * 지금 보이는 양옆 패널의 폭(접힌 쪽은 0). 화면이 좁아 가운데가 `MIN_CENTER`에 못 미치면
 * 오른쪽(파트너)을 최소 폭까지, 그다음 왼쪽을 최소 폭까지 줄이고, 그래도 모자라면 오른쪽부터 접는다.
 */
export function visibleWidths(state: ColumnState, total: number) {
  let left = state.leftHidden ? 0 : state.left;
  let right = state.rightHidden ? 0 : state.right;
  const room = total - 2 * HANDLE - MIN_CENTER;
  let over = left + right - room;
  if (over > 0 && right > 0) {
    const cut = Math.min(over, Math.max(0, right - MIN_RIGHT));
    right -= cut;
    over -= cut;
  }
  if (over > 0 && left > 0) {
    const cut = Math.min(over, Math.max(0, left - MIN_LEFT));
    left -= cut;
    over -= cut;
  }
  if (over > 0 && right > 0) {
    right = 0;
    over = left - room;
  }
  if (over > 0) left = 0;
  return { left, right, center: total - 2 * HANDLE - left - right };
}

/** 왼쪽 손잡이를 끌다가 포인터가 열 영역 왼쪽에서 `x`px에 있을 때. */
export function columnsFromLeftPointer(
  x: number,
  total: number,
  previous: ColumnState,
  snap: number = SNAP,
): ColumnState {
  const width = x - HANDLE / 2;
  if (!Number.isFinite(width)) return previous;
  if (width < MIN_LEFT - snap) return { ...previous, leftHidden: true };
  const right = previous.rightHidden ? 0 : previous.right;
  const max = Math.max(MIN_LEFT, total - 2 * HANDLE - MIN_CENTER - right);
  return { ...previous, left: clamp(width, MIN_LEFT, max), leftHidden: false };
}

/** 오른쪽 손잡이를 끌다가 포인터가 열 영역 왼쪽에서 `x`px에 있을 때. */
export function columnsFromRightPointer(
  x: number,
  total: number,
  previous: ColumnState,
  snap: number = SNAP,
): ColumnState {
  const width = total - x - HANDLE / 2;
  if (!Number.isFinite(width)) return previous;
  if (width < MIN_RIGHT - snap) return { ...previous, rightHidden: true };
  const left = previous.leftHidden ? 0 : previous.left;
  const max = Math.max(MIN_RIGHT, total - 2 * HANDLE - MIN_CENTER - left);
  return {
    ...previous,
    right: clamp(width, MIN_RIGHT, max),
    rightHidden: false,
  };
}

export type Side = "left" | "right";

/** 키보드: 손잡이에 초점이 있을 때. 반환값이 null이면 키를 처리하지 않는다. */
export function columnsFromKey(
  side: Side,
  key: string,
  total: number,
  state: ColumnState,
): ColumnState | null {
  const hiddenKey = side === "left" ? "leftHidden" : "rightHidden";
  const min = side === "left" ? MIN_LEFT : MIN_RIGHT;
  const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
  const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
  const other =
    side === "left"
      ? state.rightHidden
        ? 0
        : state.right
      : state.leftHidden
        ? 0
        : state.left;
  const max = Math.max(min, total - 2 * HANDLE - MIN_CENTER - other);
  const current = state[side];
  const hidden = state[hiddenKey];
  switch (key) {
    case "Home":
      return { ...state, [hiddenKey]: true };
    case "End":
      return { ...state, [side]: clamp(current, min, max), [hiddenKey]: false };
    case "Enter":
    case " ":
      return {
        ...state,
        [side]: side === "left" ? DEFAULT_LEFT : DEFAULT_RIGHT,
        [hiddenKey]: false,
      };
    case grow:
      if (hidden)
        return { ...state, [side]: clamp(current, min, max), [hiddenKey]: false };
      return { ...state, [side]: clamp(current + KEY_STEP, min, max) };
    case shrink:
      if (hidden) return null;
      return current - KEY_STEP < min - 0.5
        ? { ...state, [hiddenKey]: true }
        : { ...state, [side]: current - KEY_STEP };
    default:
      return null;
  }
}

/** 하단 칸(실행·회고) 높이: 포인터가 코드 작성 영역 위에서 `y`px에 있을 때. */
export function dockFromPointer(
  y: number,
  total: number,
  previous: DockState,
  snap: number = SNAP,
): DockState {
  const height = total - y - HANDLE / 2;
  if (!Number.isFinite(height)) return previous;
  if (height < MIN_DOCK - snap) return { ...previous, collapsed: true };
  const max = Math.max(MIN_DOCK, total - HANDLE - MIN_EDITOR);
  return { height: clamp(height, MIN_DOCK, max), collapsed: false };
}

export function dockFromKey(
  key: string,
  total: number,
  state: DockState,
): DockState | null {
  const max = Math.max(MIN_DOCK, total - HANDLE - MIN_EDITOR);
  switch (key) {
    case "Home":
      return { ...state, collapsed: true };
    case "End":
      return { height: clamp(state.height, MIN_DOCK, max), collapsed: false };
    case "Enter":
    case " ":
      return DEFAULT_DOCK_STATE;
    case "ArrowUp":
      return {
        height: clamp(
          state.collapsed ? state.height : state.height + KEY_STEP,
          MIN_DOCK,
          max,
        ),
        collapsed: false,
      };
    case "ArrowDown":
      if (state.collapsed) return null;
      return state.height - KEY_STEP < MIN_DOCK - 0.5
        ? { ...state, collapsed: true }
        : { ...state, height: state.height - KEY_STEP };
    default:
      return null;
  }
}

/** 접근성 값(0~100): 손잡이가 가리키는 패널이 전체에서 차지하는 비율. */
export const percentOf = (size: number, total: number) =>
  Math.round(clamp((size / Math.max(1, total)) * 100, 0, 100));
