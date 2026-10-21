/**
 * 풀이 화면의 두 패널(문제 설명 | 코드 작성)을 나누는 가로 크기 규칙. 화면 요소와 분리한 순수 함수라 단위 테스트한다.
 *
 * - `ratio`: 가운데 손잡이를 뺀 폭 가운데 문제 설명 패널이 차지하는 비율(0~1).
 * - 문제 설명 패널이 `MIN_STATEMENT`보다 좁아지면 그 패널은 사라지고 코드 작성만 남는다(`code`).
 * - 코드 작성 패널이 `MIN_CODE`보다 좁아지면 그 패널이 사라지고 문제 설명만 남는다(`statement`).
 * - 사라진 쪽은 손잡이를 다시 끌거나 키보드·버튼으로 되살린다. 되살릴 때 쓸 마지막 비율(`ratio`)은 기억해 둔다.
 */
export const DEFAULT_RATIO = 3 / 8; // 기존 3fr : 5fr
export const HANDLE_WIDTH = 16;
export const MIN_STATEMENT = 260;
export const MIN_CODE = 380;
export const KEY_STEP = 24;

export type SplitMode = "split" | "statement" | "code";

export interface SplitState {
  ratio: number;
  /** 사용자가 닫아 둔 패널: 'statement'면 문제 설명이, 'code'면 코드 작성이 닫혀 있다. */
  collapsed: "none" | "statement" | "code";
}

export const DEFAULT_SPLIT: SplitState = {
  ratio: DEFAULT_RATIO,
  collapsed: "none",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** 저장된 값(손상됐을 수 있는 임의의 문자열)을 안전한 상태로 읽는다. 이상하면 기본값. */
export function parseSplit(raw: string | null): SplitState {
  if (!raw) return DEFAULT_SPLIT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SPLIT;
    const { ratio, collapsed } = parsed as Record<string, unknown>;
    const safeRatio =
      typeof ratio === "number" && Number.isFinite(ratio)
        ? clamp(ratio, 0.05, 0.95)
        : DEFAULT_RATIO;
    return {
      ratio: safeRatio,
      collapsed:
        collapsed === "statement" || collapsed === "code" ? collapsed : "none",
    };
  } catch {
    return DEFAULT_SPLIT;
  }
}

/** 손잡이를 끌던 중 포인터가 패널 영역 왼쪽에서 `x`px 떨어진 곳에 있을 때의 상태. */
export function splitFromPointer(
  x: number,
  total: number,
  previous: SplitState,
): SplitState {
  const available = Math.max(1, total - HANDLE_WIDTH);
  // 손잡이 가운데가 포인터를 따라가도록 손잡이 절반만큼 뺀다
  const statementWidth = x - HANDLE_WIDTH / 2;
  if (!Number.isFinite(statementWidth)) return previous;
  if (statementWidth < MIN_STATEMENT)
    return { ratio: previous.ratio, collapsed: "statement" };
  if (available - statementWidth < MIN_CODE)
    return { ratio: previous.ratio, collapsed: "code" };
  return {
    ratio: clamp(statementWidth / available, 0.05, 0.95),
    collapsed: "none",
  };
}

/**
 * 지금 폭에서 실제로 보이는 모습. 저장된 비율이 지금 화면 폭에는 너무 좁아졌다면(창을 줄인 경우)
 * 억지로 줄이지 않고 좁은 쪽 패널을 숨긴다.
 */
export function resolveSplit(state: SplitState, total: number): SplitMode {
  if (state.collapsed === "statement") return "code";
  if (state.collapsed === "code") return "statement";
  const available = Math.max(1, total - HANDLE_WIDTH);
  const statementWidth = state.ratio * available;
  if (statementWidth < MIN_STATEMENT) return "code";
  if (available - statementWidth < MIN_CODE) return "statement";
  return "split";
}

/** 키보드: 손잡이에 초점이 있을 때. 방향키는 한 칸씩, Home/End는 한쪽만 남기기, Enter는 기본 비율로. */
export function splitFromKey(
  key: string,
  total: number,
  state: SplitState,
): SplitState | null {
  const available = Math.max(1, total - HANDLE_WIDTH);
  const mode = resolveSplit(state, total);
  // 숨겨진 패널을 되살린다: 마지막 비율을 쓰되, 되살린 패널이 최소 폭보다 좁아지지 않게 맞춘다.
  const restoreStatement = (): SplitState => {
    const width = clamp(
      state.ratio * available,
      MIN_STATEMENT,
      Math.max(MIN_STATEMENT, available - MIN_CODE),
    );
    return { ratio: clamp(width / available, 0.05, 0.95), collapsed: "none" };
  };
  const restoreCode = (): SplitState => {
    const codeWidth = clamp(
      (1 - state.ratio) * available,
      MIN_CODE,
      Math.max(MIN_CODE, available - MIN_STATEMENT),
    );
    return {
      ratio: clamp((available - codeWidth) / available, 0.05, 0.95),
      collapsed: "none",
    };
  };
  // 지금 보이는 문제 설명 폭(둘 다 보일 때만 의미가 있다)
  const current = state.ratio * available;
  const move = (delta: number) =>
    splitFromPointer(current + delta + HANDLE_WIDTH / 2, total, state);
  switch (key) {
    case "ArrowLeft":
      // 코드 작성이 숨겨져 있으면 되살리고, 문제 설명이 숨겨져 있으면 더 할 것이 없다
      if (mode === "statement") return restoreCode();
      return mode === "code" ? null : move(-KEY_STEP);
    case "ArrowRight":
      if (mode === "code") return restoreStatement();
      return mode === "statement" ? null : move(KEY_STEP);
    case "Home":
      return { ratio: state.ratio, collapsed: "statement" };
    case "End":
      return { ratio: state.ratio, collapsed: "code" };
    case "Enter":
    case " ":
      return DEFAULT_SPLIT;
    default:
      return null;
  }
}
