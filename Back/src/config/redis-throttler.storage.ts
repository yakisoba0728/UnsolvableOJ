import type { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

// 고정 창 카운터: 첫 요청에서 만료를 걸고, limit을 넘으면 blockDuration 동안 차단 키를 둡니다.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, redis.call('PTTL', KEYS[1]), blocked}
`;

/** API 인스턴스가 여러 개여도 같은 Redis에서 IP별 요청 수를 공유합니다. */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ) {
    const [hits, expiresMs, blockedMs] = (await this.redis.eval(
      INCREMENT,
      2,
      `throttle:${key}`,
      `throttle:${key}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number];
    // 기본 메모리 저장소처럼 남은 시간은 초 단위입니다.
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(expiresMs / 1000),
      isBlocked: blockedMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockedMs / 1000)),
    };
  }

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
