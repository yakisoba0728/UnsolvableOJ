import type { UserRole } from '../users/user-role.enum.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  tokenVersion: number;
}
