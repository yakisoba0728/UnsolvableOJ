import { describe, expect, it } from 'vitest';
import { UserRole } from '../users/user-role.enum.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';

describe('optional authentication visibility', () => {
  const guard = new OptionalJwtAuthGuard();

  it.each([UserRole.ADMIN, UserRole.AUTHOR, UserRole.USER])(
    'does not attach a pending-password %s principal to public routes',
    (role) => {
      expect(
        guard.handleRequest(null, {
          id: 'fixture',
          role,
          mustChangePassword: true,
        }),
      ).toBeUndefined();
    },
  );

  it('preserves healthy users and older principals without a password-change flag', () => {
    for (const user of [
      { id: 'active', role: UserRole.ADMIN, mustChangePassword: false },
      { id: 'legacy', role: UserRole.USER },
    ])
      expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('retains anonymous access for missing or invalid credentials', () => {
    expect(guard.handleRequest(null, undefined)).toBeUndefined();
    expect(
      guard.handleRequest(new Error('invalid credential'), false),
    ).toBeUndefined();
  });
});
