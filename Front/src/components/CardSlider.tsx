import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface CardSliderProps {
  title: string;
  description: string;
  /** 스크린리더용 슬라이더 이름 */
  label: string;
  /** 카드 수. 바뀌면 양 끝 흐림 표시를 다시 계산한다. */
  count: number;
  children: ReactNode;
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 가로 슬라이드. 컨테이너 안에서만 보이고, 스크롤된 쪽 가장자리는 블러와 함께 흐려지다가 경계에서 완전히 사라진다.
 * 화살표 · 마우스 휠 · 터치 스와이프 · 키보드(←/→)로 이동하며, 끝에 닿으면 휠이 페이지 스크롤로 넘어간다.
 */
export function CardSlider({ title, description, label, count, children }: CardSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });

    // 세로 휠을 가로 이동으로 바꾼다. 더 갈 곳이 없으면(양 끝) 페이지 스크롤에 맡긴다.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      const movable =
        (event.deltaY > 0 && el.scrollLeft < max - 1) ||
        (event.deltaY < 0 && el.scrollLeft > 1);
      if (!movable) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
    };
  }, [update, count]);

  function move(direction: 1 | -1) {
    const el = track.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  const scrollable = !(edge.start && edge.end);

  return (
    <section className="home-section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="slider-arrows" aria-hidden={!scrollable}>
          <button
            type="button"
            className="arrow-button"
            aria-label="이전 문제"
            aria-disabled={edge.start}
            disabled={edge.start}
            onClick={() => move(-1)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="arrow-button"
            aria-label="다음 문제"
            aria-disabled={edge.end}
            disabled={edge.end}
            onClick={() => move(1)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="m9.5 5.5 6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div
        className={`slider-area ${edge.start ? "" : "can-back"} ${edge.end ? "" : "can-forward"}`}
      >
        <div
          className="slider-track"
          ref={track}
          role="region"
          aria-label={label}
          tabIndex={0}
        >
          {children}
        </div>
        <div className={`slider-fade left ${edge.start ? "hidden" : ""}`} aria-hidden="true" />
        <div className={`slider-fade right ${edge.end ? "hidden" : ""}`} aria-hidden="true" />
      </div>
    </section>
  );
}
