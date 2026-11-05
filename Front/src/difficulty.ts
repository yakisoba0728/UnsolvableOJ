import type { Difficulty } from "./types";

/** 난이도(서버 값)와 화면 이름. 배열 순서가 곧 쉬운 순서다. */
export const difficultyOptions: { value: Difficulty; label: string }[] = [
  { value: "BEGINNER", label: "입문" },
  { value: "EASY", label: "쉬움" },
  { value: "MEDIUM", label: "보통" },
  { value: "HARD", label: "어려움" },
  { value: "EXPERT", label: "전문가" },
];

export const DIFFICULTIES = difficultyOptions.map((item) => item.value);

export const difficultyLabel = (value: string) =>
  difficultyOptions.find((item) => item.value === value)?.label ?? value;
