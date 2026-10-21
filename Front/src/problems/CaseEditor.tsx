import { SlideToggle } from "../components/SlideToggle";
import type { CaseAction, CaseForm } from "./editor";

const caseKindOptions = [
  { value: "sample", label: "예제" },
  { value: "hidden", label: "숨김" },
];

const lineCount = (text: string) =>
  text ? text.replace(/\n$/, "").split("\n").length : 0;

export function CaseEditor({
  testCase,
  index,
  total,
  error: caseError,
  onEdit,
}: {
  testCase: CaseForm;
  index: number;
  total: number;
  error?: string;
  onEdit: (action: CaseAction) => void;
}) {
  const kind = testCase.isSample ? "sample" : "hidden";
  return (
    <div
      className={`case-editor ${kind}`}
      id={`f-case-${testCase.key}`}
    >
      <div className="case-heading">
        <strong>
          테스트 {index + 1}
          <span className={`case-pill ${kind}`}>
            {testCase.isSample
              ? "예제 · 문제 화면에 공개"
              : "숨김 · 채점에만 사용"}
          </span>
        </strong>
        <SlideToggle
          ariaLabel={`테스트 ${index + 1} 공개 여부`}
          value={kind}
          options={caseKindOptions}
          onChange={(next) =>
            onEdit({
              type: "update",
              key: testCase.key,
              change: { isSample: next === "sample" },
            })
          }
        />
        <div className="case-actions">
          <button
            type="button"
            className="text-button"
            aria-label={`테스트 ${index + 1} 위로 이동`}
            disabled={index === 0}
            onClick={() => onEdit({ type: "move", key: testCase.key, step: -1 })}
          >
            ↑
          </button>
          <button
            type="button"
            className="text-button"
            aria-label={`테스트 ${index + 1} 아래로 이동`}
            disabled={index === total - 1}
            onClick={() => onEdit({ type: "move", key: testCase.key, step: 1 })}
          >
            ↓
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => onEdit({ type: "duplicate", key: testCase.key })}
          >
            복제
          </button>
          <button
            type="button"
            className="text-button"
            aria-expanded={!testCase.collapsed}
            onClick={() =>
              onEdit({
                type: "update",
                key: testCase.key,
                change: { collapsed: !testCase.collapsed },
              })
            }
          >
            {testCase.collapsed ? "펼치기" : "접기"}
          </button>
          {total > 1 ? (
            <button
              type="button"
              className="text-button danger"
              onClick={() => onEdit({ type: "remove", key: testCase.key })}
            >
              삭제
            </button>
          ) : null}
        </div>
      </div>
      {testCase.collapsed ? (
        <p className="case-collapsed muted">
          입력 {lineCount(testCase.input)}줄 · 출력{" "}
          {lineCount(testCase.expectedOutput)}줄
          {testCase.input || testCase.expectedOutput
            ? ` — ${(testCase.input.split("\n")[0] || "(없음)").slice(0, 24)} → ${(testCase.expectedOutput.split("\n")[0] || "(없음)").slice(0, 24)}`
            : " — 아직 비어 있어요"}
        </p>
      ) : (
        <div className="sample-grid">
          <div className="code-field">
            <label>
              입력
              <textarea
                className="code-input"
                rows={4}
                spellCheck={false}
                wrap="off"
                value={testCase.input}
                placeholder="입력이 없으면 비워 두세요"
                onChange={(event) =>
                  onEdit({
                    type: "update",
                    key: testCase.key,
                    change: { input: event.target.value },
                  })
                }
              />
            </label>
            <span className="field-help">
              {lineCount(testCase.input)}줄
            </span>
          </div>
          <div className="code-field">
            <label>
              기대 출력
              <textarea
                className="code-input"
                rows={4}
                spellCheck={false}
                wrap="off"
                value={testCase.expectedOutput}
                aria-invalid={Boolean(caseError)}
                onChange={(event) =>
                  onEdit({
                    type: "update",
                    key: testCase.key,
                    change: { expectedOutput: event.target.value },
                  })
                }
              />
            </label>
            {caseError ? (
              <span className="field-error" role="alert">
                {caseError}
              </span>
            ) : (
              <span className="field-help">
                {lineCount(testCase.expectedOutput)}줄
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
