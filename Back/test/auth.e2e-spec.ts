import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { base, closeApp, createApp, register } from './helpers.js';

// 회원가입 요청 제한(분당 5회)을 다른 시나리오와 나누도록 앱을 따로 띄웁니다.
describe('Registration (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  it('rejects usernames that differ only by case and keeps the typed name', async () => {
    const suffix = randomUUID().slice(0, 8);
    const first = await register(app, 'Case', suffix);
    expect(first.user.username).toBe(`Case_${suffix}`);
    for (const username of [`case_${suffix}`, `CASE_${suffix}`, 'BOJ_Import'])
      await request(app.getHttpServer())
        .post(`${base}/auth/register`)
        .send({
          email: `${username}-${suffix}-other@example.com`,
          username,
          password: 'test-password-123',
        })
        .expect(409)
        .expect(({ body }) =>
          expect(body.message).toBe(
            '이미 사용 중인 이메일 또는 사용자 이름입니다.',
          ),
        );
  });

  afterAll(async () => {
    await closeApp(app, []);
  });
});
