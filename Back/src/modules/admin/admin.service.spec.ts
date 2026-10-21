import { ConflictException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import { AdminService } from './admin.service.js';

describe('AdminService.changeRole', () => {
  const id = '12345678-abcd-4abc-8abc-123456789abc';
  const actor: AuthenticatedUser = {
    id,
    role: UserRole.ADMIN,
  };

  function setup() {
    const manager = { query: vi.fn().mockResolvedValue([]) };
    const db = {
      transaction: vi.fn(
        async (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    return {
      service: new AdminService(db as unknown as DataSource, {} as Queue),
      db,
      manager,
    };
  }

  it.each([
    [id.toUpperCase(), id],
    [id, id.toUpperCase()],
    [id, id],
  ])('rejects self-demotion for target %s and actor %s', async (target, self) => {
    const { service, db } = setup();
    for (const role of [UserRole.USER, UserRole.AUTHOR]) {
      await expect(
        service.changeRole(target, role, { ...actor, id: self }),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('allows retaining the admin role without changing the account', async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([{ role: UserRole.ADMIN }]);
    await expect(
      service.changeRole(id.toUpperCase(), UserRole.ADMIN, actor),
    ).resolves.toEqual({ id: id.toUpperCase(), role: UserRole.ADMIN });
    expect(manager.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT role FROM users WHERE id = $1 FOR UPDATE',
      [id.toUpperCase()],
    );
  });

  it('still updates another user, invalidates tokens, and writes an audit event', async () => {
    const { service, manager } = setup();
    const otherId = '23456789-abcd-4abc-8abc-123456789abc';
    manager.query.mockResolvedValueOnce([{ role: UserRole.ADMIN }]);
    await expect(
      service.changeRole(otherId, UserRole.AUTHOR, actor),
    ).resolves.toEqual({ id: otherId, role: UserRole.AUTHOR });
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE users SET role = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2',
      [UserRole.AUTHOR, otherId],
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_events'),
      [
        actor.id,
        'user.role',
        'user',
        otherId,
        JSON.stringify({ from: UserRole.ADMIN, to: UserRole.AUTHOR }),
      ],
    );
  });
});
