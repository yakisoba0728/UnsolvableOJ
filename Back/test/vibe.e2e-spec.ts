import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { base, bearer, createApp, register } from './helpers.js';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { VibeRunner } from '../src/modules/vibe/vibe.runner.js';
import { editableFiles } from '../src/modules/vibe/vibe.catalog.js';

describe('vibe practice flow', () => {
  let app: NestExpressApplication;
  let token: string;
  let otherToken: string;
  let id: string;
  let revision = 0;
  let ai: VibeAi;
  let runner: VibeRunner;
  const url = () => `${base}/vibe/attempts/${id}`;
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    const suffix = Date.now().toString(36);
    token = (await register(app, 'viber', suffix)).accessToken;
    otherToken = (await register(app, 'viber_other', suffix)).accessToken;
    ai = app.get(VibeAi);
    runner = app.get(VibeRunner);
    vi.spyOn(ai, 'available', 'get').mockReturnValue(true);
    vi.spyOn(runner, 'run').mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({
        name: i < 5 ? `공개 ${i}` : `숨김 테스트 ${i}`,
        passed: true,
      })),
    );
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  it('lists the task publicly without templates, hidden inputs or keys and requires login to start', async () => {
    const catalog = await request(app.getHttpServer())
      .get(`${base}/vibe/challenges`)
      .expect(200);
    expect(catalog.body.items[0].id).toBe('post-search-v1');
    expect(JSON.stringify(catalog.body)).not.toMatch(
      /OPENAI_API_KEY|hiddenChecks|initialFiles|harness/,
    );
    await request(app.getHttpServer())
      .post(`${base}/vibe/challenges/post-search-v1/attempts`)
      .expect(401);
    const created = await request(app.getHttpServer())
      .post(`${base}/vibe/challenges/post-search-v1/attempts`)
      .set(bearer(token))
      .expect(201);
    id = created.body.id;
    expect(created.body).not.toHaveProperty('model');
    expect(created.body).not.toHaveProperty('reasoning');
    expect(JSON.stringify(catalog.body)).not.toMatch(/gpt-6|medium/);
    expect(created.body.editablePaths).toHaveLength(3);
    const history = await request(app.getHttpServer())
      .get(`${base}/vibe/attempts`)
      .set(bearer(token))
      .expect(200);
    expect(history.body[0].report).toBeNull();
    const resumed = await request(app.getHttpServer())
      .post(`${base}/vibe/challenges/post-search-v1/attempts`)
      .set(bearer(token))
      .expect(201);
    expect(resumed.body.id).toBe(id);
    await request(app.getHttpServer())
      .get(url())
      .set(bearer(otherToken))
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/vibe/attempts`)
          .set(bearer(otherToken))
      ).body,
    ).toEqual([]);
  });

  it('validates editable paths, preserves newer revisions and records a reversible save', async () => {
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({
        revision,
        files: { ...editableFiles(), '../harness.ts': 'evil' },
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(otherToken))
      .send({ revision, files: editableFiles() })
      .expect(404);
    const files = {
      ...editableFiles(),
      'src/tags.ts':
        'export const matchesTag = (tags: string[], tag: string) => !tag || tags.includes(tag);\n',
    };
    const saved = await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision, files })
      .expect(200);
    revision = saved.body.revision;
    expect(revision).toBe(1);
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision: 0, files: editableFiles() })
      .expect(409);
    const undone = await request(app.getHttpServer())
      .post(`${url()}/undo`)
      .set(bearer(token))
      .send({ revision })
      .expect(201);
    revision = undone.body.revision;
    expect(undone.body.files['src/tags.ts']).toBe(
      editableFiles()['src/tags.ts'],
    );
  });

  it('records actual prompts and requires a fresh revision to apply AI changes', async () => {
    vi.spyOn(ai, 'assist').mockResolvedValue({
      text: '태그 비교를 먼저 수정합니다.',
      files: {
        'src/tags.ts':
          'export const matchesTag = (tags: string[], tag: string) => !tag || tags.includes(tag);\n',
      },
    });
    const chat = await request(app.getHttpServer())
      .post(`${url()}/messages`)
      .set(bearer(token))
      .send({
        revision,
        prompt: '태그 필터가 동작하도록 수정하고 테스트도 설명해 주세요.',
      })
      .expect(201);
    const messageId = chat.body.messages.at(-1).id;
    expect(chat.body.files['src/tags.ts']).toBe(editableFiles()['src/tags.ts']);
    const applied = await request(app.getHttpServer())
      .post(`${url()}/apply`)
      .set(bearer(token))
      .send({ revision, messageId })
      .expect(201);
    revision = applied.body.revision;
    expect(applied.body.files['src/tags.ts']).toContain('tags.includes(tag)');
    await request(app.getHttpServer())
      .post(`${url()}/apply`)
      .set(bearer(token))
      .send({ revision, messageId })
      .expect(409);
  });

  it('keeps public run evidence and preserves outcome scores when AI evaluation fails', async () => {
    const run = await request(app.getHttpServer())
      .post(`${url()}/runs`)
      .set(bearer(token))
      .send({ revision })
      .expect(201);
    expect(run.body.runs).toHaveLength(1);
    const evaluation = vi
      .spyOn(ai, 'evaluate')
      .mockRejectedValue(new Error('provider unavailable'));
    const submitted = await request(app.getHttpServer())
      .post(`${url()}/submit`)
      .set(bearer(token))
      .send({
        revision,
        reflection: '태그 필터의 기대 결과를 실행으로 확인했습니다.',
      })
      .expect(201);
    expect(submitted.body.report.outcome).toBe(40);
    expect(submitted.body.report.evaluationStatus).toBe('unavailable');
    expect(submitted.body.report.prompt).toBeNull();
    expect(submitted.body.report).not.toHaveProperty('model');
    expect(submitted.body.submittedAt).not.toBeNull();
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision, files: editableFiles() })
      .expect(409);
    evaluation.mockResolvedValue({
      prompt: {
        score: 20,
        feedback: '구체적인 지시가 있습니다.',
        evidence: [],
      },
      process: {
        score: 22,
        feedback: '공개 테스트로 변경을 검증했습니다.',
        evidence: [run.body.runs[0].id],
      },
    });
    const evaluated = await request(app.getHttpServer())
      .post(`${url()}/evaluation`)
      .set(bearer(token))
      .send({ revision })
      .expect(201);
    expect(evaluated.body.report.evaluationStatus).toBe('complete');
    expect(evaluated.body.report.process.score).toBe(22);
  });

  it('allows a saved snapshot to be submitted after expiry while rejecting edits and records a new attempt', async () => {
    const next = await request(app.getHttpServer())
      .post(`${base}/vibe/challenges/post-search-v1/attempts`)
      .set(bearer(token))
      .expect(201);
    id = next.body.id;
    revision = next.body.revision;
    await app
      .get(DataSource)
      .query(
        "UPDATE vibe_attempts SET deadline_at=now()-interval '1 second' WHERE id=$1",
        [id],
      );
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision, files: editableFiles() })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${url()}/submit`)
      .set(bearer(token))
      .send({ revision, reflection: '' })
      .expect(201);
  });

  it('blocks edits during a request and prevents a timed-out reply from overwriting a resumed edit', async () => {
    const next = await request(app.getHttpServer())
      .post(`${base}/vibe/challenges/post-search-v1/attempts`)
      .set(bearer(token))
      .expect(201);
    id = next.body.id;
    revision = next.body.revision;
    let finish!: (value: {
      text: string;
      files: Record<string, string>;
    }) => void;
    let called = false;
    vi.spyOn(ai, 'assist').mockImplementationOnce(() => {
      called = true;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = request(app.getHttpServer())
      .post(`${url()}/messages`)
      .set(bearer(token))
      .send({ revision, prompt: '현재 코드를 검토해 주세요.' })
      .then((response) => response);
    await vi.waitFor(() => expect(called).toBe(true));
    const files = {
      ...editableFiles(),
      'src/tags.ts': 'export const freshWork = true;\n',
    };
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision, files })
      .expect(409);
    await app
      .get(DataSource)
      .query(
        "UPDATE vibe_attempts SET busy_until=now()-interval '1 second' WHERE id=$1",
        [id],
      );
    await request(app.getHttpServer())
      .patch(`${url()}/files`)
      .set(bearer(token))
      .send({ revision, files })
      .expect(200);
    finish({
      text: '늦은 답변입니다.',
      files: { 'src/tags.ts': 'old proposal' },
    });
    expect((await pending).status).toBe(409);
    const current = await request(app.getHttpServer())
      .get(url())
      .set(bearer(token))
      .expect(200);
    expect(current.body.files['src/tags.ts']).toBe(files['src/tags.ts']);
    expect(current.body.messages).toHaveLength(0);
  });
});
