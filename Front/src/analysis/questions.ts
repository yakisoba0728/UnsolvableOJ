import { api } from "../api";
import { useRequest } from "../hooks";
import type { Difficulty } from "../types";

export const analysisTopics = ["기초·제어문", "자료구조", "함수·재귀"] as const;
export type AnalysisTopic = (typeof analysisTopics)[number];

/** 서버가 주는 문항 본문. 정답·해설은 번들과 목록 응답에 넣지 않는다. */
export interface AnalysisQuestion {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** 목록 필터용 분류 */
  topic: AnalysisTopic;
  language: string;
  /** 화면 머리글의 유형 이름 */
  kind: string;
  code: string;
  prompt: string;
  options: string[];
}

/** 답을 확인한 뒤 서버가 알려 주는 정답 번호와 해설 */
export interface AnalysisReveal {
  answer: number;
  explanation: string[];
  concepts: string[];
}

export function useAnalysisQuestions() {
  const { data, ...request } = useRequest<AnalysisQuestion[]>(
    (signal) => api("/missions/analysis/questions", { signal }),
    [],
    "코드 분석 문제를 불러오지 못했습니다.",
    [],
  );
  return { questions: data, ...request };
}
