import { dayKey } from "../hooks";

const names = ["일", "월", "화", "수", "목", "금", "토"];

/** 이번 주(일~토) 학습 여부. 제출 기록이 있는 날에 체크 표시. */
export function WeekStrip({ counts }: { counts: Map<string, number> }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      name: names[index],
      done: counts.has(dayKey(date)),
      today: dayKey(date) === dayKey(today),
      future: date > today && dayKey(date) !== dayKey(today),
    };
  });
  return (
    <ul className="week-strip" aria-label="이번 주 학습 기록">
      {days.map((day) => (
        <li
          key={day.name}
          className={`${day.done ? "done" : ""} ${day.today ? "today" : ""} ${day.future ? "future" : ""}`}
        >
          <span>{day.name}</span>
          <i aria-hidden="true">{day.done ? "✓" : ""}</i>
          <span className="sr-only">{day.done ? "학습함" : "학습 안 함"}</span>
        </li>
      ))}
    </ul>
  );
}
