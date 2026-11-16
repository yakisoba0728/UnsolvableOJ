import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  challenge,
  editablePaths,
  harness,
  hiddenChecks,
  initialFiles,
  publicChecks,
} from './vibe.catalog.js';
import { VIBE_ASSIST_SYSTEM, VIBE_REVIEW_SYSTEM } from './vibe.prompts.js';
import type { ProjectFiles, VibeAttemptRow } from './vibe.types.js';

/** Server-only assessment content. Never spread this object into an API response. */
export interface VibeChallengeSnapshot {
  formatVersion: 1;
  runnerVersion: 'go-judge-esbuild-v1';
  reviewVersion: 'review-v1';
  assistSystem: string;
  reviewSystem: string;
  challenge: typeof challenge;
  initialFiles: ProjectFiles;
  editablePaths: string[];
  harness: string;
  publicChecks: { name: string; input: unknown; expected: unknown }[];
  hiddenChecks: { name: string; input: unknown; expected: unknown }[];
}

// JSONB does not preserve object key order. Hash a canonical representation so
// the exact same content has the same identity before and after a DB round trip.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function vibeVersion(snapshot: VibeChallengeSnapshot): string {
  return createHash('sha256').update(canonical(snapshot)).digest('hex');
}

/** Take a copy; published DB rows and existing attempts never follow live exports. */
export function currentVibeSnapshot(): VibeChallengeSnapshot {
  return structuredClone({
    formatVersion: 1,
    runnerVersion: 'go-judge-esbuild-v1',
    reviewVersion: 'review-v1',
    assistSystem: VIBE_ASSIST_SYSTEM,
    reviewSystem: VIBE_REVIEW_SYSTEM,
    challenge,
    initialFiles,
    editablePaths,
    harness,
    publicChecks,
    hiddenChecks,
  });
}

export function readVibeSnapshot(
  version: string,
  snapshot: VibeChallengeSnapshot | null | undefined,
  challengeId: string,
): VibeChallengeSnapshot {
  if (
    !snapshot ||
    snapshot.formatVersion !== 1 ||
    snapshot.runnerVersion !== 'go-judge-esbuild-v1' ||
    snapshot.reviewVersion !== 'review-v1' ||
    snapshot.challenge?.id !== challengeId ||
    !snapshot.initialFiles ||
    !Array.isArray(snapshot.editablePaths) ||
    !Array.isArray(snapshot.publicChecks) ||
    !Array.isArray(snapshot.hiddenChecks) ||
    snapshot.publicChecks.length + snapshot.hiddenChecks.length === 0 ||
    typeof snapshot.harness !== 'string' ||
    typeof snapshot.assistSystem !== 'string' ||
    typeof snapshot.reviewSystem !== 'string' ||
    vibeVersion(snapshot) !== version
  )
    throw new ServiceUnavailableException(
      '고정된 과제 버전을 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.',
    );
  return snapshot;
}

export const attemptSnapshot = (attempt: VibeAttemptRow) =>
  readVibeSnapshot(
    attempt.challenge_version,
    attempt.challenge_snapshot,
    attempt.challenge_id,
  );

export const snapshotEditableFiles = (
  snapshot: VibeChallengeSnapshot,
): ProjectFiles =>
  Object.fromEntries(
    snapshot.editablePaths.map((path) => [path, snapshot.initialFiles[path]]),
  );

export async function registerVibeSnapshot(manager: EntityManager) {
  const snapshot = currentVibeSnapshot();
  const version = vibeVersion(snapshot);
  await manager.query(
    `INSERT INTO vibe_challenge_versions(version,challenge_id,snapshot) VALUES($1,$2,$3)
     ON CONFLICT(version) DO NOTHING`,
    [version, snapshot.challenge.id, JSON.stringify(snapshot)],
  );
  const [stored]: { snapshot: VibeChallengeSnapshot }[] = await manager.query(
    'SELECT snapshot FROM vibe_challenge_versions WHERE version=$1 AND challenge_id=$2',
    [version, snapshot.challenge.id],
  );
  readVibeSnapshot(version, stored?.snapshot, snapshot.challenge.id);
  return { version, snapshot };
}
