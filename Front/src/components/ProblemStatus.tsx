export type SolveState = "solved" | "attempted" | "none";

const labels: Record<SolveState, string> = {
  solved: "해결",
  attempted: "풀이 중",
  none: "미해결",
};

export function solveState(
  id: string,
  solved: Set<string>,
  attempted: Set<string>,
): SolveState {
  return solved.has(id) ? "solved" : attempted.has(id) ? "attempted" : "none";
}

/** 색만이 아니라 문구로도 상태를 구분한다(해결에는 ✓도 붙는다). */
export function ProblemStatus({ state }: { state: SolveState }) {
  return (
    <span className={`solve-badge solve-${state}`}>
      {state === "solved" ? <span aria-hidden="true">✓ </span> : null}
      {labels[state]}
    </span>
  );
}
