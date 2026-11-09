import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { postAction } from "./api";

const MAX_REASON = 500;

/** 글·답변 신고 창. path는 글 주소 뒤에 붙는 신고 경로("/report" 또는 "/comments/:id/report")다. */
export function ReportDialog({
  postId,
  path,
  label,
  token,
  onClose,
  onReported,
}: {
  postId: string;
  path: string;
  label: string;
  token: string;
  onClose: () => void;
  onReported: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) {
      setError("신고 사유를 입력해 주세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await postAction(postId, path, "POST", token, { reason: text });
      onReported();
    } catch (cause) {
      setPending(false);
      setError(
        cause instanceof ApiError && cause.status === 409
          ? `이미 신고한 ${label}이에요.`
          : "신고하지 못했어요. 다시 시도해 주세요.",
      );
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="report-dialog"
      aria-labelledby="report-dialog-title"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <h2 id="report-dialog-title">{label} 신고</h2>
        <p className="muted">
          관리자가 확인한 뒤 숨길 수 있어요. 같은 {label}은 한 번만 신고할 수
          있어요.
        </p>
        <textarea
          rows={4}
          maxLength={MAX_REASON}
          aria-label="신고 사유"
          aria-invalid={Boolean(error)}
          placeholder="신고 사유를 적어 주세요."
          value={reason}
          disabled={pending}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="answer-footer">
          <button
            type="button"
            className="button button-outline button-small"
            onClick={() => dialogRef.current?.close()}
          >
            취소
          </button>
          <button className="button button-small" disabled={pending}>
            {pending ? "보내는 중…" : "신고하기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
