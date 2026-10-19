import type { Language } from "../types";
import {
  GLOBALS,
  HEADERS,
  KEYWORDS,
  MEMBERS,
  MODULES,
  NAMESPACES,
  SNIPPETS,
  type Suggestion,
  type SuggestionKind,
} from "./completionData";

export type { Suggestion, SuggestionKind } from "./completionData";

/**
 * 코드 자동완성 엔진 (순수 함수).
 * - 부분 일치(퍼지)·CamelCase 일치와 점수 순 정렬
 * - `.`·`::`·`->` 뒤에서 변수 타입을 추론해 멤버를 제안
 * - 함수는 괄호까지, 스니펫은 Tab으로 옮겨 다니는 칸(미러 포함)으로 삽입
 * - 문자열·주석 안에서는 제안하지 않고, #include·import 줄에서는 헤더·모듈을 제안
 */

const MAX_RESULTS = 40;

// ───────────────────────── 문맥 ─────────────────────────

type CodeState = "code" | "comment" | "string";

/** 커서 위치가 코드인지, 주석이나 문자열 안인지 처음부터 훑어서 알아낸다. */
export function scanContext(
  value: string,
  caret: number,
  language: Language,
): CodeState {
  const text = value.slice(0, caret);
  const hashComment = language === "PYTHON";
  const slashComment = language !== "PYTHON";
  const backtick =
    language === "JAVASCRIPT" || language === "TYPESCRIPT" || language === "GO";
  let state: "code" | "line" | "block" | "str" | "triple" = "code";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);
    if (state === "line") {
      if (ch === "\n") state = "code";
    } else if (state === "block") {
      if (two === "*/") {
        state = "code";
        i++;
      }
    } else if (state === "triple") {
      if (three === quote.repeat(3)) {
        state = "code";
        i += 2;
      }
    } else if (state === "str") {
      if (ch === "\\") i++;
      else if (ch === quote || (ch === "\n" && quote !== "`")) state = "code";
    } else if (hashComment && ch === "#") state = "line";
    else if (slashComment && two === "//") {
      state = "line";
      i++;
    } else if (slashComment && two === "/*") {
      state = "block";
      i++;
    } else if (hashComment && (three === '"""' || three === "'''")) {
      state = "triple";
      quote = ch;
      i += 2;
    } else if (ch === '"' || ch === "'" || (backtick && ch === "`")) {
      // Rust의 수명 표기('a)나 C++ 숫자 구분자(1'000)는 문자열이 아니다.
      if (
        ch === "'" &&
        (language === "RUST" || language === "CPP" || language === "C") &&
        /[A-Za-z0-9_]/.test(text[i - 1] ?? "")
      )
        continue;
      state = "str";
      quote = ch;
    }
  }
  return state === "line" || state === "block"
    ? "comment"
    : state === "str" || state === "triple"
      ? "string"
      : "code";
}

/** 커서 바로 앞에서 이어진 이름(영문·숫자·_)을 찾는다. */
export function currentWord(value: string, caret: number) {
  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value.slice(0, caret));
  return match ? { text: match[0], start: caret - match[0].length } : null;
}

interface MemberContext {
  operator: "." | "::" | "->";
  receiver: string;
  typed: string;
}

/** 괄호 짝을 거슬러 올라가 식의 시작 위치를 찾는다. */
function matchBackwards(text: string, end: number): number {
  const closer = text[end - 1];
  const opener = closer === ")" ? "(" : "[";
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (text[i] === closer) depth++;
    else if (text[i] === opener) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const CHAIN = /[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)*$/;

function extractReceiver(before: string): string | null {
  if (!before) return null;
  const last = before[before.length - 1];
  if (last === ")" || last === "]") {
    const open = matchBackwards(before, before.length);
    if (open < 0) return null;
    const head = CHAIN.exec(before.slice(0, open));
    return before.slice(head ? open - head[0].length : open);
  }
  if (last === '"' || last === "'" || last === "`") {
    const open = before.lastIndexOf(last, before.length - 2);
    return open < 0 ? null : before.slice(open);
  }
  const chain = CHAIN.exec(before);
  return chain ? chain[0] : null;
}

/** `foo.`, `foo.ba`, `std::`, `ptr->` 처럼 멤버를 고르는 자리인지 살핀다. */
export function memberContext(
  value: string,
  caret: number,
): MemberContext | null {
  const prefix = value.slice(0, caret);
  const match = /(\.|::|->)([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!match) return null;
  const operator = match[1] as MemberContext["operator"];
  const before = prefix.slice(0, match.index);
  // 1.5 같은 소수는 멤버 접근이 아니다.
  if (operator === "." && /(?:^|[^\w$.])\d+$/.test(before)) return null;
  const receiver = extractReceiver(before);
  if (!receiver) return null;
  return { operator, receiver, typed: match[2] ?? "" };
}

// ───────────────────────── 타입 추론 ─────────────────────────

const PY_STR_CALLS = new Set(
  "input str strip lstrip rstrip lower upper replace join format readline title read".split(
    " ",
  ),
);
const PY_LIST_CALLS = new Set(
  "split splitlines list sorted readlines keys values items".split(" "),
);

function classifyPython(expr: string): string | null {
  const e = expr.trim();
  if (/^\[/.test(e) || /^(?:list|sorted)\s*\(/.test(e)) return "list";
  if (/^\{.*:/.test(e) || /^(?:dict|defaultdict|Counter)\s*\(/.test(e))
    return "dict";
  if (/^\{/.test(e) || /^set\s*\(/.test(e)) return "set";
  if (/^deque\s*\(/.test(e)) return "deque";
  if (/^[rbfu]?["']/i.test(e)) return "str";
  const call = /(?:^|\.)([A-Za-z_]\w*)\s*\([^()]*\)\s*$/.exec(e);
  if (call) {
    if (PY_LIST_CALLS.has(call[1])) return "list";
    if (PY_STR_CALLS.has(call[1])) return "str";
  }
  return null;
}

function classifyJs(expr: string, annotation?: string): string | null {
  const a = (annotation ?? "").trim();
  if (a) {
    if (a === "string") return "string";
    if (/\[\]$/.test(a) || /^Array</.test(a)) return "array";
    if (/^Map</.test(a)) return "Map";
    if (/^Set</.test(a)) return "Set";
  }
  const e = expr.trim();
  if (/^\[/.test(e) || /^Array(?:\.from)?\s*\(/.test(e)) return "array";
  if (/^new\s+Map\b/.test(e)) return "Map";
  if (/^new\s+Set\b/.test(e)) return "Set";
  if (/^["'`]/.test(e)) return "string";
  const call = /\.([A-Za-z_]\w*)\s*\([^()]*\)\s*;?$/.exec(e);
  if (call) {
    if (
      /^(?:split|map|filter|sort|reverse|concat|keys|values|entries)$/.test(
        call[1],
      )
    )
      return "array";
    if (
      /^(?:trim|toUpperCase|toLowerCase|padStart|padEnd|repeat|join|charAt|toString)$/.test(
        call[1],
      )
    )
      return "string";
  }
  return null;
}

function classifyRust(expr: string, annotation?: string): string | null {
  const a = (annotation ?? "").trim();
  if (/^Vec</.test(a)) return "Vec";
  if (a === "String") return "String";
  if (/^HashMap</.test(a)) return "HashMap";
  if (/^(?:Option|Result)</.test(a)) return "Option";
  const e = expr.trim();
  if (/^vec!|^Vec::|collect::<\s*Vec/.test(e)) return "Vec";
  if (/^String::|\.to_string\(\)|\.to_owned\(\)|^format!/.test(e))
    return "String";
  if (/^HashMap::/.test(e)) return "HashMap";
  if (/\.parse\b|\.get\(|\.first\(\)|\.last\(\)|\.pop\(\)/.test(e))
    return "Option";
  if (
    /\.(?:iter|chars|lines|bytes|split_whitespace|split|into_iter)\(\)\s*$/.test(
      e,
    )
  )
    return "Iterator";
  return null;
}

const CPP_TYPE_KEY: Record<string, string> = {
  vector: "vector",
  list: "vector",
  string: "string",
  map: "map",
  unordered_map: "map",
  multimap: "map",
  set: "set",
  unordered_set: "set",
  multiset: "set",
  queue: "queue",
  stack: "stack",
  priority_queue: "priority_queue",
  deque: "deque",
  pair: "pair",
};

const JAVA_TYPE_KEY: Record<string, string> = {
  String: "String",
  StringBuilder: "StringBuilder",
  ArrayList: "List",
  List: "List",
  LinkedList: "List",
  HashMap: "Map",
  Map: "Map",
  TreeMap: "Map",
  HashSet: "Set",
  Set: "Set",
  TreeSet: "Set",
  Queue: "Deque",
  Deque: "Deque",
  ArrayDeque: "Deque",
  PriorityQueue: "Deque",
  Stack: "Deque",
  Scanner: "Scanner",
  BufferedReader: "BufferedReader",
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 변수 선언·대입을 거슬러 찾아 타입 키를 추정한다. 모르면 null. */
function declaredType(
  name: string,
  before: string,
  language: Language,
): string | null {
  const id = escapeRe(name);
  const last = (re: RegExp) => {
    let found: RegExpExecArray | null = null;
    for (const match of before.matchAll(re)) found = match;
    return found;
  };
  switch (language) {
    case "PYTHON": {
      const match = last(
        new RegExp(`(?:^|\\n)[ \\t]*${id}\\s*=(?!=)\\s*([^\\n]+)`, "g"),
      );
      return match ? classifyPython(match[1]) : null;
    }
    case "C":
    case "CPP": {
      const match = last(
        new RegExp(
          `\\b(vector|list|string|map|unordered_map|multimap|set|unordered_set|multiset|queue|stack|priority_queue|deque|pair)\\b\\s*(?:<[^;{}()]*?>)?\\s*[&*]?\\s*${id}\\b`,
          "g",
        ),
      );
      return match ? CPP_TYPE_KEY[match[1]] : null;
    }
    case "JAVA": {
      const typed = last(
        new RegExp(
          `\\b(${Object.keys(JAVA_TYPE_KEY).join("|")})\\b\\s*(?:<[^;{}()]*?>)?\\s+${id}\\b`,
          "g",
        ),
      );
      if (typed) return JAVA_TYPE_KEY[typed[1]];
      return new RegExp(
        `\\b(?:int|long|char|double|boolean|String)\\s*(?:\\[\\])+\\s+${id}\\b`,
      ).test(before)
        ? "array"
        : null;
    }
    case "JAVASCRIPT":
    case "TYPESCRIPT": {
      const decl = last(
        new RegExp(
          `\\b(?:const|let|var)\\s+${id}\\s*(?::\\s*([^=;]+?))?\\s*=\\s*([^\\n]+)`,
          "g",
        ),
      );
      if (decl) return classifyJs(decl[2], decl[1]);
      const param = last(
        new RegExp(`\\b${id}\\s*:\\s*([\\w<>,\\s\\[\\]]+?)\\s*[,)=]`, "g"),
      );
      return param ? classifyJs("", param[1]) : null;
    }
    case "GO": {
      const bufio = last(
        new RegExp(
          `\\b${id}\\s*:?=\\s*bufio\\.New(Reader|Writer|Scanner)\\b`,
          "g",
        ),
      );
      if (bufio) return bufio[1].toLowerCase();
      return new RegExp(
        `\\b(?:var\\s+${id}\\s+strings\\.Builder|${id}\\s*:=\\s*strings\\.Builder)`,
      ).test(before)
        ? "builder"
        : null;
    }
    case "RUST": {
      const decl = last(
        new RegExp(
          `\\blet\\s+(?:mut\\s+)?${id}\\s*(?::\\s*([^=;]+?))?\\s*=\\s*([^;]+);`,
          "g",
        ),
      );
      return decl ? classifyRust(decl[2], decl[1]) : null;
    }
  }
}

const CALL_RETURNS: Record<Language, [RegExp, string][]> = {
  PYTHON: [],
  C: [],
  CPP: [
    [/\b(?:to_string|substr)$/, "string"],
    [/\bmake_pair$/, "pair"],
  ],
  JAVA: [
    [
      /\b(?:nextLine|next|readLine|toString|substring|trim|toUpperCase|toLowerCase|replace)$/,
      "String",
    ],
    [/\b(?:split|toCharArray)$/, "array"],
    [/\b(?:keySet|entrySet)$/, "Set"],
    [/\bvalues$/, "List"],
    [/\bArrays\.asList$/, "List"],
  ],
  JAVASCRIPT: [],
  TYPESCRIPT: [],
  GO: [
    [/\bbufio\.NewReader$/, "reader"],
    [/\bbufio\.NewWriter$/, "writer"],
    [/\bbufio\.NewScanner$/, "scanner"],
  ],
  RUST: [],
};

const LITERAL_TYPE: Partial<Record<Language, string>> = {
  PYTHON: "str",
  JAVASCRIPT: "string",
  TYPESCRIPT: "string",
  JAVA: "String",
};

/** 점 앞의 식(receiver)이 어떤 타입인지 MEMBERS의 키로 돌려준다. */
export function inferType(
  receiver: string,
  before: string,
  language: Language,
): string | null {
  if (NAMESPACES[language].includes(receiver)) return receiver;
  if (language === "CPP" && receiver.startsWith("std::")) {
    const key = receiver.slice(5);
    if (MEMBERS.CPP[key]) return key;
  }
  if (/^[rbfu]?["'`]/i.test(receiver)) return LITERAL_TYPE[language] ?? null;
  if (receiver.startsWith("[")) {
    if (language === "PYTHON") return "list";
    if (language === "JAVASCRIPT" || language === "TYPESCRIPT") return "array";
    return null;
  }
  if (receiver.endsWith(")")) {
    const open = receiver.indexOf("(");
    const callee = open < 0 ? "" : receiver.slice(0, open);
    const name = /([A-Za-z_$][\w$]*)$/.exec(callee)?.[1];
    if (language === "PYTHON" && name) {
      if (PY_LIST_CALLS.has(name)) return "list";
      if (PY_STR_CALLS.has(name)) return "str";
      if (["dict", "defaultdict", "Counter"].includes(name)) return "dict";
      if (name === "set") return "set";
    }
    if (language === "JAVASCRIPT" || language === "TYPESCRIPT") {
      const kind = classifyJs(`x.${name ?? ""}()`);
      if (kind) return kind;
    }
    if (language === "RUST") {
      const kind = classifyRust(receiver);
      if (kind) return kind;
    }
    for (const [re, key] of CALL_RETURNS[language])
      if (re.test(callee)) return key;
    return null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(receiver))
    return declaredType(receiver, before, language);
  return null;
}

// ───────────────────────── 퍼지 일치 ─────────────────────────

const boundary = (label: string, index: number) => {
  if (index === 0) return true;
  const prev = label[index - 1];
  return (
    prev === "_" ||
    prev === "-" ||
    prev === "." ||
    prev === "/" ||
    (/[a-z0-9]/.test(prev) && /[A-Z]/.test(label[index]))
  );
};

/**
 * 입력(query)이 label의 부분열(subsequence)로 들어 있는지 보고 점수와 위치를 돌려준다.
 * 첫 글자는 단어의 시작이나 `_`·대문자 경계에서 맞아야 하고, 연속·경계·앞쪽 일치일수록 점수가 높다.
 */
export function fuzzyMatch(
  query: string,
  label: string,
): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  const n = q.length;
  const m = l.length;
  if (n === 0) return { score: 0, indices: [] };
  if (n > m) return null;
  const NEG = -Infinity;
  const dp: number[][] = Array.from({ length: n }, () => Array(m).fill(NEG));
  const from: number[][] = Array.from({ length: n }, () => Array(m).fill(-1));
  const gain = (j: number, i: number) =>
    10 +
    (j === 0 ? 10 : boundary(label, j) ? 6 : 0) +
    (label[j] === query[i] ? 1 : 0);
  for (let j = 0; j < m; j++)
    if (l[j] === q[0] && boundary(label, j)) dp[0][j] = gain(j, 0) - j * 0.7;
  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (l[j] !== q[i]) continue;
      let best = NEG;
      let bestK = -1;
      for (let k = i - 1; k < j; k++) {
        if (dp[i - 1][k] === NEG) continue;
        const score = dp[i - 1][k] + (k === j - 1 ? 8 : -(j - k - 1) * 0.7);
        if (score > best) {
          best = score;
          bestK = k;
        }
      }
      if (bestK < 0) continue;
      dp[i][j] = best + gain(j, i);
      from[i][j] = bestK;
    }
  }
  let bestJ = -1;
  let bestScore = NEG;
  for (let j = n - 1; j < m; j++) {
    if (dp[n - 1][j] > bestScore) {
      bestScore = dp[n - 1][j];
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;
  const indices: number[] = [];
  for (let i = n - 1, j = bestJ; i >= 0; i--) {
    indices.unshift(j);
    j = from[i][j];
  }
  let score = bestScore;
  if (indices.every((index, position) => index === position)) score += 20;
  if (n === m) score += 5;
  return { score, indices };
}

// ───────────────────────── 직접 쓴 이름 ─────────────────────────

const RESERVED = new Set(Object.values(KEYWORDS).flat());

const DECL_PATTERNS: Record<Language, RegExp[]> = {
  PYTHON: [/\bdef\s+([A-Za-z_]\w*)/g, /\bclass\s+([A-Za-z_]\w*)/g],
  C: [],
  CPP: [],
  JAVA: [],
  JAVASCRIPT: [/\bfunction\s+([A-Za-z_$][\w$]*)/g],
  TYPESCRIPT: [/\bfunction\s+([A-Za-z_$][\w$]*)/g],
  GO: [/\bfunc\s+([A-Za-z_]\w*)/g],
  RUST: [/\bfn\s+([A-Za-z_]\w*)/g],
};

function localSymbols(
  value: string,
  skipStart: number,
  skipEnd: number,
  language: Language,
): Suggestion[] {
  const text = `${value.slice(0, skipStart)} ${value.slice(skipEnd)}`;
  const kinds = new Map<string, SuggestionKind>();
  for (const re of DECL_PATTERNS[language])
    for (const match of text.matchAll(re)) kinds.set(match[1], "function");
  // C 계열·Java: `int name(` 는 함수, `int name` 은 변수
  if (language === "C" || language === "CPP" || language === "JAVA") {
    for (const match of text.matchAll(
      /\b(?:void|int|long|double|float|char|bool|boolean|auto|string|String|vector<[^>]*>)\s+([A-Za-z_]\w*)\s*(\()?/g,
    ))
      kinds.set(match[1], match[2] ? "function" : "variable");
  }
  for (const match of text.matchAll(
    /(?:^|\n)[ \t]*([A-Za-z_]\w*)\s*=(?!=)|\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)|\bfor\s+([A-Za-z_]\w*)\s+in\b|\b([A-Za-z_]\w*)\s*:=/g,
  )) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (name && !kinds.has(name)) kinds.set(name, "variable");
  }
  const seen = new Map<string, SuggestionKind>();
  for (const match of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]+/g)) {
    const name = match[0];
    if (RESERVED.has(name) || seen.has(name)) continue;
    seen.set(name, kinds.get(name) ?? "word");
  }
  return [...seen].map(([label, kind]) => ({
    label,
    kind,
    insert: kind === "function" ? `${label}($0)` : label,
    detail: kind === "function" ? "직접 만든 함수" : undefined,
    doc: "코드에 쓴 이름",
  }));
}

// ───────────────────────── 제안 만들기 ─────────────────────────

const KIND_ORDER: Record<SuggestionKind, number> = {
  variable: 0,
  function: 1,
  method: 1,
  property: 1,
  class: 2,
  snippet: 3,
  keyword: 4,
  module: 4,
  word: 5,
};

/** 사용자가 최근에 고른 제안은 조금 더 위로 올린다(VS Code의 선택 기억). */
const recent = new Map<string, number>();
export function recordAccepted(label: string) {
  recent.set(label, Math.min(4, (recent.get(label) ?? 0) + 1));
}
export function resetAcceptedHistory() {
  recent.clear();
}

function rank(
  items: Suggestion[],
  query: string,
  skip?: (item: Suggestion) => boolean,
): Suggestion[] {
  const scored: { item: Suggestion; score: number; order: number }[] = [];
  const used = new Set<string>();
  for (const [order, item] of items.entries()) {
    if (used.has(item.label) || skip?.(item)) continue;
    const fuzzy = fuzzyMatch(query, item.label);
    if (!fuzzy) continue;
    used.add(item.label);
    scored.push({
      order,
      item: { ...item, matches: fuzzy.indices },
      score:
        fuzzy.score +
        (item.kind === "variable" || item.kind === "function" ? 3 : 0) +
        (recent.get(item.label) ?? 0) * 3,
    });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
        // 점수가 같으면 데이터에 적은 순서(자주 쓰는 것이 앞)를 따른다.
        a.order - b.order,
    )
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.item);
}

const RUST_STATIC_OWNERS = [
  "Vec",
  "String",
  "HashMap",
  "HashSet",
  "BTreeMap",
  "VecDeque",
  "BinaryHeap",
];

function rustStatics(owner: string): Suggestion[] {
  return [
    ["new", "()", "빈 값 만들기"],
    ["with_capacity", "(n)", "용량을 정해 만들기"],
    ["from", "(value)", "다른 값에서 만들기"],
  ].map(([label, sig, doc]) => ({
    label,
    kind: "function" as const,
    insert: sig === "()" ? `${label}()` : `${label}($0)`,
    detail: sig,
    doc: `${doc} · ${owner}`,
  }));
}

function memberCandidates(
  context: MemberContext,
  before: string,
  language: Language,
): Suggestion[] {
  const tables = MEMBERS[language];
  if (language === "RUST" && context.operator === "::") {
    // Vec::new 처럼 타입 이름 뒤의 ::는 연관 함수, std:: 는 이름 공간이다.
    if (RUST_STATIC_OWNERS.includes(context.receiver))
      return rustStatics(context.receiver);
    if (tables[context.receiver]) return tables[context.receiver];
  }
  const key = inferType(context.receiver, before, language);
  if (key && tables[key]) return tables[key];
  // 타입을 모르면 이 언어의 모든 타입 멤버를 모아 보여 준다(이름 공간은 제외).
  const namespaces = new Set(NAMESPACES[language]);
  return Object.entries(tables).flatMap(([name, items]) =>
    namespaces.has(name) ? [] : items,
  );
}

/**
 * 커서 자리에 맞는 제안을 돌려준다. `manual`이면(Ctrl+Space) 입력이 비어 있어도 목록을 보여 준다.
 * 문자열·주석 안이거나 맞는 것이 없으면 빈 배열이다.
 */
export function suggest(
  value: string,
  caret: number,
  language: Language,
  options: { manual?: boolean } = {},
): Suggestion[] {
  const linePrefix = value.slice(value.lastIndexOf("\n", caret - 1) + 1, caret);

  // #include <… / import … : 헤더·모듈 목록 (문자열 안이어도 허용)
  if (language === "C" || language === "CPP") {
    const include = /^\s*#\s*include\s*([<"])([\w./+-]*)$/.exec(linePrefix);
    if (include) {
      const closer = include[1] === "<" ? ">" : '"';
      return rank(
        (HEADERS[language] ?? []).map((name) => ({
          label: name,
          insert: `${name}${closer}`,
          kind: "module" as const,
          doc: "헤더",
        })),
        include[2],
      );
    }
  }
  const importLine =
    language === "JAVA"
      ? /^\s*import\s+(?:static\s+)?([\w.*]*)$/.exec(linePrefix)
      : language === "PYTHON"
        ? /^\s*(?:import|from)\s+([\w.]*)$/.exec(linePrefix)
        : null;
  if (importLine) {
    return rank(
      (MODULES[language] ?? []).map((name) => ({
        label: name,
        insert: name,
        kind: "module" as const,
        doc: language === "JAVA" ? "패키지·클래스" : "모듈",
      })),
      importLine[1],
    );
  }

  if (scanContext(value, caret, language) !== "code") return [];
  // 단어 중간에서는 제안하지 않는다(커서 뒤에 이어진 글자가 있을 때).
  if (/[A-Za-z0-9_]/.test(value[caret] ?? "")) return [];

  const before = value.slice(0, caret);
  const member = memberContext(value, caret);
  if (member)
    return rank(memberCandidates(member, before, language), member.typed);

  const word = currentWord(value, caret);
  if (!word && !options.manual) return [];
  const query = word?.text ?? "";
  const start = word?.start ?? caret;
  const pool: Suggestion[] = [
    ...localSymbols(value, start, caret, language),
    ...SNIPPETS[language],
    ...GLOBALS[language],
    ...KEYWORDS[language].map((label) => ({
      label,
      insert: label,
      kind: "keyword" as const,
    })),
  ];
  return rank(
    pool,
    query,
    // 이미 완성된 단어는 제안하지 않지만, 스니펫은 이름과 같아도 펼쳐 쓸 수 있다.
    (item) => item.label === query && item.insert === query,
  );
}

// ───────────────────────── 적용 ─────────────────────────

export interface SnippetStop {
  /** 탭 순서(1, 2, …). 0은 마지막 위치 */
  index: number;
  start: number;
  end: number;
  /** 같은 번호의 두 번째 이후 칸(첫 칸을 그대로 따라 한다) */
  mirror: boolean;
}

export interface SnippetSession {
  stops: SnippetStop[];
  /** 지금 선택된 탭 번호 */
  current: number;
}

export interface Applied {
  value: string;
  start: number;
  end: number;
  /** 스니펫에 옮겨 다닐 칸이 더 있으면 진행 상태 */
  session: SnippetSession | null;
}

function parseTemplate(template: string) {
  const stops: SnippetStop[] = [];
  const seen = new Set<number>();
  let text = "";
  let last = 0;
  for (const match of template.matchAll(/\$\{(\d+):([^}]*)\}|\$(\d+)/g)) {
    text += template.slice(last, match.index);
    last = match.index + match[0].length;
    const index = Number(match[1] ?? match[3]);
    const placeholder = match[2] ?? "";
    const start = text.length;
    text += placeholder;
    stops.push({
      index,
      start,
      end: start + placeholder.length,
      mirror: seen.has(index),
    });
    seen.add(index);
  }
  return { text: text + template.slice(last), stops };
}

/** 탭 순서: 1, 2, … 그리고 마지막에 0 */
const tabOrder = (stops: SnippetStop[]) => {
  const indices = [...new Set(stops.map((stop) => stop.index))];
  return [
    ...indices.filter((index) => index !== 0).sort((a, b) => a - b),
    ...(indices.includes(0) ? [0] : []),
  ];
};

const primaryOf = (session: SnippetSession, index: number) =>
  session.stops.find((stop) => stop.index === index && !stop.mirror);

/**
 * 고른 제안을 적용한 결과를 계산한다. 입력 중이던 단어를 바꾸고, 스니펫은 첫 칸을 선택해 두며,
 * 여러 줄 스니펫의 둘째 줄부터는 현재 줄의 들여쓰기를 이어 붙인다.
 */
export function applySuggestion(
  value: string,
  caret: number,
  item: Suggestion,
): Applied {
  const linePrefix = value.slice(value.lastIndexOf("\n", caret - 1) + 1, caret);
  let start: number;
  if (item.kind === "module") {
    start = caret - /[\w./+-]*$/.exec(linePrefix)![0].length;
  } else {
    const word = currentWord(value, caret);
    start = word ? word.start : caret;
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))![0];

  let insert = item.insert;
  // 이미 입력한 #, fmt., sys.stdin. 등은 스니펫에 중복해서 넣지 않는다.
  if (item.kind === "snippet") {
    const qualifier = /(?:[A-Za-z_]\w*\.)+$|#$/.exec(
      value.slice(0, start),
    )?.[0];
    if (qualifier && insert.startsWith(qualifier))
      insert = insert.slice(qualifier.length);
  }
  const next = value[caret];
  // 이미 괄호가 뒤따르면 이름만 바꾼다.
  if ((item.kind === "function" || item.kind === "method") && next === "(")
    insert = item.label;
  // #include <…> 의 닫는 기호가 이미 있으면 겹치지 않게 한다.
  if (
    item.kind === "module" &&
    (insert.endsWith(">") || insert.endsWith('"')) &&
    next === insert[insert.length - 1]
  )
    insert = insert.slice(0, -1);

  const { text: raw, stops } = parseTemplate(insert);
  // 줄바꿈 뒤에 들여쓰기를 붙이면서, 칸 위치를 가리키는 원문 오프셋의 대응 위치를 기록한다.
  let text = "";
  const offsetMap = [0];
  for (const char of raw) {
    text += char;
    if (char === "\n") text += indent;
    offsetMap.push(text.length);
  }
  const absolute: SnippetStop[] = stops.map((stop) => ({
    ...stop,
    start: start + offsetMap[stop.start],
    end: start + offsetMap[stop.end],
  }));
  const result = value.slice(0, start) + text + value.slice(caret);
  if (absolute.length === 0) {
    const cursor = start + text.length;
    return { value: result, start: cursor, end: cursor, session: null };
  }
  // $0 이 없으면 삽입 글의 끝이 마지막 위치다.
  if (!absolute.some((stop) => stop.index === 0)) {
    const cursor = start + text.length;
    absolute.push({ index: 0, start: cursor, end: cursor, mirror: false });
  }
  const order = tabOrder(absolute);
  const session: SnippetSession = { stops: absolute, current: order[0] };
  const first = primaryOf(session, session.current)!;
  return {
    value: result,
    start: first.start,
    end: first.end,
    session: order.length === 1 ? null : session,
  };
}

/** Tab / Shift+Tab: 다음(이전) 칸을 고른다. 갈 곳이 없으면 null, 마지막 칸이면 세션을 끝낸다. */
export function moveStop(
  session: SnippetSession,
  backwards = false,
): { start: number; end: number; session: SnippetSession | null } | null {
  const order = tabOrder(session.stops);
  const target = order[order.indexOf(session.current) + (backwards ? -1 : 1)];
  if (target === undefined) return null;
  const stop = primaryOf(session, target);
  if (!stop) return null;
  return {
    start: stop.start,
    end: stop.end,
    session: target === 0 ? null : { ...session, current: target },
  };
}

/**
 * 입력으로 글이 바뀐 뒤 칸 위치를 맞추고, 같은 번호의 칸(미러)이 있으면 같은 글로 맞춘다.
 * 고친 글(value)과 커서(caret)를 함께 돌려준다. 지금 칸 밖을 고쳤다면 세션을 끝낸다.
 */
export function reconcileSession(
  session: SnippetSession,
  oldValue: string,
  newValue: string,
  caret: number,
): { session: SnippetSession | null; value: string; caret: number } {
  let prefix = 0;
  const limit = Math.min(oldValue.length, newValue.length);
  while (prefix < limit && oldValue[prefix] === newValue[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldValue[oldValue.length - 1 - suffix] ===
      newValue[newValue.length - 1 - suffix]
  )
    suffix++;
  const oldEnd = oldValue.length - suffix;
  const delta = newValue.length - oldValue.length;
  const current = primaryOf(session, session.current);
  if (!current || prefix < current.start || oldEnd > current.end)
    return { session: null, value: newValue, caret };

  let stops = session.stops.map((stop) => {
    if (stop === current) return { ...stop, end: stop.end + delta };
    if (stop.start >= oldEnd)
      return { ...stop, start: stop.start + delta, end: stop.end + delta };
    return stop;
  });
  const primary = stops.find(
    (stop) => stop.index === session.current && !stop.mirror,
  )!;
  const typed = newValue.slice(primary.start, primary.end);
  let value = newValue;
  let caretShift = 0;
  // 미러를 뒤에서부터 고쳐 앞쪽 위치가 흔들리지 않게 한다.
  const mirrors = stops
    .filter((stop) => stop.index === session.current && stop.mirror)
    .sort((a, b) => b.start - a.start);
  for (const mirror of mirrors) {
    if (value.slice(mirror.start, mirror.end) === typed) continue;
    value = value.slice(0, mirror.start) + typed + value.slice(mirror.end);
    const change = typed.length - (mirror.end - mirror.start);
    if (mirror.start < primary.start) caretShift += change;
    stops = stops.map((stop) => {
      if (
        stop.start === mirror.start &&
        stop.mirror &&
        stop.index === mirror.index
      )
        return { ...stop, end: stop.end + change };
      if (stop.start >= mirror.end)
        return { ...stop, start: stop.start + change, end: stop.end + change };
      return stop;
    });
  }
  return { session: { ...session, stops }, value, caret: caret + caretShift };
}
