import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_SPLIT,
  HANDLE_WIDTH,
  resolveSplit,
  splitFromKey,
  splitFromPointer,
  type SplitMode,
  type SplitState,
} from "./solveSplit";

/**
 * 지금 화면 폭에서 실제로 보이는 모습(둘 다 / 문제 설명만 / 코드 작성만)과 그에 맞는 열 크기.
 * 열 크기는 CSS 변수로 넘기고, 1100px 이하의 위아래 쌓이는 배치에서는 CSS가 이 값을 무시한다.
 */
export function splitLayout(split: SplitState, gridWidth: number) {
  const mode: SplitMode =
    gridWidth > 0
      ? resolveSplit(split, gridWidth)
      : split.collapsed === "statement"
        ? "code"
        : split.collapsed === "code"
          ? "statement"
          : "split";
  if (mode === "code")
    return { mode, columns: `0px ${HANDLE_WIDTH}px minmax(0, 1fr)`, percent: 0 };
  if (mode === "statement")
    return {
      mode,
      columns: `minmax(0, 1fr) ${HANDLE_WIDTH}px 0px`,
      percent: 100,
    };
  return {
    mode,
    columns: `minmax(0, ${Math.round(split.ratio * 1000)}fr) ${HANDLE_WIDTH}px minmax(0, ${Math.round((1 - split.ratio) * 1000)}fr)`,
    percent: Math.round(split.ratio * 100),
  };
}

/**
 * 문제 설명과 코드 작성 사이의 폭 조절(끌기·방향키·더블클릭으로 원래대로).
 * 폭은 저장하지 않는다: 문제를 열 때마다 기본 비율로 시작한다.
 * gridRef의 요소는 problemKey가 생긴 뒤에 그려지므로, 그 값이 바뀔 때마다 다시 지켜본다.
 */
export function useSolveSplit(problemKey: string | null | undefined) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<SplitState>(DEFAULT_SPLIT);
  const splitRef = useRef(split);
  const [gridWidth, setGridWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 끌던 중 손잡이가 사라져도(다른 문제로 이동 등) 끌기 상태가 남지 않게 정리하는 함수
  const endDragRef = useRef<(() => void) | null>(null);

  // 두 패널을 담은 영역의 폭을 지켜봐서, 창이 줄어 한쪽이 너무 좁아지면 그 패널을 숨긴다.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => setGridWidth(grid.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [problemKey]);

  // 다른 문제로 옮겨 가면 폭을 기본으로 되돌리고, 끌던 중이었다면 끌기를 끝낸다.
  useEffect(() => {
    endDragRef.current?.();
    splitRef.current = DEFAULT_SPLIT;
    setSplit(DEFAULT_SPLIT);
    return () => endDragRef.current?.();
  }, [problemKey]);

  function apply(next: SplitState) {
    splitRef.current = next;
    setSplit(next);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const grid = gridRef.current;
    // 보조 버튼과 두 번째 손가락의 입력은 무시한다
    if (!grid || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    // 어떤 이유로 끝나지 못한 이전 끌기가 있으면 정리하고 새로 시작한다(이후 끌기가 막히지 않게)
    endDragRef.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    // 끌기를 시작해도 키보드로 이어서 조절할 수 있게 손잡이가 초점을 받는다
    handle.focus({ preventScroll: true });
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rect = grid.getBoundingClientRect();
      apply(
        splitFromPointer(
          moveEvent.clientX - rect.left,
          rect.width,
          splitRef.current,
        ),
      );
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      endDragRef.current = null;
      setDragging(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    endDragRef.current = end;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = splitFromKey(event.key, gridWidth || 1, splitRef.current);
    if (!next) return;
    event.preventDefault();
    apply(next);
  }

  return {
    gridRef,
    dragging,
    ...splitLayout(split, gridWidth),
    startDrag,
    onKeyDown,
    reset: () => apply(DEFAULT_SPLIT),
  };
}
