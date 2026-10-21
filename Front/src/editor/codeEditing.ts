import type { Language } from "../types";

/** 코드 입력창의 편집 규칙. 값과 선택 범위를 받아 새 값과 선택 범위를 돌려주는 순수 함수 모음이다. */
export interface EditState {
  value: string;
  start: number;
  end: number;
}

export const INDENT = "    ";
/** 들여쓰기 한 단계(Tab으로 넣는 공백)의 길이. */
export const UNIT = INDENT.length;

/**
 * 편집 결과. `units`는 이 편집으로 새로 들어간 들여쓰기 한 단계(Tab으로 넣은 공백 묶음)의 시작 위치(편집 뒤 값 기준)다.
 * 공백으로만 이루어진 들여쓰기는 글자만 봐서는 Tab으로 넣은 것과 직접 친 공백을 구분할 수 없어서,
 * 편집기가 Tab으로 넣은 위치를 따로 기억하고(remapUnits), Backspace·Delete에서 한 단계씩 지우는 데 쓴다.
 */
export interface EditResult extends EditState {
  units?: number[];
}

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
  index === 0 ? 0 : value.lastIndexOf("\n", index - 1) + 1;
const lineEndOf = (value: string, start: number, end: number) => {
  // 선택 끝은 포함하지 않으므로 다음 줄 첫 칸에서 끝나면 그 줄은 제외한다.
  const index = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const found = value.indexOf("\n", index);
  return found === -1 ? value.length : found;
};
const isWordChar = (char: string | undefined) =>
  Boolean(char && /[\p{L}\p{N}_]/u.test(char));

/** Enter: 내용이 있는 줄의 들여쓰기를 이어 가고, 여는 괄호(파이썬은 ':') 뒤에서는 한 단계 더 들여쓴다. */
export function handleEnter(
  state: EditState,
  language: Language,
  units: readonly number[] = [],
): EditResult {
  const { value, start, end } = state;
  const lineStart = lineStartOf(value, start);
  const before = value.slice(lineStart, start);
  // 공백만 있는 줄에서 Enter를 치면 들여쓰기를 이어 가지 않는다(블록을 여는 문자가 있을 때만 들여쓴다).
  const lineEnd = value.indexOf("\n", end);
  const wholeLine = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const indent = wholeLine.trim() === "" ? "" : /^[ \t]*/.exec(before)![0];
  const last = before.trimEnd().slice(-1);
  const opensBlock =
    (last !== "" && "{([".includes(last)) ||
    (language === "PYTHON" && last === ":");
  const next = value[end];
  const closesRight = opensBlock && next !== undefined && PAIRS[last] === next;
  const inner = opensBlock ? indent + INDENT : indent;
  const insert = closesRight ? `\n${inner}\n${indent}` : `\n${inner}`;
  const caret = start + 1 + inner.length;
  // 새 줄의 들여쓰기에서 Tab 단위인 곳: 윗줄에서 이어받은 들여쓰기 중 Tab 단위였던 것과, 블록을 열며 더한 한 단계.
  const added: number[] = [];
  const carry = (to: number) => {
    for (let at = 0; at + UNIT <= indent.length; at += UNIT)
      if (isUnitAt(value, units, lineStart + at)) added.push(to + at);
  };
  carry(start + 1);
  if (opensBlock) added.push(start + 1 + indent.length);
  if (closesRight) carry(start + 1 + inner.length + 1);
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    start: caret,
    end: caret,
    units: added,
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
  if (CLOSERS.has(key) && next === key) {
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
export function handleTab(state: EditState, shift: boolean): EditResult {
  const { value, start, end } = state;
  const multi = value.slice(start, end).includes("\n");
  if (!shift && !multi) {
    return {
      value: value.slice(0, start) + INDENT + value.slice(end),
      start: start + INDENT.length,
      end: start + INDENT.length,
      units: [start],
    };
  }
  const first = lineStartOf(value, start);
  const last = lineEndOf(value, start, end);
  const lines = value.slice(first, last).split("\n");
  let firstDelta = 0;
  let total = 0;
  const added: number[] = [];
  let running = first;
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
    // 들여쓰기로 새로 넣은 한 단계의 위치(편집 뒤 값 기준)
    if (!shift && line.length) added.push(running);
    running += next.length + 1;
    return next;
  });
  return {
    value: value.slice(0, first) + changed.join("\n") + value.slice(last),
    start: Math.max(first, start + firstDelta),
    end: Math.max(first, end + total),
    units: added,
  };
}

/** `at`에서 시작하는 한 단계(공백 네 칸)가 기억된 Tab 단위이고 글자도 그대로인지. */
function isUnitAt(value: string, units: readonly number[], at: number) {
  return units.includes(at) && value.slice(at, at + UNIT) === INDENT;
}

/** 값 `prev` → `next`의 가운데 바뀐 구간: 앞에서부터·뒤에서부터 같은 글자를 빼고 남은 부분. */
function changedSpan(prev: string, next: string) {
  const limit = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < limit && prev[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix += 1;
  return {
    prefix,
    oldEnd: prev.length - suffix,
    delta: next.length - prev.length,
  };
}

function remapSpan(units: readonly number[], prev: string, next: string) {
  const { prefix, oldEnd, delta } = changedSpan(prev, next);
  const out: number[] = [];
  for (const unit of units) {
    if (unit + UNIT <= prefix) out.push(unit); // 바뀐 곳보다 앞
    else if (unit >= oldEnd) out.push(unit + delta); // 바뀐 곳보다 뒤
    // 바뀐 구간과 겹치면 더 이상 한 단계가 아니다
  }
  return out;
}

/**
 * 값이 `prev`에서 `next`로 바뀐 뒤에도 유효한 Tab 단위의 시작 위치만 남기고 옮긴다.
 * 줄 수가 그대로면(들여쓰기·내어쓰기·주석 토글처럼 여러 줄을 한 번에 바꿀 때) 줄마다 따로 비교해 줄 안의 변화만 반영한다.
 * 글자가 바뀌어 더 이상 공백 네 칸이 아니면 버린다.
 */
export function remapUnits(
  units: readonly number[],
  prev: string,
  next: string,
): number[] {
  if (prev === next) return normalizeUnits(units, next);
  if (units.length === 0) return [];
  const before = prev.split("\n");
  const after = next.split("\n");
  let mapped: number[];
  if (before.length === after.length) {
    mapped = [];
    // 위치 순으로 한 번만 훑어 줄마다 단위를 나눈다(줄·단위가 아주 많아도 입력마다 느려지지 않게)
    const sorted = units.filter(Number.isInteger).sort((a, b) => a - b);
    let cursor = 0;
    let from = 0;
    let to = 0;
    for (let line = 0; line < before.length; line += 1) {
      const a = before[line];
      const b = after[line];
      const end = from + a.length + 1;
      const inLine: number[] = [];
      while (cursor < sorted.length && sorted[cursor] < end) {
        if (sorted[cursor] >= from) inLine.push(sorted[cursor] - from);
        cursor += 1;
      }
      // 바뀌지 않은 줄은 위치만 옮긴다
      const kept = a === b ? inLine : remapSpan(inLine, a, b);
      for (const unit of kept) mapped.push(unit + to);
      from = end;
      to += b.length + 1;
    }
  } else {
    mapped = remapSpan(units, prev, next);
  }
  return normalizeUnits(mapped, next);
}

/** 범위를 벗어나거나 글자가 공백 네 칸이 아닌 항목, 중복을 없애고 정렬한다. */
function normalizeUnits(units: readonly number[], value: string) {
  return [...new Set(units)]
    .filter(
      (unit) =>
        Number.isInteger(unit) &&
        unit >= 0 &&
        value.slice(unit, unit + UNIT) === INDENT,
    )
    .sort((a, b) => a - b);
}

/**
 * 새로 들어간 Tab 단위를 기억 목록에 더한다. 이미 그 자리에 기억된 단위가 있으면(공백이 이어진 경우)
 * 바로 뒤로 밀어, 이어진 공백 전체가 한 단계씩 끊겨 기억되게 한다.
 */
export function addUnits(
  units: readonly number[],
  added: readonly number[],
  value: string,
) {
  const next = new Set(units);
  for (const position of added) {
    let at = position;
    while (next.has(at)) at += UNIT;
    next.add(at);
  }
  return normalizeUnits([...next], value);
}

/** Backspace: 커서 바로 앞이 기억된 Tab 단위의 끝이면 한 단계(공백 네 칸)를 한 번에 지운다. 아니면 null(기본 동작). */
export function backspaceUnit(
  state: EditState,
  units: readonly number[],
): EditState | null {
  const { value, start, end } = state;
  if (start !== end) return null;
  const unit = units.find(
    (at) => at + UNIT === start && isUnitAt(value, units, at),
  );
  if (unit === undefined) return null;
  return {
    value: value.slice(0, unit) + value.slice(start),
    start: unit,
    end: unit,
  };
}

/** Delete: 커서 바로 뒤가 기억된 Tab 단위의 시작이면 한 단계를 한 번에 지운다. 아니면 null(기본 동작). */
export function deleteUnit(
  state: EditState,
  units: readonly number[],
): EditState | null {
  const { value, start, end } = state;
  if (start !== end || !isUnitAt(value, units, start)) return null;
  return {
    value: value.slice(0, start) + value.slice(start + UNIT),
    start,
    end: start,
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
  const last = lineEndOf(value, start, end);
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
