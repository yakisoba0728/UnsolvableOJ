import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import type { VibeAi } from './vibe.ai.js';
import { VibeController } from './vibe.controller.js';
import type { VibeRunner } from './vibe.runner.js';
import { VibeService } from './vibe.service.js';
import {
  currentVibeSnapshot,
  snapshotEditableFiles,
  vibeVersion,
} from './vibe.snapshot.js';
import type { VibeAttemptRow } from './vibe.types.js';

const actor: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000002',
  role: UserRole.USER,
  tokenVersion: 7,
  sessionId: 'candidate-session',
};

function fixture(
  access: 'inactive' | 'revoked-session' | 'active',
  ownerDeleted = false,
) {
  const content = currentVibeSnapshot();
  const row: VibeAttemptRow = {
    id: 'attempt',
    user_id: actor.id,
    challenge_id: content.challenge.id,
    challenge_version: vibeVersion(content),
    challenge_snapshot: content,
    revision: 0,
    model: 'fixture-model',
    started_at: new Date(),
    deadline_at: new Date(Date.now() + 60_000),
    submitted_at: null,
    enterprise_attempt_id: null,
    operation_id: null,
    busy_until: null,
    state: {
      files: snapshotEditableFiles(content),
      undo: { ...snapshotEditableFiles(content), 'src/tags.ts': '// previous' },
      messages: [
        {
          id: 'proposal',
          role: 'assistant',
          text: '검토한 변경',
          baseRevision: 0,
          createdAt: new Date().toISOString(),
          files: { 'src/tags.ts': '// proposed' },
        },
      ],
      events: [],
      runs: [],
      report: null,
      aiRequests: 0,
      evaluations: 0,
    },
  };
  const writes: string[] = [];
  const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql.trimStart().startsWith('SELECT id,deleted_at FROM users ')) {
      const ids = parameters?.[0];
      if (!Array.isArray(ids)) throw new Error('Expected user IDs for row locks');
      return ids.map((id) => ({
        id,
        deleted_at: id === actor.id && ownerDeleted ? new Date() : null,
      }));
    }
    if (sql.trimStart().startsWith('SELECT id FROM users '))
      return access === 'inactive' ? [] : [{ id: parameters?.[0] }];
    if (sql.includes('FROM refresh_tokens'))
      return access === 'active' ? [{ live: 1 }] : [];
    if (/^(INSERT|UPDATE|WITH saved)/.test(sql)) writes.push(sql);
    if (sql.includes('count(*)')) return [{ count: 0 }];
    if (
      sql.includes('pg_advisory_xact_lock') ||
      sql.includes('INSERT INTO vibe_revisions')
    )
      return [];
    return [row];
  });
  const manager = { query };
  const db = {
    manager,
    query,
    transaction: async (
      callback: (transactionManager: typeof manager) => unknown,
    ) => callback(manager),
  } as unknown as DataSource;
  const ai = {
    available: true,
    assist: vi.fn(async () => ({ text: '검토했습니다.', files: {} })),
    evaluate: vi.fn(async () => ({
      prompt: { score: 1, feedback: '검토했습니다.', evidence: [] },
      process: { score: 1, feedback: '검토했습니다.', evidence: [] },
    })),
  };
  const runner = {
    available: true,
    run: vi.fn(async () =>
      [...content.publicChecks, ...content.hiddenChecks].map(({ name }) => ({
        name,
        passed: true,
      })),
    ),
  };
  const service = new VibeService(
    db,
    ai as unknown as VibeAi,
    runner as unknown as VibeRunner,
  );
  return {
    row,
    writes,
    query,
    ai,
    runner,
    service,
    controller: new VibeController(service),
  };
}

describe('Vibe mutation actor fencing after guard authentication', () => {
  for (const access of ['inactive', 'revoked-session'] as const) {
    it.each([
      'start',
      'save',
      'undo',
      'apply',
      'chat',
      'run',
      'submit',
      'evaluate',
    ] as const)(
      `rejects ${access} actors before %s can consume quota, call a provider or write`,
      async (action) => {
        const { row, writes, ai, runner, controller } = fixture(access);
        if (action === 'evaluate') {
          row.submitted_at = new Date();
          row.state.report = {
            outcome: 0,
            passed: 0,
            total: 11,
            prompt: null,
            process: null,
            model: row.model,
            evaluationStatus: 'unavailable',
            reflection: '',
            checks: [],
          };
        }
        const operation = () => {
          switch (action) {
            case 'start':
              return controller.start(row.challenge_id, actor);
            case 'save':
              return controller.save(row.id, actor, {
                revision: 0,
                files: { ...row.state.files, 'src/tags.ts': '// changed' },
              });
            case 'undo':
              return controller.undo(row.id, actor, { revision: 0 });
            case 'apply':
              return controller.apply(row.id, actor, {
                revision: 0,
                messageId: 'proposal',
              });
            case 'chat':
              return controller.chat(row.id, actor, {
                revision: 0,
                prompt: '검토해 주세요.',
              });
            case 'run':
              return controller.run(row.id, actor, { revision: 0 });
            case 'submit':
              return controller.submit(row.id, actor, {
                revision: 0,
                reflection: '',
              });
            case 'evaluate':
              return controller.evaluate(row.id, actor, { revision: 0 });
          }
        };
        await expect(operation()).rejects.toBeInstanceOf(UnauthorizedException);
        expect(writes).toEqual([]);
        expect(ai.assist).not.toHaveBeenCalled();
        expect(ai.evaluate).not.toHaveBeenCalled();
        expect(runner.run).not.toHaveBeenCalled();
      },
    );
  }

  it.each(['submit', 'evaluate'] as const)(
    'rejects staff %s when the candidate was deleted after the initial ownership read',
    async (kind) => {
      const { row, writes, ai, runner, service } = fixture('active', true);
      if (kind === 'evaluate') {
        row.submitted_at = new Date();
        row.state.report = {
          outcome: 0,
          passed: 0,
          total: 11,
          prompt: null,
          process: null,
          model: row.model,
          evaluationStatus: 'unavailable',
          reflection: '',
          checks: [],
        };
      }
      const retained = structuredClone(row);
      await expect(
        service.finalize(row.id, row.user_id, {
          id: '00000000-0000-4000-8000-000000000001',
          role: UserRole.ADMIN,
          tokenVersion: 9,
          sessionId: 'staff-session',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(row).toEqual(retained);
      expect(writes).toEqual([]);
      expect(ai.assist).not.toHaveBeenCalled();
      expect(ai.evaluate).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003',
  ])(
    'orders both user locks before validating staff %s and finalizing the owner',
    async (staffId) => {
      const { row, query, runner, service } = fixture('active');
      const staff: AuthenticatedUser = {
        id: staffId,
        role: UserRole.ADMIN,
        tokenVersion: 9,
        sessionId: 'staff-session',
      };
      const result = await service.finalize(row.id, row.user_id, staff);
      expect(result.id).toBe(row.id);
      expect(result.report?.outcome).toBe(40);
      expect(runner.run).toHaveBeenCalledOnce();
      const locked = query.mock.calls.filter(([sql]) =>
        sql.includes('FOR NO KEY UPDATE'),
      );
      expect(locked).toHaveLength(2);
      expect(locked[0][0]).toContain('ORDER BY id FOR NO KEY UPDATE');
      expect(locked[0][1]).toEqual([[staff.id, actor.id]]);
      expect(locked[1][1]).toEqual([staff.id, staff.tokenVersion]);
      expect(
        query.mock.calls.find(([sql]) =>
          sql.includes('FROM refresh_tokens'),
        )?.[1],
      ).toEqual([staff.sessionId, staff.id]);
      const lockIndex = query.mock.calls.findIndex(([sql]) =>
        sql.includes('FOR NO KEY UPDATE'),
      );
      const admissionIndex = query.mock.calls.findIndex(([sql]) =>
        sql.includes('vibe-operations'),
      );
      expect(admissionIndex).toBeGreaterThan(lockIndex);
      expect(
        query.mock.calls
          .filter(([sql]) => sql.includes('FROM vibe_attempts v'))
          .every(([, parameters]) => parameters?.[1] === actor.id),
      ).toBe(true);
    },
  );
});
