import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// An explicit aggregate limit, separate from the per-field DTO limits.
export const JSON_BODY_LIMIT = 16 * 1024 * 1024;

export const MALFORMED_JSON_MESSAGE =
  '요청 본문이 올바른 JSON 형식이 아닙니다.';

/**
 * body-parser가 JSON을 읽지 못했을 때(entity.parse.failed) 파서의 내부 메시지
 * (`Unexpected token 'n', "not json" is not valid JSON`)를 그대로 돌려주지 않고 고정 문구로 답한다.
 * 그 밖의 오류는 기본 필터가 처리한다.
 */
@Catch()
class MalformedJsonFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Nest는 파서 오류를 BadRequestException으로 감싸 원래 오류를 cause에 둔다.
    const isParseError = (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      (error as { type?: unknown }).type === 'entity.parse.failed';
    const parseFailed =
      isParseError(exception) ||
      isParseError((exception as { cause?: unknown } | null)?.cause);
    super.catch(
      parseFailed ? new BadRequestException(MALFORMED_JSON_MESSAGE) : exception,
      host,
    );
  }
}

export function configureHttp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const trustedProxies = config.get<string>('TRUST_PROXY', '').trim();
  if (trustedProxies) app.set('trust proxy', trustedProxies);
  app.use(helmet());
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useGlobalFilters(
    new MalformedJsonFilter(app.get(HttpAdapterHost).httpAdapter),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
