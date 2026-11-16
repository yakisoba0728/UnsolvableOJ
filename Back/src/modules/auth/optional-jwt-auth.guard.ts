import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from './auth.types.js';

/** 공개 API는 유효한 일반 로그인만 연결하고, 비밀번호 변경 대기 계정도 비로그인으로 처리한다. */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_error: unknown, user: TUser): TUser {
    if ((user as AuthenticatedUser | undefined)?.mustChangePassword)
      return undefined as TUser;
    return user || (undefined as TUser);
  }
}
