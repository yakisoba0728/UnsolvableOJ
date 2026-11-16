import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BASELINE_SNAPSHOT,
  BASELINE_VERSION,
  VibeChallengeVersions1796000000000,
} from '../src/database/migrations/1796000000000-vibe-challenge-versions.js';
import {
  currentVibeSnapshot,
  vibeVersion,
} from '../src/modules/vibe/vibe.snapshot.js';
import { closeApp, createApp, register } from './helpers.js';

describe('Vibe content archive migration (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;
  const migration = new VibeChallengeVersions1796000000000();
  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    userId = (await register(app, 'vvmigrate', randomUUID().slice(0, 8))).user
      .id;
  });
  afterAll(() => closeApp(app, []));

  async function rolledBack(work: (q: QueryRunner) => Promise<void>) {
    const q = db.createQueryRunner();
    await q.connect();
    await q.startTransaction();
    try {
      // All deletion/drop actions belong to this rollback-only owned fixture.
      await q.query('DELETE FROM vibe_attempts');
      await q.query('DELETE FROM enterprise_tests');
      await migration.down(q);
      await work(q);
    } finally {
      await q.rollbackTransaction();
      await q.release();
    }
    expect(
      (
        await db.query(
          "SELECT to_regclass('vibe_challenge_versions')::text AS name",
        )
      )[0].name,
    ).toBe('vibe_challenge_versions');
  }
  async function test(q: QueryRunner, ids = ['post-search-v1']) {
    const [row]: { id: string }[] = await q.query(
      `INSERT INTO enterprise_tests(owner_id,title,starts_at,ends_at,duration_min,problem_ids,vibe_challenge_ids,invite_code)
       VALUES($1,'migration',now(),now()+interval '1 hour',30,'{}',$2,$3) RETURNING id`,
      [userId, ids, randomUUID().replaceAll('-', '')],
    );
    return row.id;
  }

  it('binds historical test and workspace at the recorded cutoff without rewriting saved code/revisions/results', async () => {
    await rolledBack(async (q) => {
      const testId = await test(q);
      const state = {
        files: { 'src/search.ts': 'historical code' },
        report: { outcome: 17 },
      };
      const [attempt]: { id: string }[] = await q.query(
        "INSERT INTO vibe_attempts(user_id,challenge_id,state,model,revision) VALUES($1,'post-search-v1',$2,'fixture',3) RETURNING id",
        [userId, state],
      );
      await q.query(
        "INSERT INTO vibe_revisions(attempt_id,revision,action,files) VALUES($1,3,'save',$2)",
        [attempt.id, state.files],
      );
      await migration.up(q);
      expect(
        await q.query(
          'SELECT challenge_id,version,position FROM enterprise_vibe_versions WHERE test_id=$1',
          [testId],
        ),
      ).toEqual([
        {
          challenge_id: 'post-search-v1',
          version: BASELINE_VERSION,
          position: 1,
        },
      ]);
      const [saved] = await q.query(
        'SELECT state,revision,challenge_version FROM vibe_attempts WHERE id=$1',
        [attempt.id],
      );
      expect(saved).toEqual({
        state,
        revision: 3,
        challenge_version: BASELINE_VERSION,
      });
      expect(
        (
          await q.query(
            'SELECT files FROM vibe_revisions WHERE attempt_id=$1 AND revision=3',
            [attempt.id],
          )
        )[0].files,
      ).toEqual(state.files);
      expect(
        (
          await q.query(
            'SELECT snapshot FROM vibe_challenge_versions WHERE version=$1',
            [BASELINE_VERSION],
          )
        )[0].snapshot,
      ).toEqual(BASELINE_SNAPSHOT);
      await migration.down(q);
      expect(
        (
          await q.query(
            'SELECT state,revision FROM vibe_attempts WHERE id=$1',
            [attempt.id],
          )
        )[0],
      ).toEqual({ state, revision: 3 });
      await migration.up(q);
      expect(
        (
          await q.query(
            'SELECT challenge_version FROM vibe_attempts WHERE id=$1',
            [attempt.id],
          )
        )[0].challenge_version,
      ).toBe(BASELINE_VERSION);
    });
  });

  it.each(['test', 'attempt'])(
    'refuses an unknown historical %s challenge atomically',
    async (kind) => {
      await rolledBack(async (q) => {
        if (kind === 'test') await test(q, ['unknown-contract']);
        else
          await q.query(
            "INSERT INTO vibe_attempts(user_id,challenge_id,state,model) VALUES($1,'unknown-contract','{}','fixture')",
            [userId],
          );
        await expect(migration.up(q)).rejects.toThrow(/missing Vibe challenge/);
      });
    },
  );

  async function historicalWorkspace(
    q: QueryRunner,
    testId: string,
    model: string,
  ) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const [user] = await q.query(
      "INSERT INTO users(email,username,password_hash) VALUES($1,$2,'fixture') RETURNING id",
      [`${suffix}@example.invalid`, suffix],
    );
    const [exam] = await q.query(
      "INSERT INTO enterprise_attempts(test_id,user_id,deadline_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING id",
      [testId, user.id],
    );
    const [workspace] = await q.query(
      "INSERT INTO vibe_attempts(user_id,challenge_id,state,model,enterprise_attempt_id) VALUES($1,'post-search-v1','{}',$2,$3) RETURNING id",
      [user.id, model, exam.id],
    );
    return workspace.id;
  }

  it('retains an observed historical model and refuses rollback into a different legacy model policy', async () => {
    await rolledBack(async (q) => {
      const testId = await test(q);
      const id = await historicalWorkspace(q, testId, 'observed-legacy-model');
      await migration.up(q);
      expect(
        (
          await q.query(
            'SELECT ai_model FROM enterprise_vibe_versions WHERE test_id=$1',
            [testId],
          )
        )[0].ai_model,
      ).toBe('observed-legacy-model');
      expect(
        (await q.query('SELECT model FROM vibe_attempts WHERE id=$1', [id]))[0]
          .model,
      ).toBe('observed-legacy-model');
      await expect(migration.down(q)).rejects.toThrow(
        /preserve assessment history/,
      );
    });
  });

  it('refuses conflicting historical models instead of inventing assessment equivalence', async () => {
    await rolledBack(async (q) => {
      const testId = await test(q);
      await historicalWorkspace(q, testId, 'legacy-first');
      await historicalWorkspace(q, testId, 'legacy-second');
      await expect(migration.up(q)).rejects.toThrow(/different Vibe models/);
    });
  });

  it('refuses archive mutation and deletion of referenced content', async () => {
    await rolledBack(async (q) => {
      await test(q);
      await migration.up(q);
      await q.query('SAVEPOINT mutation');
      await expect(
        q.query(
          "UPDATE vibe_challenge_versions SET snapshot='{}' WHERE version=$1",
          [BASELINE_VERSION],
        ),
      ).rejects.toThrow(/immutable/);
      await q.query('ROLLBACK TO SAVEPOINT mutation');
      await q.query('SAVEPOINT deletion');
      await expect(
        q.query('DELETE FROM vibe_challenge_versions WHERE version=$1', [
          BASELINE_VERSION,
        ]),
      ).rejects.toThrow(/foreign key/i);
      await q.query('ROLLBACK TO SAVEPOINT deletion');
      await q.query('SAVEPOINT unversioned');
      await expect(
        q.query(
          "INSERT INTO vibe_attempts(user_id,challenge_id,state,model) VALUES($1,'post-search-v1','{}','fixture')",
          [userId],
        ),
      ).rejects.toThrow(/null value.*challenge_version/i);
      await q.query('ROLLBACK TO SAVEPOINT unversioned');
    });
  });

  it('refuses rollback once a newer assessment contract is selected', async () => {
    await rolledBack(async (q) => {
      const testId = await test(q);
      await migration.up(q);
      const snapshot = currentVibeSnapshot();
      snapshot.challenge.title += ' next version';
      const version = vibeVersion(snapshot);
      await q.query(
        'INSERT INTO vibe_challenge_versions(version,challenge_id,snapshot) VALUES($1,$2,$3)',
        [version, snapshot.challenge.id, snapshot],
      );
      await q.query(
        'UPDATE enterprise_vibe_versions SET version=$2 WHERE test_id=$1',
        [testId, version],
      );
      await expect(migration.down(q)).rejects.toThrow(
        /preserve assessment history/,
      );
    });
  });
});
