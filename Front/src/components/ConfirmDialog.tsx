import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  /** 무엇이 사라지는지·되돌릴 수 있는지 */
  message: string;
  /** 확인 버튼 글자 (예: "삭제") */
  confirmLabel: string;
  /** 참이면 확인 버튼을 위험(빨강) 모양으로 보인다. */
  danger?: boolean;
}

/**
 * 화면 안의 확인 창. 브라우저 기본 confirm 대신 사이트 모양으로 보인다.
 * 네이티브 <dialog>의 showModal을 써서 포커스 가두기·Esc 닫기·배경 비활성화를 브라우저에 맡긴다.
 * 되돌릴 수 없는 동작을 실수로 확정하지 않도록 처음 포커스는 '취소'에 둔다.
 */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onClose,
}: ConfirmOptions & { onClose: (confirmed: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  // 모달이 열려 있는 동안 바깥은 비활성이라 포커스를 옮길 수 없다: 먼저 닫고 알린다.
  const finish = (confirmed: boolean) => {
    ref.current?.close();
    onClose(confirmed);
  };
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      // Esc로 닫으면 취소다.
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
      // 창 바깥(배경)을 누르면 취소다.
      onClick={(event) => {
        if (event.target === event.currentTarget) finish(false);
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{message}</p>
      <div className="confirm-actions">
        <button
          type="button"
          className="button button-outline"
          autoFocus
          onClick={() => finish(false)}
        >
          취소
        </button>
        <button
          type="button"
          className={`button ${danger ? "button-danger" : ""}`}
          onClick={() => finish(true)}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/**
 * const [confirm, confirmDialog] = useConfirm();
 * if (!(await confirm({ ... }))) return;
 * 화면 어딘가에 {confirmDialog}를 그려 둔다. 닫히면 열기 전 포커스로 돌아간다.
 */
export function useConfirm() {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
    returnFocus: Element | null;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setRequest({ options, resolve, returnFocus: document.activeElement }),
      ),
    [],
  );

  // 화면을 벗어나면 기다리던 쪽에 취소로 알린다.
  const pending = useRef(request);
  pending.current = request;
  useEffect(() => () => pending.current?.resolve(false), []);

  const element = request ? (
    <ConfirmDialog
      {...request.options}
      onClose={(confirmed) => {
        setRequest(null);
        const target = request.returnFocus;
        if (target instanceof HTMLElement && target.isConnected) target.focus();
        request.resolve(confirmed);
      }}
    />
  ) : null;
  return [confirm, element] as const;
}
