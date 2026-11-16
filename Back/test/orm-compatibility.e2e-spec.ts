import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { User } from '../src/modules/users/user.entity.js';
import { closeApp, createApp, register } from './helpers.js';

describe('TypeORM runtime compatibility', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    userId = (await register(app, 'orm_compat', suffix)).user.id;
  });
  afterAll(() => closeApp(app, []));

  it('fails closed for an undefined account selector instead of loading an unrelated account', async () => {
    await expect(db.getRepository(User).findOneBy({ id: undefined })).rejects.toThrow(
      /undefined/i,
    );
  });

  it('fails closed for a null account selector received at runtime', async () => {
    await expect(
      db.getRepository(User).findOneBy({ id: null as unknown as string }),
    ).rejects.toThrow(/null/i);
  });

  it('preserves raw UPDATE result shape and transaction rollback', async () => {
    const users = db.getRepository(User);
    const before = await users.findOneByOrFail({ id: userId });
    await expect(
      db.transaction(async (manager) => {
        const [rows, affected] = await manager.query(
          'UPDATE users SET username=$1 WHERE id=$2 RETURNING id,username',
          [`orm_rollback_${suffix}`, userId],
        );
        expect(affected).toBe(1);
        expect(rows).toEqual([{ id: userId, username: `orm_rollback_${suffix}` }]);
        throw new Error('rollback fixture');
      }),
    ).rejects.toThrow('rollback fixture');
    expect((await users.findOneByOrFail({ id: userId })).username).toBe(before.username);
  });

  it('retains structured QueryRunner rows and affected counts for clock/race fixtures', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      const result = await runner.query(
        'SELECT id FROM users WHERE id=$1',
        [userId],
        true,
      );
      expect(result.records).toEqual([{ id: userId }]);
      expect(result.affected).toBe(1);
    } finally {
      await runner.release();
    }
  });
});
