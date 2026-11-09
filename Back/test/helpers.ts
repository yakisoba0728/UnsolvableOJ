import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import { configureHttp } from '../src/configure-http.js';

export const base = '/api/v1';
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const password = 'test-password-123';

// 속도 제한 카운터는 Redis에 남으므로, 앞선 파일의 요청 수를 물려받지 않게 앱마다 비운다.
async function resetThrottle() {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    db: Number(process.env.REDIS_DB),
  });
  try {
    const keys = await redis.keys('throttle:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    await redis.quit();
  }
}

export async function createApp() {
  await resetThrottle();
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  configureHttp(app);
  return app;
}

// The runner drops the disposable database, but Redis jobs outlive the run.
export async function closeApp(
  app: NestExpressApplication | undefined,
  jobIds: string[],
) {
  if (!app) return;
  try {
    const queue = app.get<Queue>(getQueueToken(JUDGE_QUEUE));
    for (const id of jobIds) await (await queue.getJob(id))?.remove();
  } finally {
    await app.close();
  }
}

export async function register(
  app: NestExpressApplication,
  name: string,
  suffix: string,
) {
  const { body } = await request(app.getHttpServer())
    .post(`${base}/auth/register`)
    .send({
      email: `${name}-${suffix}@example.com`,
      username: `${name}_${suffix}`,
      password,
    })
    .expect(201);
  return body;
}

export async function login(app: NestExpressApplication, email: string) {
  const { body } = await request(app.getHttpServer())
    .post(`${base}/auth/login`)
    .send({ email, password })
    .expect(200);
  return body;
}
