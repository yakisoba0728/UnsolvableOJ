import { ConfigService } from '@nestjs/config';
import { Controller, Get, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { configureHttp, JSON_BODY_LIMIT } from './configure-http.js';
import { ProblemsController } from './modules/problems/problems.controller.js';
import { ProblemsService } from './modules/problems/problems.service.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';

describe('Public problem routes and HTTP limits', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProblemsController],
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({ CORS_ORIGIN: 'http://localhost:3001' }),
        },
        {
          provide: ProblemsService,
          useValue: { findPublishedBySlug: (slug: string) => ({ slug }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => false })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['mine', 'new', 'by-slug'])(
    'can retrieve the public problem named %s',
    async (slug) => {
      await request(app.getHttpServer())
        .get(`/api/v1/problems/by-slug/${slug}`)
        .expect(200)
        .expect({ slug });
    },
  );

  it('keeps the management route protected and old public links working', async () => {
    await request(app.getHttpServer()).get('/api/v1/problems/mine').expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/problems/old-problem')
      .expect(200)
      .expect({ slug: 'old-problem' });
  });

  it('retains an aggregate request size limit', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/problems')
      .send({ statementMarkdown: 'x'.repeat(JSON_BODY_LIMIT) })
      .expect(413);
  });

  it('keeps the reverse proxy body limit aligned with the API', () => {
    const nginx = readFileSync(
      new URL('../../Front/nginx.conf', import.meta.url),
      'utf8',
    );
    expect(nginx).toContain(
      `client_max_body_size ${JSON_BODY_LIMIT / (1024 * 1024)}m;`,
    );
    expect(nginx).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
  });
});

@Controller('proxy-probe')
class ProxyProbeController {
  @Get()
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe.each(['', 'loopback', '127.0.0.0/8, ::1/128'])(
  'HTTP proxy trust: %s',
  (trustedProxy) => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1 }]),
        ],
        controllers: [ProxyProbeController],
        providers: [
          { provide: APP_GUARD, useClass: ThrottlerGuard },
          {
            provide: ConfigService,
            useValue: new ConfigService({
              CORS_ORIGIN: 'http://localhost:3001',
              TRUST_PROXY: trustedProxy,
            }),
          },
        ],
      }).compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        logger: false,
      });
      configureHttp(app);
      await app.init();
    });
    afterAll(async () => {
      await app?.close();
    });

    it('separates trusted clients but ignores untrusted forwarded addresses', async () => {
      const path = '/api/v1/proxy-probe';
      await request(app.getHttpServer())
        .get(path)
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(200);
      await request(app.getHttpServer())
        .get(path)
        .set('X-Forwarded-For', '203.0.113.2')
        .expect(trustedProxy ? 200 : 429);
      await request(app.getHttpServer())
        .get(path)
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(429);
      if (trustedProxy) {
        await request(app.getHttpServer())
          .get(path)
          .set('X-Forwarded-For', '198.51.100.99, 203.0.113.3')
          .expect(200)
          .expect({ ip: '203.0.113.3' });
        await request(app.getHttpServer())
          .get(path)
          .set('X-Forwarded-For', '198.51.100.100, 203.0.113.3')
          .expect(429);
      }
    });
  },
);
