import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  applySuggestion,
  currentWord,
  moveStop,
  reconcileSession,
  recordAccepted,
  suggest,
  type SnippetSession,
  type Suggestion,
} from "../editor/autocomplete";
import {
  applyToTextarea,
  backspaceUnit,
  cursorPosition,
  deleteUnit,
  handleBackspace,
  handleCharacter,
  handleEnter,
  handleTab,
  toggleComment,
  type EditResult,
  type EditState,
} from "../editor/codeEditing";
import { languages } from "../editor/languages";
import type { Language } from "../types";

const kindGlyph: Record<Suggestion["kind"], string> = {
  snippet: "{}",
  keyword: "k",
  function: "ƒ",
  method: "ƒ",
  property: "p",
  class: "C",
  variable: "v",
  module: "M",
  word: "a",
};
const kindName: Record<Suggestion["kind"], string> = {
  snippet: "스니펫",
  keyword: "키워드",
  function: "함수",
  method: "메서드",
  property: "속성",
  class: "타입",
  variable: "변수",
  module: "모듈",
  word: "",
};

export interface CodeEditorHandle {
  /** 초기화 버튼이 편집기 밖(도구 막대)에 있어, 스니펫 칸 이동·제안 목록을 닫고 직전 값을 맞출 때 쓴다. */
  reset(value: string): void;
}

export function CodeEditor({
  ref,
  language,
  value,
  fontSize,
  onChange,
  onCursorChange,
  syncUnits,
}: {
  ref: Ref<CodeEditorHandle>;
  language: Language;
  value: string;
  fontSize: number;
  onChange: (value: string) => void;
  onCursorChange: (cursor: { line: number; column: number }) => void;
  /** 페이지가 초안과 함께 기억하는 Tab 단위를 이 글에 맞추고(이번 편집으로 들어간 단위를 더해) 돌려준다. */
  syncUnits: (value: string, added?: readonly number[]) => number[];
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // 자동완성 제안 목록(커서 아래에 표시)
  const [popup, setPopup] = useState<{
    items: Suggestion[];
    index: number;
    caret: number;
    left: number;
    top: number;
  } | null>(null);
  const suppressSuggest = useRef(false);
  const tabMovesFocus = useRef(false);
  // 스니펫의 Tab 칸 이동 상태, 직전 입력창 값(칸 위치 보정용), 미러 동기화 중 표시
  const sessionRef = useRef<SnippetSession | null>(null);
  const lastValueRef = useRef("");
  const syncingRef = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      reset(next) {
        sessionRef.current = null;
        setPopup(null);
        lastValueRef.current = next;
      },
    }),
    [],
  );

  function updateSource(next: string) {
    lastValueRef.current = next;
    onChange(next);
  }

  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  // 언어가 바뀌면 진행 중이던 스니펫 칸 이동을 끝낸다(다른 문제로 옮기면 편집기를 새로 그린다).
  useEffect(() => {
    sessionRef.current = null;
  }, [language]);

  // 방향키로 고른 제안이 목록 밖으로 나가지 않게 따라간다.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [popup?.index]);

  const selectedLanguage = languages.find((item) => item.value === language);
  const lineCount = value.split("\n").length;

  function updateCursor(target: HTMLTextAreaElement) {
    onCursorChange(cursorPosition(target.value, target.selectionStart));
  }

  /** 계산한 편집 결과를 입력창에 적용한다(실행 취소가 유지되도록 브라우저 편집 명령을 우선 쓴다). */
  function applyEdit(target: HTMLTextAreaElement, next: EditState) {
    if (!applyToTextarea(target, next)) {
      // 미러 칸 맞추기가 같은 입력 이벤트 안에서 DOM을 다시 읽으므로 값을 바로 넣는다.
      target.value = next.value;
      target.setSelectionRange(next.start, next.end);
      updateSource(next.value);
    }
    updateCursor(target);
  }

  /** 커서 자리에 맞는 제안을 계산해 커서 근처에 띄운다(공간이 모자라면 위쪽에). */
  function refreshSuggest(target: HTMLTextAreaElement, manual = false) {
    if (target.selectionStart !== target.selectionEnd) return setPopup(null);
    const items = suggest(target.value, target.selectionStart, language, {
      manual,
    });
    if (!items.length) return setPopup(null);
    const { line, column } = cursorPosition(
      target.value,
      target.selectionStart,
    );
    const typed =
      currentWord(target.value, target.selectionStart)?.text.length ?? 0;
    // 고정폭 글꼴이라 줄·열로 위치를 계산한다(글자 폭 0.6em, 줄 높이 1.6em).
    const frame = target.parentElement;
    const lineHeight = fontSize * 1.6;
    const width = 340;
    const maxLeft = Math.max(
      0,
      (frame?.clientWidth ?? 600) + (frame?.scrollLeft ?? 0) - width,
    );
    const below = target.offsetTop + 16 + line * lineHeight + 4;
    // 목록(최대 8줄) + 설명 줄 높이를 어림해, 아래가 모자라면 커서 줄 위로 올린다.
    const height = Math.min(items.length, 8) * 28 + 40;
    const visibleBottom =
      (frame?.scrollTop ?? 0) + (frame?.clientHeight ?? 400);
    const top =
      below + height > visibleBottom
        ? Math.max(0, below - lineHeight - 8 - height)
        : below;
    setPopup({
      items,
      index: 0,
      caret: target.selectionStart,
      left: Math.min(
        maxLeft,
        target.offsetLeft + (column - 1 - typed) * fontSize * 0.6,
      ),
      top,
    });
  }

  /** 제안을 적용한다. 글이 바뀌지 않으면(이미 완성된 단어) 아무것도 하지 않고 false를 돌려준다. */
  function acceptSuggestion(index: number): boolean {
    const target = editorRef.current;
    const item = popup?.items[index];
    if (!target || !item) return false;
    const applied = applySuggestion(target.value, target.selectionStart, item);
    if (applied.value === target.value) {
      setPopup(null);
      return false;
    }
    recordAccepted(item.label);
    suppressSuggest.current = true; // 적용 직후에는 다시 띄우지 않는다
    sessionRef.current = null;
    setPopup(null);
    applyEdit(target, applied);
    // 옮겨 다닐 칸이 있으면 이어서 Tab으로 이동할 수 있게 한다.
    sessionRef.current = applied.session;
    return true;
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key !== "Shift" && event.key !== "Tab")
      tabMovesFocus.current = false;
    // Ctrl/⌘ + Enter 로 바로 제출 (LeetCode·HackerRank 방식)
    if (event.key === "Enter" && modifier) {
      event.preventDefault();
      target.form?.requestSubmit();
      return;
    }
    // 한글 등 조합 입력 중에는 편집 규칙을 적용하지 않는다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPopup(null);
      sessionRef.current = null;
      tabMovesFocus.current = true;
      return;
    }
    if (event.key === "Tab" && tabMovesFocus.current) {
      tabMovesFocus.current = false;
      return;
    }
    // 수동 호출: Ctrl+Space(VS Code·IntelliJ), ⌘I(VS Code Mac), Alt+/
    if (
      (event.ctrlKey && event.code === "Space") ||
      (event.metaKey && event.key.toLowerCase() === "i") ||
      (event.altKey && event.code === "Slash")
    ) {
      event.preventDefault();
      refreshSuggest(target, true);
      return;
    }
    if (popup) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPopup({
          ...popup,
          index: (popup.index + step + popup.items.length) % popup.items.length,
        });
        return;
      }
      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        const step = event.key === "PageDown" ? 8 : -8;
        setPopup({
          ...popup,
          index: Math.min(
            popup.items.length - 1,
            Math.max(0, popup.index + step),
          ),
        });
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !modifier &&
        !event.shiftKey
      ) {
        // 바뀌는 것이 없으면 Enter·Tab은 평소 동작(줄바꿈·들여쓰기)으로 넘긴다.
        const before = popup.index;
        event.preventDefault();
        if (acceptSuggestion(before)) return;
      }
    }
    // 스니펫 칸 이동: Tab/Shift+Tab으로 다음·이전 칸, Esc나 Enter, 방향키 이동은 끝낸다.
    if (sessionRef.current) {
      if (event.key === "Tab" && !modifier && !event.altKey) {
        const moved = moveStop(sessionRef.current, event.shiftKey);
        if (moved) {
          event.preventDefault();
          sessionRef.current = moved.session;
          target.setSelectionRange(moved.start, moved.end);
          updateCursor(target);
          return;
        }
        sessionRef.current = null;
      } else if (
        [
          "Enter",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)
      ) {
        sessionRef.current = null;
      }
    }
    const state: EditState = {
      value: target.value,
      start: target.selectionStart,
      end: target.selectionEnd,
    };
    // 키를 처리하기 전에 기억한 Tab 단위를 지금 글에 맞춘다.
    const units = syncUnits(target.value);
    /** 편집을 적용하고, 기억한 단위를 옮긴 뒤 이번 편집으로 새로 들어간 단위를 더한다. */
    const run = (next: EditResult) => {
      applyEdit(target, next);
      syncUnits(next.value, next.units);
    };
    if (modifier && event.key === "/") {
      event.preventDefault();
      applyEdit(target, toggleComment(state, language));
    } else if (event.key === "Tab" && !modifier && !event.altKey) {
      event.preventDefault();
      run(handleTab(state, event.shiftKey));
    } else if (event.key === "Enter" && !modifier && !event.shiftKey) {
      event.preventDefault();
      run(handleEnter(state, language, units));
    } else if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !modifier &&
      !event.altKey
    ) {
      // Tab으로 넣은 들여쓰기 한 단계는 한 번에 지우고, 직접 친 공백은 기본 동작(한 글자씩)을 따른다.
      const unitEdit =
        event.key === "Backspace"
          ? backspaceUnit(state, units)
          : deleteUnit(state, units);
      const next =
        unitEdit ?? (event.key === "Backspace" ? handleBackspace(state) : null);
      if (next) {
        event.preventDefault();
        run(next);
      }
    } else if (event.key.length === 1 && !modifier && !event.altKey) {
      const next = handleCharacter(state, event.key);
      if (next) {
        event.preventDefault();
        applyEdit(target, next);
      }
    }
  }

  return (
    <div
      className="editor-frame"
      style={
        { "--editor-font": `${fontSize}px` } as React.CSSProperties
      }
    >
      <div className="line-numbers" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <textarea
        ref={editorRef}
        className="code-editor"
        aria-label={`${selectedLanguage?.label ?? ""} 소스 코드`}
        aria-describedby="editor-shortcuts"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        value={value}
        aria-autocomplete={popup ? "list" : undefined}
        aria-controls={popup ? "editor-suggestions" : undefined}
        aria-activedescendant={
          popup ? `suggestion-${popup.index}` : undefined
        }
        onChange={(event) => {
          tabMovesFocus.current = false;
          const target = event.currentTarget;
          const native = event.nativeEvent as InputEvent;
          // 한글 등 조합 중에는 값만 저장하고, 칸 보정·제안은 조합이 끝난 뒤에 한다.
          if (native.isComposing) {
            updateSource(target.value);
            updateCursor(target);
            return;
          }
          // 스니펫 칸 안에서 고친 글을 같은 번호의 다른 칸(미러)에도 반영한다.
          if (sessionRef.current && !syncingRef.current) {
            const synced = reconcileSession(
              sessionRef.current,
              lastValueRef.current,
              target.value,
              target.selectionStart,
            );
            sessionRef.current = synced.session;
            if (synced.session && synced.value !== target.value) {
              syncingRef.current = true;
              applyEdit(target, {
                value: synced.value,
                start: synced.caret,
                end: synced.caret,
              });
              syncingRef.current = false;
            }
          }
          updateSource(target.value);
          updateCursor(target);
          if (suppressSuggest.current) {
            suppressSuggest.current = false;
          } else if (syncingRef.current || sessionRef.current) {
            setPopup(null);
          } else if (
            // 붙여넣기·실행 취소·끌어다 놓기로 바뀐 글에는 띄우지 않고,
            // 지우는 중에는 이미 떠 있을 때만 갱신한다(VS Code와 같다).
            !/^(?:history|insertFromPaste|insertFromDrop)/.test(
              native.inputType ?? "",
            ) &&
            (!native.inputType?.startsWith("delete") || popup)
          ) {
            refreshSuggest(target);
          } else setPopup(null);
        }}
        onMouseDown={() => {
          sessionRef.current = null;
        }}
        onSelect={(event) => {
          updateCursor(event.currentTarget);
          // 커서나 선택 범위가 바뀌면 이전 위치의 제안을 닫는다.
          const target = event.currentTarget;
          const { selectionStart, selectionEnd } = target;
          setPopup((current) =>
            current &&
            (current.caret !== selectionStart ||
              selectionStart !== selectionEnd)
              ? null
              : current,
          );
        }}
        onBlur={() => {
          tabMovesFocus.current = false;
          setPopup(null);
        }}
        onKeyDown={onEditorKeyDown}
        required
      />
      {popup ? (
        <div
          className="autocomplete"
          style={{ left: popup.left, top: popup.top }}
        >
          <ul
            ref={listRef}
            id="editor-suggestions"
            role="listbox"
            aria-label="자동완성 제안"
          >
            {popup.items.map((item, index) => (
              <li
                key={`${item.kind}-${item.label}`}
                id={`suggestion-${index}`}
                role="option"
                aria-selected={index === popup.index}
                className={index === popup.index ? "active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  acceptSuggestion(index);
                }}
              >
                <span
                  className={`suggestion-icon kind-${item.kind}`}
                  aria-hidden="true"
                >
                  {kindGlyph[item.kind]}
                </span>
                <span className="suggestion-label">
                  {Array.from(item.label).map((char, at) => (
                    <span
                      key={at}
                      className={
                        item.matches?.includes(at)
                          ? "suggestion-hit"
                          : undefined
                      }
                    >
                      {char}
                    </span>
                  ))}
                </span>
                <span className="suggestion-detail">
                  {item.detail ?? kindName[item.kind]}
                </span>
              </li>
            ))}
          </ul>
          <p className="suggestion-doc" aria-hidden="true">
            {popup.items[popup.index].doc ??
              kindName[popup.items[popup.index].kind]}
          </p>
        </div>
      ) : null}
    </div>
  );
}
