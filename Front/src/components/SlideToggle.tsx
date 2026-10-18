import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

export interface ToggleOption {
  value: string;
  label: string;
  /** 라벨 옆에 작게 보이는 개수 */
  count?: number;
}

interface BaseProps {
  options: ToggleOption[];
  /** 지정하면 이미 선택된 옵션을 다시 눌렀을 때 이 값(기본 상태, 보통 '전체')으로 돌아간다. */
  defaultValue?: string;
  ariaLabel: string;
  className?: string;
}

type SlideToggleProps = BaseProps &
  (
    | {
        multiple?: false;
        value: string;
        onChange: (value: string) => void;
      }
    | {
        /**
         * 같은 종류 안에서 ⌘(Mac)/Ctrl(Windows)+클릭으로 여러 개를 고른다.
         * 기본 상태(defaultValue, '전체')는 항상 단독 선택이며 수정자 키를 무시한다.
         * values가 비어 있으면 기본 상태다.
         */
        multiple: true;
        values: string[];
        onChangeValues: (values: string[]) => void;
      }
  );

/** 화면에 그려지는 선택 표시(thumb). 이어진 선택 칸은 하나로 합쳐 그린다. */
interface Thumb {
  id: number;
  x: number;
  w: number;
  leaving: boolean;
}
interface Segment {
  x: number;
  w: number;
}

const overlaps = (a: Segment, b: Segment) =>
  a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
const centerOf = (s: Segment) => s.x + s.w / 2;

let thumbCounter = 0;

/**
 * 가로 슬라이드 토글: 하나의 둥근 트랙 안에서 선택 표시(thumb)가 옵션 사이를 미끄러지듯 이동한다.
 * 다중 선택에서는 선택한 칸마다 thumb이 기존 thumb에서 갈라져 나오듯 생기고,
 * 서로 맞닿으면 하나로 이어지며 합쳐진다.
 * 키보드: 단일 선택은 ←→ 로 옵션을 옮기며 선택하고(라디오 그룹), 다중 선택은 ←→ 로 포커스만 옮긴다.
 */
export function SlideToggle(props: SlideToggleProps) {
  const { options, defaultValue, ariaLabel, className = "" } = props;
  const multiple = props.multiple === true;
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [ready, setReady] = useState(false);
  const thumbsRef = useRef<Thumb[]>([]);
  thumbsRef.current = thumbs;

  const isDefault = (optionValue: string) =>
    defaultValue !== undefined && optionValue === defaultValue;
  const selectedValues: string[] = props.multiple
    ? props.values.length
      ? props.values
      : defaultValue !== undefined
        ? [defaultValue]
        : []
    : [props.value];
  const selectionKey = selectedValues.join("\u0001");
  const isChecked = (optionValue: string) =>
    selectedValues.includes(optionValue);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const buttons = [
      ...root.querySelectorAll<HTMLElement>("[data-toggle-option]"),
    ];
    // 선택된 칸 중 서로 이웃한 것은 하나의 구간(segment)으로 묶는다.
    const segments: Segment[] = [];
    let run: HTMLElement[] = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      segments.push({
        x: first.offsetLeft,
        w: last.offsetLeft + last.offsetWidth - first.offsetLeft,
      });
      run = [];
    };
    for (const button of buttons) {
      if (button.dataset.checked === "true") run.push(button);
      else flush();
    }
    flush();

    setThumbs((previous) => {
      const live = previous.filter((thumb) => !thumb.leaving);
      const used = new Set<number>();
      const assigned: (Thumb | null)[] = segments.map(() => null);
      // 1) 겹치는 기존 thumb을 이어 쓴다(늘어나거나 줄어들며 합쳐지는 모양).
      segments.forEach((segment, index) => {
        const hit = live.find(
          (thumb) => !used.has(thumb.id) && overlaps(thumb, segment),
        );
        if (hit) {
          used.add(hit.id);
          assigned[index] = hit;
        }
      });
      // 2) 남은 thumb은 순서대로 새 위치로 미끄러지듯 옮긴다.
      const spare = live.filter((thumb) => !used.has(thumb.id));
      segments.forEach((_, index) => {
        if (!assigned[index] && spare.length) {
          const thumb = spare.shift()!;
          used.add(thumb.id);
          assigned[index] = thumb;
        }
      });
      const next: Thumb[] = [];
      segments.forEach((segment, index) => {
        const reused = assigned[index];
        if (reused) {
          next.push({ ...reused, x: segment.x, w: segment.w });
          return;
        }
        // 3) 새 thumb: 가장 가까운 기존 thumb의 자리에서 갈라져 나오듯 시작한다.
        const origin = [...live].sort(
          (a, b) =>
            Math.abs(centerOf(a) - centerOf(segment)) -
            Math.abs(centerOf(b) - centerOf(segment)),
        )[0];
        thumbCounter += 1;
        next.push({
          id: thumbCounter,
          x: origin ? origin.x : segment.x,
          w: origin ? origin.w : segment.w,
          leaving: false,
        });
        pendingTargets.current.set(thumbCounter, segment);
      });
      // 4) 쓰이지 않은 기존 thumb은 가장 가까운 새 구간으로 합쳐지며 사라진다.
      const leftover = live.filter((thumb) => !used.has(thumb.id));
      for (const thumb of leftover) {
        const target = [...segments].sort(
          (a, b) =>
            Math.abs(centerOf(a) - centerOf(thumb)) -
            Math.abs(centerOf(b) - centerOf(thumb)),
        )[0];
        next.push({
          ...thumb,
          x: target ? target.x : thumb.x,
          w: target ? target.w : thumb.w,
          leaving: true,
        });
      }
      return next;
    });
  }, []);

  // 새로 생긴 thumb이 시작 위치에서 목표 위치로 움직이도록, 다음 프레임에 목표를 적용한다.
  const pendingTargets = useRef(new Map<number, Segment>());
  useLayoutEffect(() => {
    if (!pendingTargets.current.size) return;
    const frame = requestAnimationFrame(() => {
      const targets = new Map(pendingTargets.current);
      pendingTargets.current.clear();
      setThumbs((previous) =>
        previous.map((thumb) => {
          const target = targets.get(thumb.id);
          return target ? { ...thumb, x: target.x, w: target.w } : thumb;
        }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [thumbs]);

  // 합쳐지며 사라진 thumb은 애니메이션이 끝난 뒤 정리한다.
  useLayoutEffect(() => {
    if (!thumbs.some((thumb) => thumb.leaving)) return;
    const timer = window.setTimeout(
      () => setThumbs((previous) => previous.filter((thumb) => !thumb.leaving)),
      320,
    );
    return () => window.clearTimeout(timer);
  }, [thumbs]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    void document.fonts?.ready.then(measure);
    // 처음 위치는 애니메이션 없이 제자리에 놓는다.
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [
    measure,
    selectionKey,
    options.length,
    options.map((option) => option.count).join(","),
  ]);

  function select(event: MouseEvent<HTMLButtonElement>, option: ToggleOption) {
    if (!props.multiple) {
      const checked = option.value === props.value;
      props.onChange(
        checked && defaultValue !== undefined ? defaultValue : option.value,
      );
      return;
    }
    const { values, onChangeValues } = props;
    // '전체'는 언제나 단독 선택: ⌘/Ctrl이 눌려 있어도 평범한 클릭으로 처리한다.
    if (isDefault(option.value)) {
      onChangeValues([]);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const chosen = new Set(values.filter((value) => !isDefault(value)));
      if (chosen.has(option.value)) chosen.delete(option.value);
      else chosen.add(option.value);
      onChangeValues(
        options
          .map((item) => item.value)
          .filter((value) => chosen.has(value) && !isDefault(value)),
      );
      return;
    }
    // 평범한 클릭은 그 하나만 선택하고, 단독 선택된 항목을 다시 누르면 기본 상태로 돌아간다.
    const only = values.length === 1 && values[0] === option.value;
    onChangeValues(only ? [] : [option.value]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    if (!props.multiple) props.onChange(options[next].value);
    rootRef.current
      ?.querySelectorAll<HTMLElement>("[data-toggle-option]")
      [next]?.focus();
  }

  const firstChecked = options.findIndex((option) => isChecked(option.value));

  return (
    <div
      className={`slide-toggle ${multiple ? "multi" : ""} ${className}`}
      role={multiple ? "group" : "radiogroup"}
      aria-label={ariaLabel}
      ref={rootRef}
    >
      {thumbs.map((thumb) => (
        <span
          key={thumb.id}
          className={`toggle-thumb ${ready ? "ready" : ""} ${thumb.leaving ? "leaving" : ""}`}
          aria-hidden="true"
          style={{
            width: thumb.w,
            transform: `translateX(${thumb.x}px)`,
          }}
        />
      ))}
      {options.map((option, index) => {
        const checked = isChecked(option.value);
        const extra = multiple && !isDefault(option.value);
        return (
          <button
            type="button"
            key={option.value}
            data-toggle-option=""
            data-checked={checked}
            role={multiple ? undefined : "radio"}
            aria-checked={multiple ? undefined : checked}
            aria-pressed={multiple ? checked : undefined}
            title={extra ? "⌘(Ctrl)+클릭: 중복 선택" : undefined}
            tabIndex={
              multiple || checked || (firstChecked === -1 && index === 0)
                ? 0
                : -1
            }
            className={`toggle-option ${checked ? "selected" : ""}`}
            onClick={(event) => select(event, option)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="toggle-count">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
