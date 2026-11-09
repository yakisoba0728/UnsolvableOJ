import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DataSource, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import type { User } from '../users/user.entity.js';
import { AdminService } from './admin.service.js';
import type { AuditEvent } from './audit-event.entity.js';

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
      service: new AdminService(
        db as unknown as DataSource,
        {} as Queue,
        {} as Repository<User>,
        {} as Repository<AuditEvent>,
      ),
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

  it('rejects self-suspension before opening a transaction', async () => {
    const { service, db } = setup();
    await expect(
      service.changeSuspension(id.toUpperCase(), true, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses to suspend when the actor is no longer an active admin', async () => {
    const { service, manager } = setup();
    const otherId = '23456789-abcd-4abc-8abc-123456789abc';
    // 잠근 행에 수행자가 없다 = 그 사이 정지되었거나 관리자가 아니다.
    manager.query.mockResolvedValueOnce([
      { id: otherId, role: UserRole.ADMIN, suspendedAt: null },
    ]);
    await expect(
      service.changeSuspension(otherId, true, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.query).toHaveBeenCalledOnce();
  });
});
