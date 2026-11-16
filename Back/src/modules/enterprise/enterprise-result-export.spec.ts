import { csvCell, enterpriseResultsCsv } from './enterprise-result-export.js';

describe('spreadsheet-safe enterprise CSV', () => {
  it.each(['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\u200b=1+1', '\u0001+1', '＝1+1', '＋1+1', '＠SUM(1)', '－1+1'])('literalizes dangerous text prefix %j', (input) => {
    expect(csvCell(input)).toBe(`"'${input.replaceAll('"', '""')}"`);
  });

  it('preserves Unicode, commas, quotes, CRLF and distinguishes pending from a zero score', () => {
    expect(csvCell('홍길동,"별명"\r\n둘째 줄')).toBe('"홍길동,""별명""\r\n둘째 줄"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(null)).toBe('""');
    const common = { username: '한글', started_at: new Date('2026-11-01T00:00:00Z'),
      deadline_at: new Date('2026-11-01T01:00:00Z'), finished_at: null,
      status: 'ACTIVE' as const, solved: 0 };
    const csv = enterpriseResultsCsv([{ ...common, score: null }, { ...common, score: 0 }], 2);
    expect(csv.startsWith('\uFEFF"username",')).toBe(true);
    expect(csv).toContain('"2026-11-01T00:00:00.000Z"');
    expect(csv).toContain('"ACTIVE","0","2","","PENDING"\r\n');
    expect(csv).toContain('"ACTIVE","0","2","0","SCORED"\r\n');
    expect(csv).not.toMatch(/source|email|invite|token|workspace/i);
  });

  it('exports a header-only CSV for an assessment with no candidates', () => {
    const csv = enterpriseResultsCsv([], 1);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"evaluation_status"\r\n');
  });
});
