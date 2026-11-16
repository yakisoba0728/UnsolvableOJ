import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../users/user-role.enum.js';
import { CommunityService } from './community.service.js';

describe.each(['saved', 'follow'] as const)('community %s actor fencing', (kind) => {
  function setup(active: boolean, liveSession: boolean) {
    const user = { id: randomUUID(), role: UserRole.USER, tokenVersion: 1, sessionId: randomUUID() };
    const postId = randomUUID();
    const writes: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('INSERT INTO')) { writes.push(sql); return []; }
        if (sql.includes('FROM users')) return active ? [{ id: user.id }] : [];
        if (sql.includes('FROM refresh_tokens')) return liveSession ? [{}] : [];
        return [{ id: postId, hidden: false, authorId: randomUUID() }];
      }),
    };
    const db = { transaction: async (work: (value: typeof manager) => Promise<unknown>) => work(manager) };
    const service = new CommunityService(db as unknown as DataSource);
    vi.spyOn(service, 'interaction').mockResolvedValue({
      voted: false, saved: kind === 'saved', following: kind === 'follow', commentVotes: [],
    });
    return { writes, act: () => service.relationship(postId, user, kind, true) };
  }

  it('does not recreate a private relationship for an account revoked during a lock wait', async () => {
    const { act, writes } = setup(false, true);
    await expect(act()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(writes).toEqual([]);
  });

  it('does not accept a session revoked while the account remains active', async () => {
    const { act, writes } = setup(true, false);
    await expect(act()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(writes).toEqual([]);
  });

  it('preserves the eligible relationship response', async () => {
    const { act, writes } = setup(true, true);
    await expect(act()).resolves.toHaveProperty(kind === 'saved' ? 'saved' : 'following', true);
    expect(writes).toHaveLength(1);
  });
});
