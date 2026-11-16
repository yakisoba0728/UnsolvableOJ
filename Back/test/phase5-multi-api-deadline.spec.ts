import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DeadlineScope, multiApiBudgets, ownedPostgres, ownedRedis } from './phase5-multi-api.pipeline-helpers.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function stalledServer() {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('data', () => {}); // Deliberately never answer this owned fixture.
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned fixture address');
  return { port: address.port, get connections() { return connections; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } };
}

describe('multi-API deadline and transport ownership', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reaches cleanup and writes FAIL while setup is stalled; late completion cannot change the receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase5-deadline-'));
    const stalled = deferred<void>();
    const forceClose = vi.fn();
    const nextSetup = vi.fn(async () => {});
    const receipt = { status: 'FAIL', cleanupCompleted: false };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const actions = new DeadlineScope(45, 'fixture setup');
    actions.own(forceClose);
    const protocol = (async () => {
      try {
        await actions.run(() => stalled.promise);
        await actions.run(nextSetup);
        receipt.status = 'PASS';
      } catch { receipt.status = 'FAIL'; }
      finally {
        actions.close();
        receipt.cleanupCompleted = true;
        const reporting = new DeadlineScope(3000, 'fixture report');
        try {
          await reporting.run((signal) => writeFile(join(directory, 'report.json'), JSON.stringify(receipt), { signal }));
        } finally { reporting.close(); }
      }
    })();
    try {
      await vi.advanceTimersByTimeAsync(45);
      await protocol;
      expect(forceClose).toHaveBeenCalledOnce();
      expect(nextSetup).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))).toEqual({ status: 'FAIL', cleanupCompleted: true });
      stalled.resolve();
      await actions.settled();
      expect(actions.pendingCount).toBe(0);
      expect(receipt.status).toBe('FAIL');
      expect(nextSetup).not.toHaveBeenCalled();
      expect(multiApiBudgets.actionMs + 2 * multiApiBudgets.processStopPhaseMs + multiApiBudgets.cleanupOperationsMs +
        multiApiBudgets.connectionDrainMs + multiApiBudgets.reportMs).toBeLessThan(multiApiBudgets.existingTestMs);
    } finally {
      actions.close();
      stalled.resolve();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['sql', 'getJob'] as const)('does not schedule further observer operations when %s crosses the cutoff', async (blocked) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const actions = new DeadlineScope(45, 'observer sequence');
    const late = deferred<void>();
    const sql = vi.fn(() => blocked === 'sql' ? late.promise : Promise.resolve());
    const getJob = vi.fn(() => blocked === 'getJob' ? late.promise : Promise.resolve());
    const getState = vi.fn(async () => 'completed');
    const operation = (async () => {
      await actions.run(sql);
      await actions.run(getJob);
      return actions.run(getState);
    })();
    const rejected = expect(operation).rejects.toThrow('deadline exceeded');
    await vi.advanceTimersByTimeAsync(45);
    await rejected;
    expect(getState).not.toHaveBeenCalled();
    if (blocked === 'sql') expect(getJob).not.toHaveBeenCalled();
    late.reject(new Error('Late transport failure'));
    await actions.settled();
    expect(actions.pendingCount).toBe(0);
    expect(getState).not.toHaveBeenCalled();
    actions.close();
  });

  it('destroys an owned PostgreSQL socket while startup is stalled', async () => {
    const server = await stalledServer();
    const scope = new DeadlineScope(100, 'PostgreSQL startup');
    const observer = ownedPostgres(scope, `postgresql://fixture:fixture@127.0.0.1:${server.port}/owned_fixture`, false);
    try {
      await expect(observer.connect()).rejects.toThrow('deadline exceeded');
      await observer.closed;
      await scope.settled();
      expect(observer.socket.destroyed).toBe(true);
      expect(scope.pendingCount).toBe(0);
      expect(scope.closeFailures).toEqual([]);
      expect(server.connections).toBe(1);
    } finally { scope.close(); await server.close(); }
  });

  it('disconnects a stalled Redis startup and never reconnects after the deadline', async () => {
    const server = await stalledServer();
    const scope = new DeadlineScope(100, 'Redis startup');
    const observer = ownedRedis(scope, { host: '127.0.0.1', port: server.port, db: 0 });
    try {
      await expect(observer.connect()).rejects.toThrow('deadline exceeded');
      await observer.closed;
      await scope.settled();
      expect(observer.client.status).toBe('end');
      expect(scope.pendingCount).toBe(0);
      await delay(60); // Beyond the library's initial retry interval; retries are disabled.
      expect(server.connections).toBe(1);
      expect(scope.closeFailures).toEqual([]);
    } finally { scope.close(); await server.close(); }
  });

  it('consumes the runner cancellation signal and rejects new factories immediately', async () => {
    const runner = new AbortController();
    const actions = new DeadlineScope(1000, 'runner cancellation', runner.signal);
    const late = deferred<void>();
    const owner = vi.fn();
    actions.own(owner);
    const pending = actions.run(() => late.promise);
    const rejected = expect(pending).rejects.toThrow('Runner stopped');
    await Promise.resolve();
    runner.abort(new Error('Runner stopped'));
    await rejected;
    const laterFactory = vi.fn(async () => {});
    await expect(actions.run(laterFactory)).rejects.toThrow('Runner stopped');
    expect(laterFactory).not.toHaveBeenCalled();
    expect(owner).toHaveBeenCalledOnce();
    late.resolve();
    await actions.settled();
    expect(actions.pendingCount).toBe(0);
    actions.close();
  });
});
