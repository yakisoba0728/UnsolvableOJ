import { useState } from "react";

/** 화면에서 제공하는 원문만 복사하며 잘린 출력의 나머지는 복원하지 않는다. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function copy() {
    if (pending) return;
    setPending(true);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("복사했어요.");
    } catch {
      setMessage("복사하지 못했어요. 내용을 직접 선택해 복사해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="copy-control">
      <button
        type="button"
        className="text-button"
        onClick={copy}
        disabled={pending}
      >
        {label}
      </button>
      <span role="status" className="muted">
        {message}
      </span>
    </span>
  );
}
