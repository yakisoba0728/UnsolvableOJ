export interface AnalysisQuestion {
  id: string;
  /** 화면 머리글의 유형 이름 */
  kind: string;
  code: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string[];
  concepts: string[];
}

const PROMPT = "위 코드를 실행했을 때 출력되는 값은?";

/**
 * 출력값 추론 문제. 모든 정답은 코드를 실제로 실행해 확인한 값이다.
 * (서버에 문제 저장소가 생기면 이 파일을 API 호출로 바꾼다.)
 */
export const analysisQuestions: AnalysisQuestion[] = [
  {
    id: "slice",
    kind: "출력값 추론",
    code: "a = [1, 2, 3, 4, 5]\nprint(a[1:4])",
    prompt: PROMPT,
    options: ["[1, 2, 3]", "[1, 2, 3, 4]", "[2, 3, 4]", "[2, 3, 4, 5]"],
    answer: 2,
    explanation: [
      "a[1:4]는 인덱스 1부터 3까지의 원소를 가져옵니다. 끝 인덱스 4는 포함하지 않습니다.",
      "인덱스는 0부터 시작하므로 a[1]은 2, a[3]은 4입니다.",
    ],
    concepts: ["리스트", "슬라이싱"],
  },
  {
    id: "divmod",
    kind: "출력값 추론",
    code: "x = 17\nprint(x // 5, x % 5)",
    prompt: PROMPT,
    options: ["3 2", "3.4 2", "4 2", "3 3"],
    answer: 0,
    explanation: [
      "//는 몫만 구하는 정수 나눗셈이라 17 // 5는 3이고, %는 나머지라 17 % 5는 2입니다.",
      "print에 값을 두 개 넘기면 공백으로 구분해 한 줄에 출력합니다.",
    ],
    concepts: ["정수 나눗셈", "나머지 연산"],
  },
  {
    id: "sum35",
    kind: "출력값 추론",
    code: "def solve(n):\n    r = 0\n    for i in range(1, n + 1):\n        if i % 3 == 0 or i % 5 == 0:\n            r += i\n    return r\n\nprint(solve(10))",
    prompt: PROMPT,
    options: ["23", "33", "45", "60"],
    answer: 1,
    explanation: [
      "3 또는 5의 배수인 3, 5, 6, 9, 10을 더하면 33입니다.",
      "range(1, n + 1)은 10을 포함합니다. or는 두 조건 중 하나만 참이어도 참입니다.",
    ],
    concepts: ["반복문", "조건문"],
  },
  {
    id: "while",
    kind: "출력값 추론",
    code: "n = 1\ncount = 0\nwhile n < 50:\n    n *= 2\n    count += 1\nprint(count)",
    prompt: PROMPT,
    options: ["3", "4", "5", "6"],
    answer: 3,
    explanation: [
      "n은 2, 4, 8, 16, 32, 64로 커지고, 64가 되는 순간 n < 50이 거짓이 되어 반복이 끝납니다.",
      "n이 변한 횟수가 6번이므로 count는 6입니다. 2배씩 커지는 반복은 횟수가 log₂(n)에 가깝습니다.",
    ],
    concepts: ["while 반복", "거듭제곱 증가"],
  },
  {
    id: "dict",
    kind: "출력값 추론",
    code: 's = "banana"\nd = {}\nfor ch in s:\n    d[ch] = d.get(ch, 0) + 1\nprint(d["a"])',
    prompt: PROMPT,
    options: ["1", "2", "3", "6"],
    answer: 2,
    explanation: [
      '"banana"에는 a가 세 번 나옵니다. d.get(ch, 0)은 키가 없으면 0을 돌려주므로, 처음 보는 글자도 1부터 셀 수 있습니다.',
      "문자별 등장 횟수를 세는 이 패턴은 문제 풀이에서 자주 쓰입니다.",
    ],
    concepts: ["딕셔너리", "빈도수 세기"],
  },
  {
    id: "mutdef",
    kind: "출력값 추론",
    code: "def add(x, acc=[]):\n    acc.append(x)\n    return len(acc)\n\nadd(1)\nadd(2)\nprint(add(3))",
    prompt: PROMPT,
    options: ["3", "1", "2", "오류가 발생한다"],
    answer: 0,
    explanation: [
      "기본 인자 acc=[]는 함수를 정의할 때 한 번만 만들어져 호출마다 같은 리스트를 공유합니다.",
      "그래서 세 번 호출하면 리스트에 1, 2, 3이 쌓이고 길이는 3이 됩니다. 매번 새 리스트가 필요하면 기본값을 None으로 두고 함수 안에서 만드세요.",
    ],
    concepts: ["함수", "기본 인자", "가변 객체"],
  },
  {
    id: "fib",
    kind: "출력값 추론",
    code: "def f(n):\n    if n <= 1:\n        return 1\n    return f(n - 1) + f(n - 2)\n\nprint(f(5))",
    prompt: PROMPT,
    options: ["5", "6", "7", "8"],
    answer: 3,
    explanation: [
      "f(0)과 f(1)이 1이므로 f(2)=2, f(3)=3, f(4)=5, f(5)=8입니다.",
      "같은 값을 여러 번 다시 계산하는 재귀라서 n이 커지면 느려집니다. 값을 저장하면(메모이제이션) 빨라집니다.",
    ],
    concepts: ["재귀", "피보나치"],
  },
  {
    id: "odd",
    kind: "출력값 추론",
    code: "nums = [3, 1, 4, 1, 5]\nprint(sum(x for x in nums if x % 2 == 1))",
    prompt: PROMPT,
    options: ["9", "10", "11", "12"],
    answer: 1,
    explanation: [
      "x % 2 == 1인 홀수 3, 1, 1, 5만 골라 더하면 10입니다.",
      "sum() 안의 for ... if ...는 조건에 맞는 값만 하나씩 만들어 내는 제너레이터 식입니다.",
    ],
    concepts: ["제너레이터 식", "조건 필터"],
  },
  {
    id: "nested",
    kind: "출력값 추론",
    code: "cnt = 0\nfor i in range(3):\n    for j in range(i, 3):\n        cnt += 1\nprint(cnt)",
    prompt: PROMPT,
    options: ["6", "7", "8", "9"],
    answer: 0,
    explanation: [
      "i가 0일 때 j는 0~2로 3번, i가 1일 때 2번, i가 2일 때 1번 반복해 3 + 2 + 1 = 6입니다.",
      "안쪽 반복의 시작점이 바깥 변수에 따라 달라지면 전체 횟수는 n(n+1)/2가 되어, 시간 복잡도는 O(n²)입니다.",
    ],
    concepts: ["중첩 반복문", "시간 복잡도"],
  },
  {
    id: "sortkey",
    kind: "출력값 추론",
    code: 'words = ["pear", "fig", "apple", "kiwi"]\nwords.sort(key=len)\nprint(words[1])',
    prompt: PROMPT,
    options: ["apple", "fig", "kiwi", "pear"],
    answer: 3,
    explanation: [
      "길이 기준으로 정렬하면 fig(3), pear(4), kiwi(4), apple(5) 순서가 됩니다.",
      "파이썬의 정렬은 안정 정렬이라 길이가 같은 pear와 kiwi는 원래 순서를 유지합니다. 따라서 words[1]은 pear입니다.",
    ],
    concepts: ["정렬", "안정 정렬"],
  },
];
