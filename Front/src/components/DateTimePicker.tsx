import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";

interface DateTimePickerProps {
  /** `YYYY-MM-DDTHH:mm` 형식(datetime-local 과 같은 값). 비어 있으면 "" */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  /** 팝오버를 입력창의 오른쪽 끝에 맞춘다(오른쪽 칸에서 화면 밖으로 나가지 않도록) */
  align?: "left" | "right";
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

interface TimeFieldProps {
  value: number;
  max: number;
  label: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onCommit: (value: number) => void;
  /** 두 자리를 다 입력했을 때(다음 칸으로 넘어가는 데 쓴다) */
  onFilled?: () => void;
  onEnter?: () => void;
}

/** 숫자를 직접 입력하는 칸. 범위를 넘는 숫자는 받지 않고, 칸을 떠나면 두 자리로 맞춘다. */
function TimeField({
  value,
  max,
  label,
  inputRef,
  onCommit,
  onFilled,
  onEnter,
}: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      ref={inputRef}
      className="dtp-time-input"
      inputMode="numeric"
      autoComplete="off"
      maxLength={2}
      placeholder="00"
      aria-label={label}
      value={draft ?? pad(value)}
      onFocus={(event) => {
        setDraft(pad(value));
        event.currentTarget.select();
      }}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 2);
        if (digits !== "" && Number(digits) > max) return;
        setDraft(digits);
        if (digits === "") return;
        onCommit(Number(digits));
        if (digits.length === 2) onFilled?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault(); // 폼 제출 대신 팝오버만 닫는다
          onEnter?.();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = value + (event.key === "ArrowUp" ? 1 : -1);
          const wrapped = (next + max + 1) % (max + 1);
          onCommit(wrapped);
          setDraft(pad(wrapped));
        }
      }}
    />
  );
}

interface Parts {
  y: number;
  m: number; // 0-11
  d: number;
  h: number;
  min: number;
}

function parse(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    y: Number(match[1]),
    m: Number(match[2]) - 1,
    d: Number(match[3]),
    h: Number(match[4]),
    min: Number(match[5]),
  };
}

function format({ y, m, d, h, min }: Parts) {
  return `${y}-${pad(m + 1)}-${pad(d)}T${pad(h)}:${pad(min)}`;
}

function display(parts: Parts) {
  return `${parts.y}. ${pad(parts.m + 1)}. ${pad(parts.d)}. ${pad(parts.h)}:${pad(parts.min)}`;
}

/** 시작·종료 일시를 고르는 달력. 운영체제 기본 달력 대신 사이트 디자인으로 그린다. */
export function DateTimePicker({
  value,
  onChange,
  id,
  placeholder = "날짜와 시간을 선택하세요",
  align = "left",
  ...aria
}: DateTimePickerProps) {
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 방향키로 옮긴 날짜. 날짜 칸 중 이 칸 하나만 Tab으로 들어간다.
  const [active, setActive] = useState<{ y: number; m: number; d: number } | null>(null);
  const selected = parse(value);
  const today = new Date();
  const [view, setView] = useState(() => ({
    y: selected?.y ?? today.getFullYear(),
    m: selected?.m ?? today.getMonth(),
  }));

  useEffect(() => {
    if (!open) return;
    // 바깥을 누르거나 키보드로 바깥(다른 달력 포함)에 포커스가 가면 닫는다.
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const base = parse(value);
      const now = new Date();
      setView({
        y: base?.y ?? now.getFullYear(),
        m: base?.m ?? now.getMonth(),
      });
      setActive(null);
    }
    setOpen(!open);
  };

  const shiftMonth = (delta: number) =>
    setView(({ y, m }) => {
      const next = new Date(y, m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });

  const base = (): Parts => {
    if (selected) return selected;
    const now = new Date();
    return {
      y: now.getFullYear(),
      m: now.getMonth(),
      d: now.getDate(),
      h: now.getHours(),
      min: 0,
    };
  };

  const pickDay = (y: number, m: number, d: number) => {
    const current = base();
    onChange(format({ ...current, y, m, d }));
    setView({ y, m });
  };

  const pickToday = () => {
    const now = new Date();
    const current = selected ?? { h: now.getHours(), min: now.getMinutes() };
    onChange(
      format({
        y: now.getFullYear(),
        m: now.getMonth(),
        d: now.getDate(),
        h: current.h,
        min: current.min,
      }),
    );
    setView({ y: now.getFullYear(), m: now.getMonth() });
  };

  // 6주(42칸) 고정 그리드: 앞뒤 달 날짜는 흐리게 보여 준다.
  const first = new Date(view.y, view.m, 1);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(view.y, view.m, 1 - first.getDay() + i);
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
  });
  const isToday = (c: { y: number; m: number; d: number }) =>
    c.y === today.getFullYear() &&
    c.m === today.getMonth() &&
    c.d === today.getDate();
  const tabDay = [active, selected].find(
    (c) => c && c.y === view.y && c.m === view.m,
  ) ?? { y: view.y, m: view.m, d: 1 };

  useEffect(() => {
    if (!active) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-date="${active.y}-${active.m}-${active.d}"]`,
      )
      ?.focus();
  }, [active]);

  const moveDay = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
      event.key
    ];
    const date = (event.target as HTMLElement).dataset.date;
    if (!step || !date) return;
    event.preventDefault();
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(y, m, d + step);
    const cell = { y: next.getFullYear(), m: next.getMonth(), d: next.getDate() };
    setActive(cell);
    setView({ y: cell.y, m: cell.m });
  };
  const isSelected = (c: { y: number; m: number; d: number }) =>
    !!selected &&
    c.y === selected.y &&
    c.m === selected.m &&
    c.d === selected.d;

  return (
    <div
      className={`dtp${open ? " open" : ""}${align === "right" ? " align-right" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        id={id}
        ref={buttonRef}
        className={`dtp-button${selected ? "" : " empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={toggle}
        {...aria}
      >
        <span className="dtp-value">
          {selected ? display(selected) : placeholder}
        </span>
        <CalendarDays size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="dtp-popover"
          id={dialogId}
          role="dialog"
          aria-label="날짜와 시간 선택"
        >
          <div className="dtp-calendar">
            <div className="dtp-head">
              <strong>
                {view.y}년 {view.m + 1}월
              </strong>
              <div className="dtp-nav">
                <button
                  type="button"
                  aria-label="이전 달"
                  onClick={() => shiftMonth(-1)}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="다음 달"
                  onClick={() => shiftMonth(1)}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="dtp-grid" ref={gridRef} onKeyDown={moveDay}>
              {WEEKDAYS.map((day) => (
                <span className="dtp-weekday" key={day} aria-hidden="true">
                  {day}
                </span>
              ))}
              {cells.map((cell) => (
                <button
                  type="button"
                  key={`${cell.y}-${cell.m}-${cell.d}`}
                  data-date={`${cell.y}-${cell.m}-${cell.d}`}
                  tabIndex={
                    cell.y === tabDay.y &&
                    cell.m === tabDay.m &&
                    cell.d === tabDay.d
                      ? 0
                      : -1
                  }
                  className={`dtp-day${cell.m !== view.m ? " outside" : ""}${
                    isToday(cell) ? " today" : ""
                  }${isSelected(cell) ? " selected" : ""}`}
                  aria-pressed={isSelected(cell)}
                  aria-label={`${cell.y}년 ${cell.m + 1}월 ${cell.d}일`}
                  onClick={() => pickDay(cell.y, cell.m, cell.d)}
                >
                  {cell.d}
                </button>
              ))}
            </div>
          </div>

          <div className="dtp-time">
            <span className="dtp-time-label">
              <Clock size={16} aria-hidden="true" />
              시간
            </span>
            <TimeField
              label="시"
              max={23}
              value={base().h}
              onCommit={(h) => onChange(format({ ...base(), h }))}
              onFilled={() => minuteRef.current?.focus()}
              onEnter={() => setOpen(false)}
            />
            <span aria-hidden="true">:</span>
            <TimeField
              label="분"
              max={59}
              inputRef={minuteRef}
              value={base().min}
              onCommit={(min) => onChange(format({ ...base(), min }))}
              onEnter={() => setOpen(false)}
            />
          </div>
          <p className="dtp-time-hint">
            24시간제로 입력해요. (예: 오후 3시 → 15)
          </p>

          <div className="dtp-foot">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              삭제
            </button>
            <button type="button" onClick={pickToday}>
              오늘
            </button>
            <button
              type="button"
              className="dtp-done"
              onClick={() => setOpen(false)}
            >
              확인
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
