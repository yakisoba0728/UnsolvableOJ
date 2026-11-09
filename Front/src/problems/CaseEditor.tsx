import { useState } from "react";
import { SlideToggle } from "../components/SlideToggle";
import type { CaseAction, CaseForm } from "./editor";

const caseKindOptions = [
  { value: "sample", label: "예제" },
  { value: "hidden", label: "숨김" },
];

// 서버의 테스트케이스 입력·기대 출력 최대 길이(1,000,000자). 바이트는 글자 수 이상이라 이 크기 안이면 넘지 않는다.
const MAX_CASE_FILE_BYTES = 1_000_000;

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
  const [fileError, setFileError] = useState("");

  async function loadFile(field: "input" | "expectedOutput", file?: File) {
    if (!file) return;
    if (file.size > MAX_CASE_FILE_BYTES) {
      setFileError(`${file.name} 파일이 1MB(1,000,000바이트)를 넘어 불러오지 않았어요.`);
      return;
    }
    try {
      const text = await file.text();
      setFileError("");
      onEdit({ type: "update", key: testCase.key, change: { [field]: text } });
    } catch {
      setFileError(`${file.name} 파일을 읽지 못했어요. 기존 내용은 그대로예요.`);
    }
  }
  const fileLoader = (field: "input" | "expectedOutput", name: string) => (
    <label className="case-file">
      파일에서 불러오기
      <input
        type="file"
        className="sr-only"
        accept=".in,.out,.ans,.txt,text/plain"
        aria-label={`테스트 ${index + 1} ${name} 파일에서 불러오기`}
        onChange={(event) => {
          void loadFile(field, event.target.files?.[0]);
          // 같은 파일을 다시 골라도 불러오도록 비운다.
          event.target.value = "";
        }}
      />
    </label>
  );
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
            {fileLoader("input", "입력")}
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
            {fileLoader("expectedOutput", "기대 출력")}
          </div>
          {fileError ? (
            <p className="field-error case-file-error" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
