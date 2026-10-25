import { useState } from "react";
import { useAllProblems } from "../hooks";
import { problemPath } from "../paths";
import { difficultyLabel } from "../difficulty";
import { MissionBody, type MissionCardData } from "./MissionBody";

/**
 * "XP 두 배 문제!" 카드: 아래 미션 카드와 같은 틀(MissionBody)로 문제 하나를 보여 주고,
 * 그 문제를 풀면 달성으로 바뀐다. 이미 푼 문제는 가능하면 고르지 않는다.
 */
export function XpBoostCard({ solvedIds }: { solvedIds: Set<string> }) {
  const { problems, loading } = useAllProblems();
  // 화면에 머무는 동안 같은 문제가 유지되도록 난수는 한 번만 뽑는다.
  const [roll] = useState(Math.random);
  const unsolved = problems.filter((item) => !solvedIds.has(item.id));
  const pool = unsolved.length ? unsolved : problems;
  // 랜덤 혹은 사용자 맞춤 적용 전, 임시로 랜덤을 지정했습니다
  const problem = pool.length ? pool[Math.floor(roll * pool.length)] : null;

  const mission: MissionCardData = problem
    ? {
        title: "XP 두 배 문제!",
        description: (
          <>
            {problem.title} ·{" "}
            <span
              className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}
            >
              {difficultyLabel(problem.difficulty)}
            </span>
          </>
        ),
        target: 1,
        current: solvedIds.has(problem.id) ? 1 : 0,
        status: solvedIds.has(problem.id) ? "done" : "idle",
        reward: "XP 2배",
        action: { to: problemPath(problem.slug), label: "문제 풀러 가기" },
      }
    : {
        title: "XP 두 배 문제!",
        description: loading
          ? "문제를 고르는 중이에요…"
          : "지금은 고를 수 있는 문제가 없어요.",
        target: 1,
        current: 0,
        status: "idle",
        reward: "XP 2배",
        action: { to: "/problems", label: "문제 목록 보기" },
        cta: "문제 목록 보기",
      };

  return (
    <section
      className={`mission-card xp-boost-card is-${mission.status}`}
      aria-label="XP 두 배 문제"
      aria-busy={loading}
    >
      <MissionBody mission={mission} />
    </section>
  );
}
