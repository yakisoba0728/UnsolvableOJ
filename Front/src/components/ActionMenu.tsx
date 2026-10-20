import { EllipsisVertical } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** 오른쪽 위 점 세 개(⋮) 메뉴. 바깥 클릭·Esc로 닫히고, ↑↓로 항목을 옮긴다. */
export function ActionMenu({
  label,
  items,
}: {
  label: string;
  items: ActionMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const itemsEls = () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
    itemsEls()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      } else if (event.key === "Tab") {
        setOpen(false);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const list = itemsEls();
        list[event.key === "Home" ? 0 : list.length - 1]?.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = itemsEls();
        const index = list.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="action-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <EllipsisVertical size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="action-menu-list"
          role="menu"
          id={menuId}
          aria-label={label}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`action-menu-item ${item.danger ? "danger" : ""}`}
              onClick={() => {
                setOpen(false);
                // 선택한 항목이 사라져도 포커스가 문서 맨 앞으로 튀지 않게 버튼으로 돌려놓는다.
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
