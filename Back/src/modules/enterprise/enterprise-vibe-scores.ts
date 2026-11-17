import { ServiceUnavailableException } from '@nestjs/common';
import type { VibeReport } from '../vibe/vibe.types.js';

export interface EnterpriseVibeRow {
  id: string;
  enterprise_attempt_id: string;
  challenge_id: string;
  submitted_at: Date | null;
  report: VibeReport | null;
}

/** Index the result set once instead of rescanning it for every candidate/task. */
export function buildEnterpriseVibeScores(
  challengeIds: readonly string[],
  attemptIds: readonly string[],
  rows: readonly EnterpriseVibeRow[],
  bindings: ReadonlyMap<string, { title: string; version: string }>,
) {
  const byAttempt = new Map<string, Map<string, EnterpriseVibeRow>>();
  for (const row of rows) {
    let tasks = byAttempt.get(row.enterprise_attempt_id);
    if (!tasks) {
      tasks = new Map();
      byAttempt.set(row.enterprise_attempt_id, tasks);
    }
    // The DB enforces uniqueness. Retain first-row semantics for a malformed fixture.
    if (!tasks.has(row.challenge_id)) tasks.set(row.challenge_id, row);
  }
  return new Map(
    attemptIds.map((id) => [
      id,
      challengeIds.map((challengeId) => {
        const binding = bindings.get(challengeId);
        if (!binding) throw new ServiceUnavailableException('고정된 과제 정보를 확인할 수 없습니다.');
        const row = byAttempt.get(id)?.get(challengeId);
        const report = row?.report;
        const score = !row
          ? 0
          : report?.evaluationStatus === 'complete'
            ? report.outcome + report.prompt!.score + report.process!.score
            : null;
        return {
          challengeId,
          title: binding.title,
          challengeVersion: binding.version,
          id: row?.id ?? null,
          submittedAt: row?.submitted_at ?? null,
          score,
          status: !row
            ? 'not_started'
            : !row.submitted_at
              ? 'working'
              : score === null
                ? 'pending'
                : 'complete',
        };
      }),
    ]),
  );
}
