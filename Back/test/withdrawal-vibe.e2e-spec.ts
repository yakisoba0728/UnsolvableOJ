import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { vi } from 'vitest';
import configured from '../src/database/data-source.js';
import { configureHttp } from '../src/configure-http.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UsersModule } from '../src/modules/users/users.module.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { EnterpriseModule } from '../src/modules/enterprise/enterprise.module.js';
import { VibeService } from '../src/modules/vibe/vibe.service.js';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { VibeRunner } from '../src/modules/vibe/vibe.runner.js';
import { editableFiles } from '../src/modules/vibe/vibe.catalog.js';

describe('withdrawal and retained enterprise Vibe evidence', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let auth: AuthService;
  const ids: string[] = [];
  const password = 'withdraw-vibe-password';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              CORS_ORIGIN: 'http://localhost:4173',
              JWT_ACCESS_EXPIRES_IN: '15m',
            }),
          ],
        }),
        TypeOrmModule.forRoot(configured.options),
        AuthModule,
        UsersModule,
        EnterpriseModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    if (ids.length)
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await app?.close();
  });
  async function account() {
    const username = `wv_${randomUUID().slice(0, 8)}`;
    const session = await auth.register({
      email: `${username}@example.com`,
      username,
      password,
    });
    ids.push(session.user.id);
    return session;
  }
  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .auth(token, { type: 'bearer' });
  async function assessment() {
    const owner = await account(),
      candidate = await account(),
      outsider = await account(),
      administrator = await account();
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [
      administrator.user.id,
    ]);
    const exam = (
      await post('enterprise/tests', owner.accessToken)
        .send({
          title: 'Retained evidence',
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          durationMin: 30,
          problemIds: [],
          vibeChallengeIds: ['post-search-v1'],
          inviteOnly: true,
          invitees: [candidate.user.username],
        })
        .expect(201)
    ).body;
    const attempt = (
      await post(
        `enterprise/join/${exam.inviteCode}/start`,
        candidate.accessToken,
      ).expect(201)
    ).body;
    const vibe = (
      await post(
        `enterprise/attempts/${attempt.id}/vibe/post-search-v1`,
        candidate.accessToken,
      ).expect(201)
    ).body;
    const path = `enterprise/tests/${exam.id}/attempts/${attempt.id}/vibe/${vibe.id}`;
    return {
      owner,
      candidate,
      outsider,
      administrator,
      exam,
      attempt,
      vibe,
      path,
    };
  }
  it('owner/admin can read preserved files and revisions after withdrawal, while outsiders and former candidate cannot', async () => {
    const a = await assessment();
    const assist = vi.spyOn(app.get(VibeAi), 'assist');
    const evaluate = vi.spyOn(app.get(VibeAi), 'evaluate');
    const run = vi.spyOn(app.get(VibeRunner), 'run');
    try {
      await get(a.path, a.owner.accessToken).expect(200);
      await db.query(
        'UPDATE enterprise_attempts SET finished_at=now() WHERE id=$1',
        [a.attempt.id],
      );
      await request(app.getHttpServer())
        .delete('/api/v1/auth/account')
        .auth(a.candidate.accessToken, { type: 'bearer' })
        .send({ currentPassword: password, confirmation: '회원 탈퇴' })
        .expect(204);
      for (const staff of [a.owner, a.administrator]) {
        await get(a.path, staff.accessToken)
          .expect(200)
          .expect(({ body }) => {
            expect(body.candidate.id).toBe(a.candidate.user.id);
            expect(body.candidate.username).toMatch(/^탈퇴한사용자_/);
            expect(body.revisions).toHaveLength(1);
            expect(body.canGrade).toBe(false);
            expect(body.files).toEqual(a.vibe.files);
          });
        await get(`${a.path}/revisions/0`, staff.accessToken)
          .expect(200)
          .expect(({ body }) => expect(body.files).toEqual(editableFiles()));
      }
      await get(a.path, a.outsider.accessToken).expect(404);
      await get(`${a.path}/revisions/0`, a.outsider.accessToken).expect(404);
      await get(`vibe/attempts/${a.vibe.id}`, a.candidate.accessToken).expect(
        401,
      );
      await get(a.path, a.candidate.accessToken).expect(401);
      await post(`${a.path}/evaluation`, a.owner.accessToken).expect(409);
      await post(`${a.path}/evaluation`, a.administrator.accessToken).expect(
        409,
      );
      expect(run).not.toHaveBeenCalled();
      expect(assist).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      assist.mockRestore();
      evaluate.mockRestore();
      run.mockRestore();
    }
  });
  it('removing an invitation still blocks candidate operations without blocking authorized staff review', async () => {
    const a = await assessment();
    await db.query(
      "UPDATE enterprise_tests SET invite_user_ids='{}',invite_emails='{}' WHERE id=$1",
      [a.exam.id],
    );
    await get(`vibe/attempts/${a.vibe.id}`, a.candidate.accessToken).expect(
      404,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/vibe/attempts/${a.vibe.id}/files`)
      .auth(a.candidate.accessToken, { type: 'bearer' })
      .send({ revision: 0, files: a.vibe.files })
      .expect(404);
    await get(a.path, a.owner.accessToken).expect(200);
    await get(`${a.path}/revisions/0`, a.administrator.accessToken).expect(200);
    await get(
      a.path.replace(a.attempt.id, randomUUID()),
      a.owner.accessToken,
    ).expect(404);
    await get(
      a.path.replace(a.exam.id, randomUUID()),
      a.administrator.accessToken,
    ).expect(404);
  });
  it('staff-only reads independently validate the current database role, owner and token version', async () => {
    const a = await assessment(),
      vibe = app.get(VibeService);
    const tokenVersion = app
      .get(JwtService)
      .decode(a.administrator.accessToken).tokenVersion;
    await expect(
      vibe.reviewForStaff(a.vibe.id, a.candidate.user.id, {
        id: a.outsider.user.id,
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow();
    await expect(
      vibe.revisionForStaff(a.vibe.id, a.candidate.user.id, 0, {
        id: a.outsider.user.id,
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow();
    await db.query(
      "UPDATE users SET role='USER',token_version=token_version+1 WHERE id=$1",
      [a.administrator.user.id],
    );
    await expect(
      vibe.reviewForStaff(a.vibe.id, a.candidate.user.id, {
        id: a.administrator.user.id,
        role: UserRole.ADMIN,
        tokenVersion,
      }),
    ).rejects.toThrow();
    const standalone = (
      await post(
        'vibe/challenges/post-search-v1/attempts',
        a.candidate.accessToken,
      ).expect(201)
    ).body;
    await expect(
      vibe.reviewForStaff(standalone.id, a.candidate.user.id, {
        id: a.owner.user.id,
        role: UserRole.USER,
      }),
    ).rejects.toThrow();
  });
});
