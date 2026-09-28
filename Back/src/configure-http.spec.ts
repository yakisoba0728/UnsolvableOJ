import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
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
});
