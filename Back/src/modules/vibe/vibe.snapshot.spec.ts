import { describe, expect, it } from 'vitest';
import {
  BASELINE_SNAPSHOT,
  BASELINE_VERSION,
} from '../../database/migrations/1796000000000-vibe-challenge-versions.js';
import {
  currentVibeSnapshot,
  readVibeSnapshot,
  vibeVersion,
  type VibeChallengeSnapshot,
} from './vibe.snapshot.js';

describe('immutable Vibe assessment identity', () => {
  it('reproduces the frozen migration baseline without depending on JSONB object key order', () => {
    const content = structuredClone(BASELINE_SNAPSHOT) as VibeChallengeSnapshot;
    expect(vibeVersion(content)).toBe(BASELINE_VERSION);
    const reordered = JSON.parse(JSON.stringify(content), (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ) as VibeChallengeSnapshot;
    expect(
      readVibeSnapshot(BASELINE_VERSION, reordered, content.challenge.id),
    ).toEqual(content);
  });

  it('changes identity for every grading and candidate-facing contract component', () => {
    const content = currentVibeSnapshot();
    const originalVersion = vibeVersion(content);
    const mutations = [
      (c: VibeChallengeSnapshot) => {
        c.challenge.title += ' edited';
      },
      (c: VibeChallengeSnapshot) => {
        c.initialFiles['README.md'] += ' edited';
      },
      (c: VibeChallengeSnapshot) => {
        c.editablePaths.pop();
      },
      (c: VibeChallengeSnapshot) => {
        c.harness += '\n// edited';
      },
      (c: VibeChallengeSnapshot) => {
        c.publicChecks[0].expected = [42];
      },
      (c: VibeChallengeSnapshot) => {
        c.hiddenChecks.pop();
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(content);
      mutate(changed);
      expect(vibeVersion(changed)).not.toBe(originalVersion);
      expect(() =>
        readVibeSnapshot(originalVersion, changed, content.challenge.id),
      ).toThrow('고정된 과제');
    }
    expect(currentVibeSnapshot()).toEqual(content);
  });

  it('fails closed for missing content, wrong task identity and unsupported execution/review contracts', () => {
    const content = currentVibeSnapshot();
    expect(() =>
      readVibeSnapshot(BASELINE_VERSION, null, content.challenge.id),
    ).toThrow('고정된 과제');
    expect(() =>
      readVibeSnapshot(BASELINE_VERSION, content, 'unknown'),
    ).toThrow('고정된 과제');
    for (const key of [
      'formatVersion',
      'runnerVersion',
      'reviewVersion',
    ] as const) {
      const changed = {
        ...content,
        [key]: 'unsupported',
      } as unknown as VibeChallengeSnapshot;
      expect(() =>
        readVibeSnapshot(vibeVersion(changed), changed, content.challenge.id),
      ).toThrow('고정된 과제');
    }
  });
});
