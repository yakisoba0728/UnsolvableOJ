import { UnauthorizedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../modules/auth/auth.types.js';

/**
 * Revalidate a mutating actor inside its transaction. Call at the existing user
 * lock position: callers remain responsible for the surrounding lock order.
 * NO KEY UPDATE serializes account changes and quotas without blocking the
 * KEY SHARE checks taken by child-row foreign keys.
 */
export async function lockActiveActor(manager: EntityManager, user: AuthenticatedUser) {
  const [active]: { id: string }[] = await manager.query(
    `SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL
       AND suspended_at IS NULL AND NOT must_change_password
       AND ($2::integer IS NULL OR token_version=$2) FOR NO KEY UPDATE`,
    [user.id, user.tokenVersion ?? null],
  );
  if (!active) throw new UnauthorizedException('다시 로그인해야 합니다.');
  if (user.sessionId) {
    // Logout does not change token_version. A fresh statement after the
    // user-first revocation lock sees both revocations and rotation successors.
    const [live] = await manager.query(
      `SELECT 1 FROM refresh_tokens WHERE family_id=$1 AND user_id=$2
         AND revoked_at IS NULL AND expires_at > clock_timestamp() LIMIT 1`,
      [user.sessionId, user.id],
    );
    if (!live) throw new UnauthorizedException('다시 로그인해야 합니다.');
  }
}
