import type { Difficulty } from "../types";
import { DIFFICULTIES } from "../difficulty";

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

// ---- 테스트케이스 목록 편집 ----
export type CaseAction =
  | { type: "update"; key: string; change: Partial<CaseForm> }
  | { type: "add"; isSample: boolean }
  | { type: "duplicate"; key: string }
  | { type: "move"; key: string; step: -1 | 1 }
  | { type: "remove"; key: string }
  | { type: "collapseAll"; collapsed: boolean }
  | { type: "reveal"; errors: Record<string, string> };

/** 바뀐 것이 없으면 받은 배열을 그대로 돌려준다: 폼을 새로 만들면 임시 저장이 다시 일어난다. */
export function editCases(cases: CaseForm[], action: CaseAction): CaseForm[] {
  switch (action.type) {
    case "update":
      return cases.map((item) =>
        item.key === action.key ? { ...item, ...action.change } : item,
      );
    case "add":
      return [...cases, blankCase(action.isSample)];
    case "duplicate": {
      const at = cases.findIndex((item) => item.key === action.key);
      if (at === -1) return cases;
      const copy = {
        ...cases[at],
        key: blankCase().key,
        collapsed: false,
      };
      const next = [...cases];
      next.splice(at + 1, 0, copy);
      return next;
    }
    case "move": {
      const at = cases.findIndex((item) => item.key === action.key);
      const to = at + action.step;
      if (at === -1 || to < 0 || to >= cases.length) return cases;
      const next = [...cases];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    }
    case "remove":
      return cases.length > 1
        ? cases.filter((item) => item.key !== action.key)
        : cases;
    case "collapseAll":
      return cases.map((item) => ({ ...item, collapsed: action.collapsed }));
    case "reveal":
      return cases.map((item) =>
        action.errors[item.key] ? { ...item, collapsed: false } : item,
      );
  }
}

// ---- 저장 전 확인 ----
/** 화면 위에서 아래 순서로 처음 만나는 오류 칸 */
function firstErrorTarget(next: FormErrors, slugTaken: boolean) {
  if (next.title) return "title";
  if (next.slug || slugTaken) return "slug";
  if (next.timeLimitMs || next.memoryLimitMb) return "limits";
  if (next.statement) return "statement";
  if (next.inputDescription) return "input-desc";
  if (next.outputDescription) return "output-desc";
  if (next.testCases) return "cases";
  const key = Object.keys(next.cases)[0];
  return key ? `case-${key}` : null;
}

/** 확인 목록·권장 사항·단계 완료 표시와 저장할 때 먼저 보여 줄 오류 칸 */
export function reviewForm(
  form: ProblemForm,
  errors: FormErrors,
  editing: boolean,
  slugTaken: boolean,
) {
  const sampleCount = form.cases.filter((item) => item.isSample).length;
  const hiddenCount = form.cases.length - sampleCount;
  const firstCaseError = Object.keys(errors.cases)[0];

  const checklist = [
    { label: "제목", ok: !errors.title, target: "title" },
    ...(editing
      ? []
      : [
          {
            label: "주소(slug)",
            ok: !errors.slug && !slugTaken,
            target: "slug",
          },
        ]),
    {
      label: "시간·메모리 제한",
      ok: !errors.timeLimitMs && !errors.memoryLimitMb,
      target: "limits",
    },
    { label: "문제 본문", ok: !errors.statement, target: "statement" },
    { label: "입력 설명", ok: !errors.inputDescription, target: "input-desc" },
    {
      label: "출력 설명",
      ok: !errors.outputDescription,
      target: "output-desc",
    },
    { label: "테스트케이스 1개 이상", ok: !errors.testCases, target: "cases" },
    {
      label: "테스트케이스 확인 (빈 기대 출력도 허용)",
      ok: !firstCaseError,
      target: firstCaseError ? `case-${firstCaseError}` : "cases",
    },
  ];
  const warnings: string[] = [];
  if (sampleCount === 0)
    warnings.push("공개 예제가 없어요. 풀이에 도움이 되도록 예제를 추가하는 것을 권장해요.");
  if (hiddenCount === 0)
    warnings.push(
      "숨김 테스트케이스가 없어요. 예제만으로 채점하면 예제에 맞춘 풀이도 통과할 수 있어요.",
    );
  if (form.cases.length === 1)
    warnings.push(
      "테스트케이스가 하나뿐이에요. 경계값(가장 작은 값·가장 큰 값)도 추가해 보세요.",
    );
  const basicOk =
    !errors.title &&
    (editing || (!errors.slug && !slugTaken)) &&
    !errors.timeLimitMs &&
    !errors.memoryLimitMb;
  const stepDone: Record<string, boolean> = {
    "sec-basic": basicOk,
    "sec-statement":
      !errors.statement &&
      !errors.inputDescription &&
      !errors.outputDescription,
    "sec-cases": !errors.testCases && !firstCaseError,
    "sec-review": !hasErrors(errors) && !slugTaken,
  };

  return {
    sampleCount,
    hiddenCount,
    firstCaseError,
    checklist,
    warnings,
    stepDone,
    firstErrorTarget: firstErrorTarget(errors, slugTaken),
  };
}

// sessionStorage라서 탭마다 따로 저장된다(브라우저가 복제한 탭도 분리된다).
// 주인을 알 수 없는 옛 v1(localStorage) 초안은 가져오지도 지우지도 않는다.
// shortcut: 이 탭이 열려 있는 동안만 복구된다. 닫은 탭까지 복구하려면 명시적인 내보내기를 추가한다.
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
      DIFFICULTIES.includes(form.difficulty) &&
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
