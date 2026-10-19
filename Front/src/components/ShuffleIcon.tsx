import { useEffect, useRef } from "react";

/**
 * 섞기(셔플) 아이콘. playKey가 바뀔 때마다 두 화살표가 각자의 곡선을 따라
 * 서로 교차하며 오른쪽으로 빠져나가고, 왼쪽에서 같은 길을 따라 다시 들어온다.
 * 평소에는 정지한 아이콘 모양 그대로 보인다.
 */

// 각 화살표의 중심선. 가운데(x 3~21)는 원래 아이콘의 곡선이고, 앞뒤로 같은 교차 곡선을 이어 붙여
// 화살표가 이동하는 내내 직선으로 가지 않고 서로 엇갈리며(얽히며) 지나가게 한다.
const LEAD_A = "M-40 7H-29C-22 7 -22 17 -15 17H-11C-4 17 -4 7 3 7";
const BODY_A = "h3.2c1.6 0 3 .8 3.9 2.1l2.8 3.8c.9 1.3 2.3 2.1 3.9 2.1H21";
const TAIL_A = "C28 14 28 7 35 7H39C46 7 46 14 53 14H70";
const LEAD_B = "M-40 17H-29C-22 17 -22 7 -15 7H-11C-4 7 -4 17 3 17";
const BODY_B = "h3.2c1.6 0 3-.8 3.9-2.1L14 8.2c.8-.7 1.8-1.2 2.9-1.2H21";
const TAIL_B = "C28 7 28 14 35 14H39C46 14 46 7 53 7H70";
const PATH_A = LEAD_A + BODY_A + TAIL_A;
const PATH_B = LEAD_B + BODY_B + TAIL_B;
const REST_A =
  "M3 7h3.2c1.6 0 3 .8 3.9 2.1l2.8 3.8c.9 1.3 2.3 2.1 3.9 2.1H21M18.5 11 21 14l-2.5 3";
const REST_B =
  "M3 17h3.2c1.6 0 3-.8 3.9-2.1M14 8.2c.8-.7 1.8-1.2 2.9-1.2H21M18.5 4 21 7l-2.5 3";
const SVG_NS = "http://www.w3.org/2000/svg";
const line_svg = (el: SVGPathElement) => el.ownerSVGElement as SVGSVGElement;
const HEAD = "M-2.5 -3 0 0l-2.5 3";

const DURATION = 820;
const OUT_SHARE = 0.42; // 빠져나가는 구간의 비율
const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface Track {
  line: SVGPathElement;
  head: SVGPathElement;
  total: number;
  start: number; // 정지 상태에서 화살표 꼬리 위치(길 위의 거리)
  end: number; // 정지 상태에서 화살표 머리 위치
}

function place(track: Track, tail: number) {
  const length = track.end - track.start;
  track.line.setAttribute("stroke-dasharray", `${length} ${track.total * 2}`);
  track.line.setAttribute("stroke-dashoffset", String(-tail));
  const tip = Math.min(Math.max(tail + length, 0), track.total);
  const point = track.line.getPointAtLength(tip);
  const before = track.line.getPointAtLength(Math.max(tip - 0.5, 0));
  const after = track.line.getPointAtLength(Math.min(tip + 0.5, track.total));
  const angle =
    (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
  track.head.setAttribute(
    "transform",
    `translate(${point.x} ${point.y}) rotate(${angle})`,
  );
}

export function ShuffleIcon({ playKey }: { playKey: number }) {
  const restRef = useRef<SVGGElement>(null);
  const animRef = useRef<SVGGElement>(null);
  const lineA = useRef<SVGPathElement>(null);
  const lineB = useRef<SVGPathElement>(null);
  const headA = useRef<SVGPathElement>(null);
  const headB = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!playKey) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rest = restRef.current;
    const anim = animRef.current;
    if (!rest || !anim || !lineA.current || !lineB.current) return;
    if (!headA.current || !headB.current) return;

    // 길 위의 거리를 재기 위해 눈에 보이지 않는 임시 경로를 쓴다.
    const svg = line_svg(lineA.current);
    const measure = (d: string) => {
      const probe = document.createElementNS(SVG_NS, "path");
      probe.setAttribute("d", d);
      svg.appendChild(probe);
      const length = probe.getTotalLength();
      svg.removeChild(probe);
      return length;
    };
    const make = (
      line: SVGPathElement,
      head: SVGPathElement,
      lead: string,
      body: string,
    ): Track => ({
      line,
      head,
      total: line.getTotalLength(),
      start: measure(lead),
      end: measure(lead + body),
    });
    const tracks = [
      make(lineA.current, headA.current, LEAD_A, BODY_A),
      make(lineB.current, headB.current, LEAD_B, BODY_B),
    ];

    rest.style.opacity = "0";
    anim.style.opacity = "1";
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / DURATION, 1);
      for (const track of tracks) {
        const length = track.end - track.start;
        let tail: number;
        if (progress < OUT_SHARE) {
          // 길을 따라 앞으로 나아가 오른쪽 끝으로 사라진다.
          const t = easeIn(progress / OUT_SHARE);
          tail = track.start + t * (track.total - track.start);
        } else {
          // 왼쪽 끝에서 같은 길을 따라 들어와 제자리에 멈춘다.
          const t = easeOut((progress - OUT_SHARE) / (1 - OUT_SHARE));
          tail = -length + t * (track.start + length);
        }
        place(track, tail);
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        rest.style.opacity = "1";
        anim.style.opacity = "0";
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      rest.style.opacity = "1";
      anim.style.opacity = "0";
    };
  }, [playKey]);

  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      className="shuffle-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <g ref={restRef} {...stroke}>
        <path d={REST_A} />
        <path d={REST_B} />
      </g>
      <g ref={animRef} style={{ opacity: 0 }} {...stroke}>
        <path ref={lineA} d={PATH_A} strokeDasharray="0 9999" />
        <path ref={lineB} d={PATH_B} strokeDasharray="0 9999" />
        <path ref={headA} d={HEAD} />
        <path ref={headB} d={HEAD} />
      </g>
    </svg>
  );
}
