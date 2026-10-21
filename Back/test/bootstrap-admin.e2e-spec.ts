import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from '../src/config/database.config.js';

const execFile = promisify(execFileCallback);
const script = resolve('scripts/bootstrap-admin.mjs');

describe('Administrator bootstrap CLI (e2e)', () => {
  const id = randomUUID();
  const email = `bootstrap-${id}@example.com`;
  let db: DataSource;

  beforeAll(async () => {
    db = await new DataSource({
      type: 'postgres',
      ...databaseConnectionOptions(process.env.DATABASE_URL!, process.env.DATABASE_SSL === 'true'),
    }).initialize();
    await db.query(
      'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
      [id, email, `bootstrap_${id.slice(0, 8)}`, 'unused-test-hash'],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('promotes the matched user and reports their email', async () => {
    const { stdout } = await execFile(process.execPath, [script, email]);
    expect(stdout).toContain(email);
    expect(stdout).not.toContain('undefined');
    expect(
      (
        await db.query('SELECT role, token_version FROM users WHERE id = $1', [
          id,
        ])
      )[0],
    ).toEqual({ role: 'ADMIN', token_version: 1 });
  });

  it('fails when no account matches', async () => {
    await expect(
      execFile(process.execPath, [script, `missing-${id}@example.com`]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('회원가입 계정이 없습니다'),
    });
  });
});
