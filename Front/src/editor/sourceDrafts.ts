import type { Language } from "../types";

interface SourceDraft {
  value: string | null;
  savedAt: Date | null;
  failed: boolean;
}

const key = (problemId: string, language: Language) =>
  `unsolvable-oj-draft-v1:${problemId}:${language}`;
const drafts = new Map<string, { draft: SourceDraft; storedValue: string | null }>();

export function readSourceDraft(
  problemId: string,
  language: Language,
): SourceDraft {
  const id = key(problemId, language);
  const cached = drafts.get(id);
  if (cached?.draft.failed) return cached.draft;
  try {
    const value = localStorage.getItem(id);
    if (cached && value === cached.storedValue) return cached.draft;
    // 저장 시각은 따로 남기지 않으므로 읽은 초안에는 시각이 없다.
    const draft = { value, savedAt: null, failed: false };
    drafts.set(id, { draft, storedValue: value });
    return draft;
  } catch {
    return {
      value: cached?.draft.value ?? null,
      savedAt: cached?.draft.savedAt ?? null,
      failed: true,
    };
  }
}

export function writeSourceDraft(
  problemId: string,
  language: Language,
  value: string,
): SourceDraft {
  const id = key(problemId, language);
  const draft: SourceDraft = { value, savedAt: null, failed: true };
  drafts.set(id, { draft, storedValue: value });
  try {
    localStorage.setItem(id, value);
    draft.savedAt = new Date();
    draft.failed = false;
  } catch {
    // 저장하지 못해도 메모리의 값이 예전에 저장된 초안보다 우선한다.
  }
  return draft;
}

export function resetSourceDraft(
  problemId: string,
  language: Language,
  starter: string,
): boolean {
  const id = key(problemId, language);
  const draft = { value: null, savedAt: null, failed: false };
  drafts.set(id, { draft, storedValue: null });
  try {
    localStorage.removeItem(id);
    return true;
  } catch {
    try {
      localStorage.setItem(id, starter);
      // 대신 시작 코드를 저장해 두었어도 초기화한 뒤에는 초안이 없는 것으로 본다.
      drafts.set(id, { draft, storedValue: starter });
      return true;
    } catch {
      draft.failed = true;
      return false;
    }
  }
}
