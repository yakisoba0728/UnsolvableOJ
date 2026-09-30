import type { Difficulty } from "../types";

export interface DemoProblem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  timeLimitMs: number;
  memoryLimitMb: number;
  statementMarkdown: string;
  inputDescriptionMarkdown: string;
  outputDescriptionMarkdown: string;
  samples: { input: string; expectedOutput: string }[];
}

const p = (
  slug: string,
  title: string,
  difficulty: Difficulty,
  statement: string,
  input: string,
  output: string,
  samples: [string, string][],
  timeLimitMs = 1000,
  memoryLimitMb = 256,
): DemoProblem => ({
  slug,
  title,
  difficulty,
  timeLimitMs,
  memoryLimitMb,
  statementMarkdown: statement,
  inputDescriptionMarkdown: input,
  outputDescriptionMarkdown: output,
  samples: samples.map(([i, o]) => ({ input: i, expectedOutput: o })),
});

// 오래된 순서. 목록은 createdAt 기준으로 최신순 정렬된다.
export const demoProblems: DemoProblem[] = [
  p("a-plus-b", "A + B", "BEGINNER", "두 정수 A와 B를 입력받아 A+B를 출력하는 프로그램을 작성하세요.", "첫째 줄에 A와 B가 공백으로 구분되어 주어진다. (0 < A, B < 10)", "첫째 줄에 A+B를 출력한다.", [["1 2\n", "3\n"]]),
  p("hello-world", "Hello World", "BEGINNER", "`Hello World!`를 출력하세요.", "입력은 없다.", "첫째 줄에 `Hello World!`를 출력한다.", [["", "Hello World!\n"]]),
  p("sum-1-to-n", "1부터 N까지의 합", "BEGINNER", "자연수 N이 주어질 때 1부터 N까지의 합을 구하세요.", "첫째 줄에 N이 주어진다. (1 ≤ N ≤ 10,000)", "1부터 N까지의 합을 출력한다.", [["10\n", "55\n"]]),
  p("even-or-odd", "홀수일까 짝수일까", "BEGINNER", "정수가 주어질 때 짝수면 `even`, 홀수면 `odd`를 출력하세요.", "첫째 줄에 정수 N이 주어진다. (1 ≤ N ≤ 1,000,000)", "`even` 또는 `odd`를 출력한다.", [["7\n", "odd\n"], ["10\n", "even\n"]]),
  p("max-of-array", "배열에서 최댓값", "EASY", "N개의 정수 중 최댓값을 구하세요.", "첫째 줄에 N, 둘째 줄에 N개의 정수가 주어진다. (1 ≤ N ≤ 100,000)", "최댓값을 출력한다.", [["5\n3 9 2 7 4\n", "9\n"]]),
  p("sort-numbers", "수 정렬하기", "EASY", "N개의 수를 오름차순으로 정렬해 출력하세요.", "첫째 줄에 N, 다음 N개의 줄에 수가 하나씩 주어진다. (1 ≤ N ≤ 1,000)", "오름차순으로 한 줄에 하나씩 출력한다.", [["3\n3\n1\n2\n", "1\n2\n3\n"]]),
  p("fibonacci", "피보나치 수", "EASY", "피보나치 수열의 N번째 항을 구하세요. F(0)=0, F(1)=1 입니다.", "첫째 줄에 N이 주어진다. (0 ≤ N ≤ 45)", "N번째 피보나치 수를 출력한다.", [["10\n", "55\n"]]),
  p("parenthesis", "괄호 검사", "MEDIUM", "괄호 문자열이 올바른지 판별하세요. 올바르면 `YES`, 아니면 `NO`를 출력합니다.", "첫째 줄에 `(`와 `)`로만 이루어진 문자열이 주어진다. (길이 ≤ 50)", "`YES` 또는 `NO`를 출력한다.", [["(())()\n", "YES\n"], ["(()\n", "NO\n"]]),
  p("lis", "가장 긴 증가하는 부분 수열", "MEDIUM", "수열 A가 주어졌을 때, 가장 긴 증가하는 부분 수열의 길이를 구하세요.\n\n예를 들어 A = {10, 20, 10, 30, 20, 50} 이면 {10, 20, 30, 50} 이고 길이는 4입니다.", "첫째 줄에 N(1 ≤ N ≤ 1,000), 둘째 줄에 A(1 ≤ Ai ≤ 1,000)가 주어진다.", "가장 긴 증가하는 부분 수열의 길이를 출력한다.", [["6\n10 20 10 30 20 50\n", "4\n"]]),
  p("nm-3", "N과 M (3)", "MEDIUM", "1부터 N까지 자연수 중에서 M개를 고른 수열을 모두 출력하세요. 같은 수를 여러 번 골라도 됩니다.", "첫째 줄에 N과 M이 주어진다. (1 ≤ M ≤ N ≤ 7)", "사전 순으로 한 줄에 하나씩 출력한다.", [["2 2\n", "1 1\n1 2\n2 1\n2 2\n"]]),
  p("shortest-path", "최단 경로", "HARD", "방향 그래프와 시작 정점이 주어질 때, 시작 정점에서 다른 모든 정점까지의 최단 경로 값을 구하세요.", "첫째 줄에 V, E, 둘째 줄에 시작 정점 K, 이어서 E개의 간선(u v w)이 주어진다.", "i번째 줄에 K에서 i까지의 최단 경로 값을 출력한다. 경로가 없으면 `INF`.", [["5 6\n1\n5 1 1\n1 2 2\n1 3 3\n2 3 4\n2 4 5\n3 4 6\n", "0\n2\n3\n7\nINF\n"]], 1000, 256),
  p("mst", "최소 스패닝 트리", "HARD", "가중치가 있는 무방향 그래프의 최소 스패닝 트리의 가중치 합을 구하세요.", "첫째 줄에 V, E, 이어서 E개의 간선(u v w)이 주어진다.", "최소 스패닝 트리의 가중치 합을 출력한다.", [["3 3\n1 2 1\n2 3 2\n1 3 3\n", "3\n"]]),
  p("segment-tree-lazy", "구간 합 구하기 (lazy propagation)", "EXPERT", "수열에 대한 구간 덧셈 갱신과 구간 합 질의를 처리하세요.", "첫째 줄에 N, M, 이어서 수열과 M개의 질의가 주어진다.", "합 질의마다 결과를 한 줄에 출력한다.", [["5 2\n1 2 3 4 5\n2 1 5\n1 1 3 10\n", "15\n"]], 2000, 512),
];

export const demoRankers = [
  { username: "김알고", xp: 2940, solved: 41 },
  { username: "이코딩", xp: 2710, solved: 38 },
  { username: "박그리디", xp: 2655, solved: 37 },
  { username: "최트리", xp: 2310, solved: 33 },
  { username: "정다이나믹", xp: 1980, solved: 29 },
  { username: "한백트래킹", xp: 1540, solved: 24 },
  { username: "오그래프", xp: 1120, solved: 18 },
  { username: "유이분탐색", xp: 860, solved: 14 },
  { username: "강정렬", xp: 530, solved: 9 },
  { username: "윤입문", xp: 240, solved: 4 },
];
