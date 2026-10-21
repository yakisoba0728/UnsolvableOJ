import type { Difficulty } from "../types";

/** 문제 만들기·수정 화면이 함께 쓰는 폼 모델과 규칙 */

export interface CaseForm {
  /** 순서를 바꿔도 입력 상태가 섞이지 않게 하는 화면용 키 */
  key: string;
  input: string;
  expectedOutput: string;
  isSample: boolean;
  score: number;
  collapsed: boolean;
}

export interface ProblemForm {
  title: string;
  slug: string;
  difficulty: Difficulty;
  timeLimitMs: number;
  memoryLimitMb: number;
  statement: string;
  inputDescription: string;
  outputDescription: string;
  hint: string;
  source: string;
  cases: CaseForm[];
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

let caseCounter = 0;
export function blankCase(isSample = true): CaseForm {
  caseCounter += 1;
  return {
    key: `case-${Date.now().toString(36)}-${caseCounter}`,
    input: "",
    expectedOutput: "",
    isSample,
    score: 1,
    collapsed: false,
  };
}

export function blankForm(): ProblemForm {
  return {
    title: "",
    slug: "",
    difficulty: "BEGINNER",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    statement: "",
    inputDescription: "",
    outputDescription: "",
    hint: "",
    source: "",
    cases: [blankCase()],
  };
}

/** 제목에서 주소 후보를 만든다. 영문·숫자가 3자 미만이면(한글 제목 등) 빈 값으로 둔다. */
export function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

// ---- 힌트·출처: 서버에는 전용 칸이 없어 본문 끝의 "## 힌트", "## 출처" 구역으로 저장한다 ----
const HINT_HEAD = "\n\n## 힌트\n";
const SOURCE_HEAD = "\n\n## 출처\n";

export function composeStatement(form: ProblemForm) {
  let text = form.statement.trimEnd();
  if (form.hint.trim()) text += `${HINT_HEAD}${form.hint.trim()}`;
  if (form.source.trim()) text += `${SOURCE_HEAD}${form.source.trim()}`;
  return text;
}

export function splitStatement(text: string) {
  let rest = text;
  let source = "";
  let hint = "";
  const sourceAt = rest.lastIndexOf(SOURCE_HEAD);
  if (sourceAt !== -1) {
    source = rest.slice(sourceAt + SOURCE_HEAD.length).trim();
    rest = rest.slice(0, sourceAt);
  }
  const hintAt = rest.lastIndexOf(HINT_HEAD);
  if (hintAt !== -1) {
    hint = rest.slice(hintAt + HINT_HEAD.length).trim();
    rest = rest.slice(0, hintAt);
  }
  return { statement: rest, hint, source };
}

// ---- 검증 ----
export interface FormErrors {
  title?: string;
  slug?: string;
  timeLimitMs?: string;
  memoryLimitMb?: string;
  statement?: string;
  inputDescription?: string;
  outputDescription?: string;
  testCases?: string;
  /** 케이스 key → 메시지 */
  cases: Record<string, string>;
}

export function validate(form: ProblemForm, needsSlug: boolean): FormErrors {
  const errors: FormErrors = { cases: {} };
  if (!form.title.trim()) errors.title = "제목을 입력해 주세요.";
  if (needsSlug) {
    if (!form.slug) errors.slug = "주소(slug)를 입력해 주세요.";
    else if (form.slug.length < 3) errors.slug = "주소는 3자 이상이어야 해요.";
    else if (!SLUG_PATTERN.test(form.slug))
      errors.slug = "영문 소문자·숫자와 하이픈(-)만 쓸 수 있어요. 예: a-plus-b";
  }
  if (
    !Number.isInteger(form.timeLimitMs) ||
    form.timeLimitMs < 100 ||
    form.timeLimitMs > 60000
  )
    errors.timeLimitMs = "100~60000 사이의 정수로 입력해 주세요.";
  if (
    !Number.isInteger(form.memoryLimitMb) ||
    form.memoryLimitMb < 16 ||
    form.memoryLimitMb > 4096
  )
    errors.memoryLimitMb = "16~4096 사이의 정수로 입력해 주세요.";
  if (!form.statement.trim()) errors.statement = "문제 본문을 입력해 주세요.";
  if (!form.inputDescription.trim())
    errors.inputDescription =
      "입력 형식을 설명해 주세요. 입력이 없다면 “입력은 없다.”라고 적어 주세요.";
  if (!form.outputDescription.trim())
    errors.outputDescription = "출력 형식을 설명해 주세요.";
  if (!form.cases.length)
    errors.testCases = "테스트케이스를 하나 이상 만들어 주세요.";
  return errors;
}

export const hasErrors = (errors: FormErrors) =>
  Object.entries(errors).some(([name, value]) =>
    name === "cases" ? Object.keys(value as object).length > 0 : Boolean(value),
  );

// sessionStorage provides tab isolation, including tabs duplicated by the browser.
// shortcut: recovery lasts for this tab's session, add an explicit export for closed-tab recovery.
const draftKey = (scope: string) => `unsolvable-oj-problem-draft-v2:${scope}`;

export interface ProblemDraft {
  form: ProblemForm;
  slugTouched: boolean;
  savedAt: number;
  revision: string;
}

interface DraftRead {
  draft: ProblemDraft | null;
  failed: boolean;
}

const drafts = new Map<string, DraftRead>();

export const problemDraftScope = (owner: string, problemId?: string) =>
  JSON.stringify([owner, problemId ?? "new"]);

function isDraft(value: unknown): value is ProblemDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as ProblemDraft;
  const form = draft.form;
  return Boolean(
    form &&
      typeof draft.revision === "string" &&
      typeof draft.savedAt === "number" &&
      typeof draft.slugTouched === "boolean" &&
      [
        "title", "slug", "statement", "inputDescription",
        "outputDescription", "hint", "source",
      ].every((key) => typeof form[key as keyof ProblemForm] === "string") &&
      ["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"].includes(form.difficulty) &&
      typeof form.timeLimitMs === "number" &&
      typeof form.memoryLimitMb === "number" &&
      Array.isArray(form.cases) &&
      form.cases.every(
        (item) => item &&
          typeof item.key === "string" &&
          typeof item.input === "string" &&
          typeof item.expectedOutput === "string" &&
          typeof item.isSample === "boolean" &&
          typeof item.score === "number" &&
          typeof item.collapsed === "boolean",
      ),
  );
}

export function readProblemDraft(scope: string): DraftRead {
  const cached = drafts.get(scope);
  if (cached) return cached;
  try {
    // Never adopt or delete the ownerless v1 localStorage record.
    const raw = sessionStorage.getItem(draftKey(scope));
    if (!raw || raw === "null") return { draft: null, failed: false };
    const value: unknown = JSON.parse(raw);
    if (!isDraft(value)) return { draft: null, failed: true };
    const result = { draft: value, failed: false };
    drafts.set(scope, result);
    return result;
  } catch {
    return { draft: null, failed: true };
  }
}

export function writeProblemDraft(scope: string, draft: ProblemDraft): boolean {
  drafts.set(scope, { draft, failed: true });
  try {
    sessionStorage.setItem(draftKey(scope), JSON.stringify(draft));
    drafts.set(scope, { draft, failed: false });
    return true;
  } catch {
    return false;
  }
}

export function clearProblemDraft(scope: string, submitted: ProblemDraft) {
  const current = readProblemDraft(scope).draft;
  if (current?.revision !== submitted.revision) return false;
  drafts.set(scope, { draft: null, failed: false });
  try {
    sessionStorage.removeItem(draftKey(scope));
    return true;
  } catch {
    try {
      sessionStorage.setItem(draftKey(scope), "null");
      return true;
    } catch {
      return false;
    }
  }
}

/** 아무것도 입력하지 않은 기본 폼인지(임시 저장·이탈 확인이 필요 없는지) */
export function isPristine(form: ProblemForm) {
  return (
    !form.title.trim() &&
    !form.slug &&
    !form.statement.trim() &&
    !form.inputDescription.trim() &&
    !form.outputDescription.trim() &&
    !form.hint.trim() &&
    !form.source.trim() &&
    form.difficulty === "BEGINNER" &&
    form.timeLimitMs === 1000 &&
    form.memoryLimitMb === 256 &&
    form.cases.length === 1 &&
    form.cases.every(
      (item) => !item.input && !item.expectedOutput && item.isSample && item.score === 1,
    )
  );
}
