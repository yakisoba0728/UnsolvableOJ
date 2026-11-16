import { describe, expect, it } from 'vitest';
import {
  buildEnterpriseVibeScores,
  type EnterpriseVibeRow,
} from './enterprise-vibe-scores.js';
import type { VibeReport } from '../vibe/vibe.types.js';

const complete: VibeReport = {
  outcome: 40, passed: 4, total: 5,
  prompt: { score: 20, feedback: '', evidence: [] },
  process: { score: 21, feedback: '', evidence: [] },
  evaluationStatus: 'complete', model: 'fixture', reflection: '', checks: [],
};
const row = (attempt: string, task: string, patch: Partial<EnterpriseVibeRow> = {}): EnterpriseVibeRow => ({
  id: `${attempt}/${task}`, enterprise_attempt_id: attempt, challenge_id: task,
  submitted_at: new Date('2026-01-01T00:00:00Z'), report: complete, ...patch,
});

describe('enterprise vibe result assembly', () => {
  it('retains requested candidate and task order regardless of database row order', () => {
    const rows = [row('b', 'two'), row('a', 'one'), row('b', 'one'), row('unrequested', 'two')];
    const scores = buildEnterpriseVibeScores(['two', 'one'], ['b', 'a'], rows);
    expect([...scores.keys()]).toEqual(['b', 'a']);
    expect(scores.get('b')?.map((score) => score.id)).toEqual(['b/two', 'b/one']);
    expect(scores.get('a')?.map((score) => score.id)).toEqual([null, 'a/one']);
    expect(scores.get('b')?.map((score) => score.score)).toEqual([81, 81]);
  });

  it('distinguishes unstarted, working, unevaluated, and completed tasks', () => {
    const scores = buildEnterpriseVibeScores(['one'], ['missing', 'working', 'pending', 'complete'], [
      row('working', 'one', { submitted_at: null, report: null }),
      row('pending', 'one', { report: { ...complete, evaluationStatus: 'unavailable', prompt: null, process: null } }),
      row('complete', 'one'),
    ]);
    expect([...scores.values()].map(([score]) => [score.status, score.score])).toEqual([
      ['not_started', 0], ['working', null], ['pending', null], ['complete', 81],
    ]);
  });

  it('does not mutate input rows or mix separate candidates with equal challenge IDs', () => {
    const rows = Object.freeze([Object.freeze(row('a', 'one')), Object.freeze(row('b', 'one', { report: null }))]);
    const scores = buildEnterpriseVibeScores(Object.freeze(['one']), Object.freeze(['a', 'b']), rows);
    expect(scores.get('a')?.[0].score).toBe(81);
    expect(scores.get('b')?.[0].score).toBeNull();
    expect(buildEnterpriseVibeScores([], ['a'], rows).get('a')).toEqual([]);
    expect(buildEnterpriseVibeScores(['one'], [], rows).size).toBe(0);
  });

  it('preserves first-row selection when a malformed input repeats a unique key', () => {
    const scores = buildEnterpriseVibeScores(['one'], ['a'], [row('a', 'one'), row('a', 'one', { id: 'duplicate', report: null })]);
    expect(scores.get('a')?.[0].id).toBe('a/one');
    expect(scores.get('a')?.[0].score).toBe(81);
  });
});
