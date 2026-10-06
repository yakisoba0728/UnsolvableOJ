import { useLayoutEffect, useRef, useState } from "react";

export interface ToggleOption {
  value: string;
  label: string;
  /** 라벨 옆에 작게 보이는 개수 */
  count?: number;
}

interface SlideToggleProps {
  value: string;
  options: ToggleOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * 가로 슬라이드 토글: 하나의 둥근 트랙 안에서 선택 표시(thumb)가 옵션 사이를 미끄러지듯 이동한다.
 * 키보드: ←→ 로 옵션을 옮기며 선택한다(라디오 그룹과 같은 방식).
 */
export function SlideToggle({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: SlideToggleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const active = root.querySelector<HTMLElement>("[aria-checked='true']");
      setThumb(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
    };
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
  }, [value, options.length, options.map((option) => option.count).join(",")]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    rootRef.current
      ?.querySelectorAll<HTMLElement>("[role='radio']")
      [next]?.focus();
  }

  return (
    <div
      className={`slide-toggle ${className}`}
      role="radiogroup"
      aria-label={ariaLabel}
      ref={rootRef}
    >
      <span
        className={`toggle-thumb ${ready ? "ready" : ""}`}
        aria-hidden="true"
        style={{
          width: thumb?.w ?? 0,
          transform: `translateX(${thumb?.x ?? 0}px)`,
          opacity: thumb ? 1 : 0,
        }}
      />
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            type="button"
            key={option.value}
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!thumb && index === 0) ? 0 : -1}
            className={`toggle-option ${checked ? "selected" : ""}`}
            onClick={() => onChange(option.value)}
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
