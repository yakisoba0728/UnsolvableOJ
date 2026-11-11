import { difficultyLabel } from "../difficulty";

/** 난이도 글자 배지 (색은 difficulty-<값> 클래스가 정한다) */
export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span className={`difficulty difficulty-${difficulty.toLowerCase()}`}>
      {difficultyLabel(difficulty)}
    </span>
  );
}
