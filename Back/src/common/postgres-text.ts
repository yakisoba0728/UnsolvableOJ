import { Matches, type ValidationOptions } from 'class-validator';

// PostgreSQL text·jsonb는 NUL과 짝 없는 UTF-16 서로게이트를 저장하지 못해 500이 되므로 400으로 거절합니다.
export const IsPostgresText = (options?: ValidationOptions) =>
  Matches(/^[^\0\p{Cs}]*$/u, {
    message:
      '$property에는 NUL 문자나 짝이 맞지 않는 서로게이트 문자를 쓸 수 없습니다.',
    ...options,
  });
