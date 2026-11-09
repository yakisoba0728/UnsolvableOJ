import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from './auth.types.js';

const ALLOW_PENDING_PASSWORD_CHANGE = 'allowPendingPasswordChange';
/** 임시 비밀번호로 로그인해 아직 비밀번호를 바꾸지 않은 계정도 쓸 수 있는 API(계정 설정). */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

export const passwordChangeRequiredMessage =
  '임시 비밀번호로 로그인했습니다. 계정 설정에서 비밀번호를 먼저 바꿔 주세요.';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    // 401이면 웹이 토큰을 갱신하다 로그아웃시키므로 403으로 알린다.
    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(
        ALLOW_PENDING_PASSWORD_CHANGE,
        [context.getHandler(), context.getClass()],
      )
    )
      throw new ForbiddenException(passwordChangeRequiredMessage);
    return true;
  }
}
