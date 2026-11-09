import { analysisCatalog, publicQuestions } from './analysis-catalog.js';
import { currentStreak, kstDay, periods } from './mission-policy.js';

describe('mission calendar and learning catalog', () => {
  it('rolls the day at Korean midnight, not UTC or the browser timezone', () => {
    expect(kstDay(new Date('2026-10-26T14:59:59.999Z'))).toBe('2026-10-26');
    expect(kstDay(new Date('2026-10-26T15:00:00Z'))).toBe('2026-10-27');
  });
  it('uses Sunday-start weeks across month/year boundaries and leap days', () => {
    const p = periods(new Date('2027-01-01T01:00:00Z'));
    expect(p.week.toISOString()).toBe('2026-12-26T15:00:00.000Z');
    expect(p.weekEnd.toISOString()).toBe('2027-01-02T15:00:00.000Z');
    expect(p.monthEnd.toISOString()).toBe('2027-01-31T15:00:00.000Z');
    expect(periods(new Date('2028-02-28T15:00:00Z')).dayEnd.toISOString()).toBe(
      '2028-02-29T15:00:00.000Z',
    );
    expect(periods(new Date('2026-10-24T15:00:00Z')).week.toISOString()).toBe(
      '2026-10-24T15:00:00.000Z',
    );
  });
  it('keeps the same streak key until a whole day is missed, ignoring duplicates/future dates', () => {
    expect(
      currentStreak(
        [
          '2026-10-26',
          '2026-10-25',
          '2026-10-25',
          '2026-10-24',
          '2026-10-22',
          '2026-10-29',
        ],
        '2026-10-26',
      ),
    ).toEqual({ count: 3, start: '2026-10-24' });
    expect(currentStreak(['2026-10-25', '2026-10-24'], '2026-10-26')).toEqual({
      count: 2,
      start: '2026-10-24',
    });
    expect(currentStreak(['2026-10-24'], '2026-10-26')).toEqual({
      count: 0,
      start: '2026-10-26',
    });
  });
  it('keeps analysis answers valid and out of the public question list', () => {
    expect(new Set(analysisCatalog.map((q) => q.id)).size).toBe(
      analysisCatalog.length,
    );
    for (const q of analysisCatalog) {
      expect(q.options[q.answer]).toBeDefined();
      expect(q.explanation.length).toBeGreaterThan(0);
    }
    expect(publicQuestions).toHaveLength(analysisCatalog.length);
    expect(
      publicQuestions.some(
        (q) => 'answer' in q || 'explanation' in q || 'concepts' in q,
      ),
    ).toBe(false);
  });
});
