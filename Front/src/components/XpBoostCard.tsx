import { useAllProblems } from "../hooks";
import { problemPath } from "../paths";
import { difficultyLabel } from "../difficulty";
import { seededShuffle } from "../shuffle";
import { MissionBody, type MissionCardData } from "./MissionBody";

const seedOf = (text: string) =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 0);

/**
 * "XP 두 배 문제!" 카드: 아래 미션 카드와 같은 틀(MissionBody)로 문제 하나를 보여 주고,
 * 그 문제를 풀면 달성으로 바뀐다. 어제까지 푼 문제는 가능하면 고르지 않는다.
 * 하루 동안은 같은 문제를 보여 준다: 오늘 풀어도 다른 문제로 바뀌지 않아야 달성이 보인다.
 */
export function XpBoostCard({
  solvedIds,
  solvedBeforeToday,
  day,
  userId,
}: {
  solvedIds: Set<string>;
  solvedBeforeToday: Set<string>;
  day: string;
  userId: string;
}) {
  const { problems, loading } = useAllProblems();
  const unsolved = problems.filter((item) => !solvedBeforeToday.has(item.id));
  const pool = unsolved.length ? unsolved : problems;
  const problem = seededShuffle(pool, seedOf(`${day}:${userId}`))[0] ?? null;

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
