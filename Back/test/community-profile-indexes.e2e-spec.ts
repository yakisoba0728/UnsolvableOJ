import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './helpers.js';

describe('community profile lookup indexes', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DataSource);
  });
  afterAll(async () => { await app?.close(); });

  it('installs usable non-unique user-first indexes through the real migration chain', async () => {
    const rows = await db.query(`
      SELECT c.relname AS name, i.indisvalid AS valid, i.indisready AS ready,
             i.indisunique AS unique, pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE c.relname IN ('idx_community_saved_user_post','idx_community_votes_user_post')
      ORDER BY c.relname`);
    expect(rows.map((row: { name: string }) => row.name)).toEqual([
      'idx_community_saved_user_post', 'idx_community_votes_user_post',
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ valid: true, ready: true, unique: false });
      expect(row.definition).toContain('USING btree (user_id, post_id)');
    }
  });
});
