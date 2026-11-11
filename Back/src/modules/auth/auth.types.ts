import type { UserRole } from '../users/user-role.enum.js';

export interface AuthenticatedUser {
  tokenVersion?: number;
  id: string;
  role: UserRole;
  /** 임시 비밀번호를 받은 뒤 아직 바꾸지 않았다. */
  mustChangePassword?: boolean;
  /** 이 access token이 속한 로그인(refresh token 계열 family_id). 옛 토큰에는 없다. */
  sessionId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  tokenVersion: number;
  /** refresh token 계열(family_id). 그 로그인을 끊으면 이 access token도 바로 거절된다. */
  sid?: string;
}
