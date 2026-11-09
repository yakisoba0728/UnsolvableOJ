import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 공개 API에서 로그인했으면 사용자를 채우고, 토큰이 없거나 무효면 비로그인으로 처리한다. */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_error: unknown, user: TUser): TUser {
    return user || (undefined as TUser);
  }
}
