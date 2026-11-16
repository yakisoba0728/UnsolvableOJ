/** Whole-assessment export; exceeding the cap fails instead of truncating. */
export const ENTERPRISE_EXPORT_LIMIT = 5_000;

export interface EnterpriseExportRow {
  username: string;
  started_at: Date;
  deadline_at: Date;
  finished_at: Date | null;
  status: 'ACTIVE' | 'FINISHED' | 'EXPIRED';
  solved: number;
  score: number | null;
}

/** Quote every cell; quoted spreadsheet formulas still need literalization. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  // Ignore leading whitespace/control/format characters when checking formula
  // triggers. Tabs/newlines can also be interpreted as formula prefixes by CSV
  // consumers. An apostrophe makes the entire untrusted cell literal text.
  if (typeof value === 'string' && /^(?:[\s\p{Cc}\p{Cf}]*[=+@\-＝＋＠－]|[\t\r\n])/u.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function enterpriseResultsCsv(rows: EnterpriseExportRow[], algorithmTasks: number): string {
  const columns = [
    'username', 'started_at_utc', 'deadline_at_utc', 'finished_at_utc',
    'attempt_status', 'solved_algorithm_tasks', 'total_algorithm_tasks',
    'score_0_100', 'evaluation_status',
  ];
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.username, row.started_at.toISOString(), row.deadline_at.toISOString(),
      row.finished_at?.toISOString() ?? null, row.status, row.solved, algorithmTasks,
      row.score, row.score === null ? 'PENDING' : 'SCORED',
    ].map(csvCell).join(','));
  }
  // UTF-8 BOM supports Korean usernames in spreadsheet importers. CRLF plus
  // doubled quotes preserves commas/newlines without creating extra columns.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
