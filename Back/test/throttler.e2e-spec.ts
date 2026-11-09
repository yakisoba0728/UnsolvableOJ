import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '../src/config/redis-throttler.storage.js';

describe('Redis throttler storage (e2e)', () => {
  const connect = () =>
    new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      db: Number(process.env.REDIS_DB),
    });
  // 두 API 인스턴스를 흉내 내는 별도 연결
  const first = new RedisThrottlerStorage(connect());
  const second = new RedisThrottlerStorage(connect());

  afterAll(async () => {
    await Promise.all([
      first.onApplicationShutdown(),
      second.onApplicationShutdown(),
    ]);
  });

  it('shares hit counts and blocks across instances', async () => {
    const key = `e2e-${randomUUID()}`;
    const hit = (storage: RedisThrottlerStorage) =>
      storage.increment(key, 60_000, 2, 60_000);

    expect(await hit(first)).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(await hit(second)).toMatchObject({
      totalHits: 2,
      isBlocked: false,
    });
    const blocked = await hit(first);
    expect(blocked).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(blocked.timeToExpire).toBeGreaterThan(0);
    expect(blocked.timeToExpire).toBeLessThanOrEqual(60);
    expect(blocked.timeToBlockExpire).toBe(60);
    expect(await hit(second)).toMatchObject({ isBlocked: true });
  });
});
