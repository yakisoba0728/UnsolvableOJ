import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { EnterpriseService } from '../src/modules/enterprise/enterprise.service.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

/** Separate app keeps the five/minute export admission policy intact. */
describe('enterprise result authentication after token revocation', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let service: EnterpriseService;
  let account: Awaited<ReturnType<typeof register>>;
  const suffix = randomUUID().slice(0, 8);
  const absentTestId = randomUUID();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    service = app.get(EnterpriseService);
    account = await register(app, 'export_revoke', suffix);
  });
  afterAll(() => closeApp(app, []));

  it('rejects stale tokens before CSV/deep-page service access and accepts a new authenticated session', async () => {
    const csv = `${base}/enterprise/tests/${absentTestId}/results/export`;
    const page = `${base}/enterprise/tests/${absentTestId}/results?page=100`;
    // A live identity reaches the resource-hiding404 contract before revocation.
    await http().get(csv).set(bearer(account.accessToken)).expect(404);
    const exportSpy = vi.spyOn(service, 'exportResults');
    const resultSpy = vi.spyOn(service, 'results');
    try {
      await db.query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [account.user.id]);
      await http().get(csv).set(bearer(account.accessToken)).expect(401);
      await http().get(page).set(bearer(account.accessToken)).expect(401);
      expect(exportSpy).not.toHaveBeenCalled();
      expect(resultSpy).not.toHaveBeenCalled();
      const { body: fresh } = await http().post(`${base}/auth/login`).send({
        email: `export_revoke-${suffix}@example.com`, password: 'test-password-123',
      }).expect(200);
      await http().get(page).set(bearer(fresh.accessToken)).expect(404);
      expect(resultSpy).toHaveBeenCalledTimes(1);
    } finally { exportSpy.mockRestore(); resultSpy.mockRestore(); }
  });
});
