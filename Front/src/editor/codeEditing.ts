import type { Language } from "../types";

/** 코드 입력창의 편집 규칙. 값과 선택 범위를 받아 새 값과 선택 범위를 돌려주는 순수 함수 모음이다. */
export interface EditState {
  value: string;
  start: number;
  end: number;
}

export const INDENT = "    ";

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};
const CLOSERS = new Set(Object.values(PAIRS));
const QUOTES = new Set(['"', "'", "`"]);

const lineStartOf = (value: string, index: number) =>
  value.lastIndexOf("\n", index - 1) + 1;
const lineEndOf = (value: string, index: number) => {
  const found = value.indexOf("\n", index);
  return found === -1 ? value.length : found;
};
const isWordChar = (char: string | undefined) =>
  Boolean(char && /[\p{L}\p{N}_]/u.test(char));

/** Enter: 현재 줄의 들여쓰기를 이어 가고, 여는 괄호(파이썬은 ':') 뒤에서는 한 단계 더 들여쓴다. */
export function handleEnter(state: EditState, language: Language): EditState {
  const { value, start, end } = state;
  const lineStart = lineStartOf(value, start);
  const before = value.slice(lineStart, start);
  const indent = /^[ \t]*/.exec(before)![0];
  const last = before.trimEnd().slice(-1);
  const opensBlock =
    "{([".includes(last) || (language === "PYTHON" && last === ":");
  const next = value[end];
  const closesRight = opensBlock && next !== undefined && PAIRS[last] === next;
  const inner = opensBlock ? indent + INDENT : indent;
  const insert = closesRight ? `\n${inner}\n${indent}` : `\n${inner}`;
  const caret = start + 1 + inner.length;
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    start: caret,
    end: caret,
  };
}

/** 여는 괄호·따옴표를 치면 짝을 같이 넣고, 닫는 문자를 치면 이미 있는 짝을 건너뛴다. 해당 없으면 null. */
export function handleCharacter(
  state: EditState,
  key: string,
): EditState | null {
  const { value, start, end } = state;
  const hasSelection = start !== end;
  const closer = PAIRS[key];
  if (closer !== undefined && hasSelection) {
    // 선택한 글자를 괄호·따옴표로 감싼다.
    return {
      value:
        value.slice(0, start) +
        key +
        value.slice(start, end) +
        closer +
        value.slice(end),
      start: start + 1,
      end: end + 1,
    };
  }
  if (hasSelection) return null;
  const next = value[start];
  if (
    CLOSERS.has(key) &&
    next === key &&
    (!QUOTES.has(key) || !isWordChar(value[start - 1]))
  ) {
    return { value, start: start + 1, end: start + 1 };
  }
  if (closer === undefined) return null;
  const previous = value[start - 1];
  // 단어 중간(예: don't)에서는 짝을 넣지 않는다.
  if (QUOTES.has(key) && isWordChar(previous)) return null;
  if (next !== undefined && !/\s/.test(next) && !CLOSERS.has(next)) return null;
  return {
    value: value.slice(0, start) + key + closer + value.slice(start),
    start: start + 1,
    end: start + 1,
  };
}

/** 빈 짝(예: "()")의 가운데에서 Backspace를 누르면 둘 다 지운다. */
export function handleBackspace(state: EditState): EditState | null {
  const { value, start, end } = state;
  if (start !== end || start === 0) return null;
  const open = value[start - 1];
  if (PAIRS[open] !== undefined && value[start] === PAIRS[open]) {
    return {
      value: value.slice(0, start - 1) + value.slice(start + 1),
      start: start - 1,
      end: start - 1,
    };
  }
  return null;
}

/** Tab / Shift+Tab: 한 줄에서는 들여쓰기·내어쓰기, 여러 줄을 고른 경우에는 그 줄들을 모두 처리한다. */
export function handleTab(state: EditState, shift: boolean): EditState {
  const { value, start, end } = state;
  const multi = value.slice(start, end).includes("\n");
  if (!shift && !multi) {
    return {
      value: value.slice(0, start) + INDENT + value.slice(end),
      start: start + INDENT.length,
      end: start + INDENT.length,
    };
  }
  const first = lineStartOf(value, start);
  const last = lineEndOf(value, end);
  const lines = value.slice(first, last).split("\n");
  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, index) => {
    let next: string;
    let delta: number;
    if (shift) {
      const match = /^(?: {1,4}|\t)/.exec(line);
      const removed = match ? match[0].length : 0;
      next = line.slice(removed);
      delta = -removed;
    } else {
      next = line.length ? INDENT + line : line;
      delta = next.length - line.length;
    }
    if (index === 0) firstDelta = delta;
    total += delta;
    return next;
  });
  return {
    value: value.slice(0, first) + changed.join("\n") + value.slice(last),
    start: Math.max(first, start + firstDelta),
    end: Math.max(first, end + total),
  };
}

const COMMENT: Record<Language, string> = {
  PYTHON: "# ",
  C: "// ",
  CPP: "// ",
  JAVA: "// ",
  JAVASCRIPT: "// ",
  TYPESCRIPT: "// ",
  GO: "// ",
  RUST: "// ",
};

/** Ctrl/⌘+/ : 고른 줄을 주석 처리하거나, 모두 주석이면 해제한다. */
export function toggleComment(state: EditState, language: Language): EditState {
  const { value, start, end } = state;
  const prefix = COMMENT[language];
  const bare = prefix.trimEnd();
  const first = lineStartOf(value, start);
  const last = lineEndOf(value, end);
  const lines = value.slice(first, last).split("\n");
  const filled = lines.filter((line) => line.trim().length);
  const uncomment =
    filled.length > 0 &&
    filled.every((line) => line.trimStart().startsWith(bare));
  const minIndent = Math.min(
    ...filled.map((line) => /^[ \t]*/.exec(line)![0].length),
    Infinity,
  );
  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, index) => {
    let next = line;
    if (line.trim().length) {
      if (uncomment) {
        const at = line.indexOf(bare);
        const length = line.startsWith(prefix, at)
          ? prefix.length
          : bare.length;
        next = line.slice(0, at) + line.slice(at + length);
      } else {
        const at = Number.isFinite(minIndent) ? minIndent : 0;
        next = line.slice(0, at) + prefix + line.slice(at);
      }
    }
    const delta = next.length - line.length;
    if (index === 0) firstDelta = delta;
    total += delta;
    return next;
  });
  return {
    value: value.slice(0, first) + changed.join("\n") + value.slice(last),
    start: Math.max(first, start + firstDelta),
    end: Math.max(first, end + total),
  };
}

/** 커서 위치를 "줄, 열"(1부터)로 바꾼다. */
export function cursorPosition(value: string, index: number) {
  const before = value.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - (before.lastIndexOf("\n") + 1) + 1 };
}

/**
 * 계산한 편집 결과를 입력창에 적용한다. execCommand("insertText")를 쓰면 브라우저의 실행 취소(Ctrl/⌘+Z)가
 * 그대로 이어진다. 지원하지 않는 환경에서는 false를 돌려주므로 호출한 쪽이 값을 직접 바꾼다.
 */
export function applyToTextarea(
  el: HTMLTextAreaElement,
  next: EditState,
): boolean {
  const before = el.value;
  // 값이 같으면(닫는 괄호 건너뛰기 등) 커서만 옮긴다. 삭제 명령이 실행되지 않게 먼저 처리한다.
  if (before === next.value) {
    el.setSelectionRange(next.start, next.end);
    return true;
  }
  let prefix = 0;
  const limit = Math.min(before.length, next.value.length);
  while (prefix < limit && before[prefix] === next.value[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] ===
      next.value[next.value.length - 1 - suffix]
  )
    suffix += 1;
  const inserted = next.value.slice(prefix, next.value.length - suffix);
  el.setSelectionRange(prefix, before.length - suffix);
  const ok =
    typeof document.execCommand === "function" &&
    (inserted.length > 0
      ? document.execCommand("insertText", false, inserted)
      : document.execCommand("delete"));
  if (!ok || el.value !== next.value) return false;
  el.setSelectionRange(next.start, next.end);
  return true;
}
