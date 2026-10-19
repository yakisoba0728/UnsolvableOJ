import type { Language } from "../types";

/** 코드 자동완성: 입력 중인 단어에 맞는 키워드·스니펫·이미 쓴 이름을 추려 준다. */

export type SuggestionKind = "snippet" | "keyword" | "word";

export interface Suggestion {
  /** 목록에 보이는 이름 */
  label: string;
  /** 실제로 넣을 글. 스니펫에서는 `$0`이 커서 위치다. */
  insert: string;
  kind: SuggestionKind;
  /** 오른쪽에 작게 보이는 설명 */
  detail?: string;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

const KEYWORDS: Record<Language, string[]> = {
  PYTHON:
    words(`and as assert break class continue def del elif else except finally for from global if import in is
    lambda nonlocal not or pass raise return try while with yield True False None
    print input int str float list dict set tuple len range sorted reversed enumerate zip map filter sum min max abs
    pow round open isinstance append extend insert pop remove sort count index lower upper replace format split
    strip join sys stdin readline`),
  C: words(`auto break case char const continue default do double else enum extern float for goto if int long register
    return short signed sizeof static struct switch typedef union unsigned void volatile while include define
    printf scanf puts getchar malloc free memset strlen strcmp strcpy`),
  CPP: words(`auto bool break case catch char class const continue default delete do double else enum false float for
    if include int long namespace new nullptr private public return short signed sizeof static struct switch
    template this throw true try typedef typename unsigned using virtual void while string vector map set queue
    stack deque pair sort cin cout endl size push_back pop_back emplace_back begin end max min swap reverse`),
  JAVA: words(`abstract boolean break byte case catch char class continue default do double else enum extends final
    finally float for if implements import instanceof int interface long new null package private protected
    public return short static super switch this throw throws try void while String System out println Math
    Scanner ArrayList HashMap HashSet Arrays Collections Integer List Map Set BufferedReader InputStreamReader`),
  JAVASCRIPT:
    words(`async await break case catch class const continue default delete do else export extends false
    finally for function if import in instanceof let new null return static super switch this throw true try
    typeof undefined var void while yield console log require Math Array Object String Number JSON Map Set
    Promise parseInt parseFloat push pop shift slice splice map filter reduce forEach includes join split`),
  TYPESCRIPT:
    words(`abstract any as async await boolean break case catch class const continue declare default delete
    do else enum export extends false finally for function if implements import in instanceof interface keyof
    let namespace never new null number object private protected public readonly return static string super
    switch this throw true try type typeof undefined unknown var void while yield console log require Math
    Array Object Map Set Promise parseInt parseFloat push pop slice map filter reduce forEach includes join`),
  GO: words(`break case chan const continue default defer else fallthrough for func go goto if import interface map
    package range return select struct switch type var bool byte error float64 int int64 rune string true false
    nil fmt Println Printf Sprintf Scan Scanf Scanln make len cap append copy delete strings sort bufio os`),
  RUST: words(`as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub
    ref return self Self static struct super trait true type unsafe use where while println print vec Vec
    String Option Result Some None Ok Err usize i32 i64 u32 u64 f64 bool char io stdin read_line unwrap`),
};

const SNIPPETS: Record<Language, Suggestion[]> = {
  PYTHON: [
    snippet("for", "for i in range($0):\n    ", "반복문"),
    snippet("while", "while $0:\n    ", "반복문"),
    snippet("if", "if $0:\n    ", "조건문"),
    snippet("def", "def $0():\n    ", "함수"),
    snippet("input", "input()", "한 줄 입력"),
    snippet("readline", "sys.stdin.readline().strip()", "빠른 입력"),
  ],
  C: [
    snippet("include", "#include <stdio.h>", "헤더"),
    snippet("for", "for (int i = 0; i < $0; i++) {\n    \n}", "반복문"),
    snippet("printf", 'printf("$0\\n");', "출력"),
    snippet("scanf", 'scanf("%d", &$0);', "입력"),
    snippet("main", "int main(void) {\n    $0\n    return 0;\n}", "main 함수"),
  ],
  CPP: [
    snippet("include", "#include <bits/stdc++.h>", "헤더"),
    snippet("using", "using namespace std;", "네임스페이스"),
    snippet("for", "for (int i = 0; i < $0; i++) {\n    \n}", "반복문"),
    snippet("cin", "cin >> $0;", "입력"),
    snippet("cout", "cout << $0 << '\\n';", "출력"),
    snippet("vector", "vector<int> $0;", "배열"),
    snippet(
      "main",
      "int main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    $0\n    return 0;\n}",
      "main 함수",
    ),
  ],
  JAVA: [
    snippet(
      "main",
      "public static void main(String[] args) {\n    $0\n}",
      "main 함수",
    ),
    snippet("sout", "System.out.println($0);", "출력"),
    snippet("Scanner", "Scanner sc = new Scanner(System.in);", "입력"),
    snippet("for", "for (int i = 0; i < $0; i++) {\n    \n}", "반복문"),
    snippet(
      "BufferedReader",
      "BufferedReader br = new BufferedReader(new InputStreamReader(System.in));",
      "빠른 입력",
    ),
  ],
  JAVASCRIPT: [
    snippet("console", "console.log($0);", "출력"),
    snippet("for", "for (let i = 0; i < $0; i++) {\n    \n}", "반복문"),
    snippet("function", "function $0() {\n    \n}", "함수"),
    snippet(
      "readline",
      "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');",
      "전체 입력",
    ),
  ],
  TYPESCRIPT: [
    snippet("console", "console.log($0);", "출력"),
    snippet("for", "for (let i = 0; i < $0; i++) {\n    \n}", "반복문"),
    snippet("function", "function $0(): void {\n    \n}", "함수"),
    snippet(
      "readline",
      "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');",
      "전체 입력",
    ),
  ],
  GO: [
    snippet("main", "func main() {\n    $0\n}", "main 함수"),
    snippet("for", "for i := 0; i < $0; i++ {\n    \n}", "반복문"),
    snippet("Println", "fmt.Println($0)", "출력"),
    snippet("Scan", "fmt.Scan(&$0)", "입력"),
  ],
  RUST: [
    snippet("main", "fn main() {\n    $0\n}", "main 함수"),
    snippet("for", "for i in 0..$0 {\n    \n}", "반복문"),
    snippet("println", 'println!("{}", $0);', "출력"),
    snippet(
      "read_line",
      "let mut line = String::new();\n    std::io::stdin().read_line(&mut line).unwrap();",
      "입력",
    ),
  ],
};

function snippet(label: string, insert: string, detail: string): Suggestion {
  return { label, insert, kind: "snippet", detail };
}

const MIN_PREFIX = 2;
const LIMIT = 8;

/** 커서 바로 앞에서 이어진 이름(영문·숫자·_)을 찾는다. */
export function currentWord(value: string, caret: number) {
  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value.slice(0, caret));
  return match ? { text: match[0], start: caret - match[0].length } : null;
}

const KIND_ORDER: Record<SuggestionKind, number> = {
  snippet: 0,
  keyword: 1,
  word: 2,
};

/** 입력 중인 단어에 맞는 제안을 돌려준다. 단어가 짧거나(2자 미만) 맞는 것이 없으면 빈 배열이다. */
export function suggest(
  value: string,
  caret: number,
  language: Language,
): Suggestion[] {
  const word = currentWord(value, caret);
  if (!word || word.text.length < MIN_PREFIX) return [];
  // 단어의 중간에서는 제안하지 않는다(커서 뒤에 이어진 글자가 있을 때).
  if (/[A-Za-z0-9_]/.test(value[caret] ?? "")) return [];
  const prefix = word.text;
  const lower = prefix.toLowerCase();

  const found = new Map<string, Suggestion>();
  const add = (item: Suggestion) => {
    // 이미 완성된 단어는 제안하지 않지만, 스니펫은 이름과 같아도 펼쳐 쓸 수 있다.
    if (item.label === prefix && item.insert === prefix) return;
    if (!item.label.toLowerCase().startsWith(lower)) return;
    if (!found.has(item.label)) found.set(item.label, item);
  };
  SNIPPETS[language].forEach(add);
  KEYWORDS[language].forEach((label) =>
    add({ label, insert: label, kind: "keyword" }),
  );
  // 이미 코드에 쓴 이름(변수·함수)도 제안한다. 지금 치는 단어 자신은 뺀다.
  const seen = value.slice(0, word.start) + value.slice(caret);
  for (const match of seen.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g))
    add({
      label: match[0],
      insert: match[0],
      kind: "word",
      detail: "코드에 쓴 이름",
    });

  return [...found.values()]
    .sort(
      (a, b) =>
        Number(b.label.startsWith(prefix)) -
          Number(a.label.startsWith(prefix)) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.label.length - b.label.length ||
        a.label.localeCompare(b.label),
    )
    .slice(0, LIMIT);
}

/**
 * 고른 제안을 적용한 결과를 계산한다. 입력 중이던 단어를 바꾸고, 스니펫의 `$0` 자리에 커서를 둔다.
 * 여러 줄 스니펫의 둘째 줄부터는 현재 줄의 들여쓰기를 이어 붙인다.
 */
export function applySuggestion(
  value: string,
  caret: number,
  item: Suggestion,
) {
  const word = currentWord(value, caret);
  const start = word ? word.start : caret;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
  const text = item.insert.replace(/\n/g, `\n${indent}`);
  const marker = text.indexOf("$0");
  const body = text.replace("$0", "");
  const cursor = start + (marker === -1 ? body.length : marker);
  return {
    value: value.slice(0, start) + body + value.slice(caret),
    start: cursor,
    end: cursor,
  };
}
