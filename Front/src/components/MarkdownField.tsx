import { useState } from "react";
import Markdown from "react-markdown";

interface MarkdownFieldProps {
  /** 폼 안에서 칸을 찾아가기 위한 id (오류·체크리스트 이동에 쓴다) */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** 칸 아래 보조 설명 */
  help?: string;
  error?: string;
  required?: boolean;
}

/**
 * Markdown 입력 칸: [작성 | 미리보기] 탭으로 풀이 화면과 같은 모양을 저장 전에 확인한다.
 * 탭을 바꿔도 입력한 내용과 칸 높이는 그대로 유지된다.
 */
export function MarkdownField({
  id,
  label,
  value,
  onChange,
  rows = 6,
  placeholder,
  help,
  error,
  required,
}: MarkdownFieldProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const minHeight = `${rows * 1.7 + 1.5}em`;

  return (
    <div className="md-field" id={`f-${id}`}>
      <div className="md-field-head">
        <div className="label-row">
          <label htmlFor={id} className="field-label">
            {label}
          </label>
          {required ? (
            <span className="required-mark" aria-hidden="true">
              필수
            </span>
          ) : null}
        </div>
        <div
          className="md-tabs"
          role="tablist"
          aria-label="작성·미리보기 전환"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "write"}
            className={mode === "write" ? "active" : ""}
            onClick={() => setMode("write")}
          >
            작성
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            className={mode === "preview" ? "active" : ""}
            onClick={() => setMode("preview")}
          >
            미리보기
          </button>
        </div>
      </div>
      {mode === "write" ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? `${id}-error` : help ? `${id}-help` : undefined
          }
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className="md-preview markdown" style={{ minHeight }}>
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="muted">
              미리볼 내용이 없어요. 작성 탭에서 입력해 보세요.
            </p>
          )}
        </div>
      )}
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : help ? (
        <span id={`${id}-help`} className="field-help">
          {help}
        </span>
      ) : null}
    </div>
  );
}
