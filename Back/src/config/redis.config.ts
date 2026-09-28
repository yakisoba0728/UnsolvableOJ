import type { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

export function redisConnection(config: ConfigService): RedisOptions {
  const username = config.get<string>('REDIS_USERNAME') || undefined;
  const password = config.get<string>('REDIS_PASSWORD') || undefined;

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    db: config.get<number>('REDIS_DB', 0),
    username,
    password,
    maxRetriesPerRequest: 1,
  };
}
