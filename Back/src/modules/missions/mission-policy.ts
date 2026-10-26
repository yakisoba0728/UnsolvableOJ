export const DAY = 86_400_000;
const OFFSET = 9 * 60 * 60 * 1000;
export const kstDay = (now: Date) =>
  new Date(now.getTime() + OFFSET).toISOString().slice(0, 10);
export function periods(now: Date) {
  const day = kstDay(now);
  const start = new Date(`${day}T00:00:00+09:00`);
  const local = new Date(now.getTime() + OFFSET);
  const week = new Date(start.getTime() - local.getUTCDay() * DAY);
  const month = new Date(`${day.slice(0, 7)}-01T00:00:00+09:00`);
  const monthEnd = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - OFFSET,
  );
  return {
    day,
    start,
    week,
    month,
    dayEnd: new Date(start.getTime() + DAY),
    weekEnd: new Date(week.getTime() + 7 * DAY),
    monthEnd,
  };
}
export function currentStreak(days: string[], today: string) {
  const sorted = [...new Set(days)]
    .filter((d) => d <= today)
    .sort()
    .reverse();
  const midnight = (d: string) => Date.parse(`${d}T00:00:00Z`);
  if (!sorted[0] || midnight(today) - midnight(sorted[0]) > DAY)
    return { count: 0, start: today };
  let count = 1;
  while (
    count < sorted.length &&
    midnight(sorted[count - 1]) - midnight(sorted[count]) === DAY
  )
    count++;
  return { count, start: sorted[count - 1] };
}
export const definitions = [
  {
    id: 'daily',
    period: 'day',
    title: '일일 미션',
    description: '오늘 문제 5개 해결하기',
    target: 5,
    xp: 50,
  },
  {
    id: 'analysis',
    period: 'day',
    title: '코드 분석 워밍업',
    description: '오늘 서로 다른 분석 문제 5개 답 확인하기',
    target: 5,
    xp: 80,
  },
  {
    id: 'night',
    period: 'day',
    title: '심야 코더',
    description: '한국 시간 자정~새벽 6시에 제출 3회',
    target: 3,
    xp: 0,
  },
  {
    id: 'weekly',
    period: 'week',
    title: '주간 챌린지',
    description: '이번 주 문제 10개 해결하기',
    target: 10,
    xp: 300,
  },
  {
    id: 'community',
    period: 'month',
    title: '커뮤니티 기여',
    description: '이번 달 풀이 글 2개 쓰기',
    target: 2,
    xp: 150,
  },
  {
    id: 'streak',
    period: 'streak',
    title: '연속 학습',
    description: '제출한 날이 7일 연속 이어지기',
    target: 7,
    xp: 120,
  },
  {
    id: 'bonus',
    period: 'day',
    title: '오늘의 보너스 문제',
    description: '지정된 문제를 오늘 처음 해결하기',
    target: 1,
    xp: 0,
  },
] as const;
export type MissionKey = (typeof definitions)[number]['id'];
export const badgeNames: Record<string, string> = {
  'night-coder': '심야 코더',
  'seven-day-streak': '7일 연속 학습',
};
