import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  /** 무엇이 사라지는지·되돌릴 수 있는지(비우면 제목만 보인다) */
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // 앞에 포커스 받을 요소가 생겨도 처음 포커스는 늘 '취소'에 둔다.
    cancelRef.current?.focus();
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
      aria-describedby={message ? messageId : undefined}
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
      {/* 여백은 안쪽 상자가 가진다: dialog 자신이 눌린 경우만 '배경 클릭'이 되게 한다. */}
      <div className="confirm-body">
        <h2 id={titleId}>{title}</h2>
        {message ? <p id={messageId}>{message}</p> : null}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-outline"
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
      </div>
    </dialog>
  );
}

/**
 * "~할까요? 설명…" 형태의 한 줄 질문을 제목(첫 문장)과 설명(나머지)으로 나눈다.
 * 예전 브라우저 confirm 문구를 그대로 쓰는 화면이 확인 창으로 옮겨 올 때 쓴다.
 */
export function confirmOf(
  question: string,
  confirmLabel: string,
  danger = false,
): ConfirmOptions {
  const match = question.match(/^(.+?까요\?)\s*([\s\S]*)$/);
  return {
    title: match ? match[1] : question,
    message: match ? match[2] : "",
    confirmLabel,
    danger,
  };
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

  // 아직 답을 기다리는 질문의 resolve: 새 질문이 오거나 화면을 벗어나면 취소로 알린다.
  const waiting = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // 앞선 질문이 아직 열려 있으면 그 호출이 영원히 기다리지 않게 취소로 닫는다.
        waiting.current?.(false);
        waiting.current = resolve;
        setRequest({ options, resolve, returnFocus: document.activeElement });
      }),
    [],
  );

  useEffect(() => () => waiting.current?.(false), []);

  const element = request ? (
    <ConfirmDialog
      {...request.options}
      onClose={(confirmed) => {
        setRequest(null);
        const target = request.returnFocus;
        if (target instanceof HTMLElement && target.isConnected) target.focus();
        if (waiting.current === request.resolve) waiting.current = null;
        request.resolve(confirmed);
      }}
    />
  ) : null;
  return [confirm, element] as const;
}
