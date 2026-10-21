import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../users/user-role.enum.js';
import type { User } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import type { PasswordHasher } from './password-hasher.service.js';

describe('AuthService.register importer identity reservation', () => {
  function setup() {
    const users = {
      create: vi.fn((value: object) => ({
        ...value,
        id: '12345678-abcd-4abc-8abc-123456789abc',
        role: UserRole.USER,
        tokenVersion: 0,
        level: 1,
        xp: 0,
        rating: 0,
      })),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const passwordHasher = { hash: vi.fn().mockResolvedValue('hashed-password') };
    const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };
    const config = { get: vi.fn().mockReturnValue('15m') };
    return {
      service: new AuthService(
        users as unknown as Repository<User>,
        passwordHasher as unknown as PasswordHasher,
        jwt as unknown as JwtService,
        config as unknown as ConfigService,
      ),
      users,
      passwordHasher,
      jwt,
    };
  }

  it.each([
    { username: 'boj_import', email: 'human@example.com' },
    { username: '  boj_import  ', email: 'human@example.com' },
    { username: 'human', email: 'boj-import@unsolvable.local' },
    { username: 'human', email: '  BOJ-IMPORT@UNSOLVABLE.LOCAL  ' },
  ])('rejects reserved normalized identifiers: $username / $email', async (dto) => {
    const { service, users, passwordHasher, jwt } = setup();
    await expect(
      service.register({ ...dto, password: 'a-strong-password' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.create).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('keeps trim-only usernames and allows other email addresses on the same domain', async () => {
    const { service, users, passwordHasher } = setup();
    const session = await service.register({
      username: '  BOJ_IMPORT  ',
      email: '  HUMAN@UNSOLVABLE.LOCAL  ',
      password: 'a-strong-password',
    });
    expect(users.create).toHaveBeenCalledExactlyOnceWith({
      username: 'BOJ_IMPORT',
      email: 'human@unsolvable.local',
      passwordHash: 'hashed-password',
    });
    expect(passwordHasher.hash).toHaveBeenCalledExactlyOnceWith(
      'a-strong-password',
    );
    expect(users.save).toHaveBeenCalledOnce();
    expect(session.user).toMatchObject({
      username: 'BOJ_IMPORT',
      email: 'human@unsolvable.local',
      role: UserRole.USER,
    });
  });
});
