import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { reserveLoopbackPort } from './process.pipeline-helpers.js';

const execute = promisify(execFile);
const ownershipLabel = 'org.unsolvable.phase2-test';
const image = 'redis:8.10.3'; // Same already-pulled image as the full CI job.
interface Container {
  Id: string; Name: string; Image: string;
  Config: { Labels: Record<string, string> };
  HostConfig: { Privileged: boolean; Memory: number; MemorySwap: number; NanoCpus: number; PidsLimit: number; PortBindings: Record<string, { HostIp: string; HostPort: string }[]> };
  Mounts: { Type: string; Name?: string; Destination: string }[];
  State: { Running: boolean; Pid: number; ExitCode: number; StartedAt: string; FinishedAt: string };
}

// This helper never looks up a workflow service or accepts an existing resource.
// Every mutation re-checks the exact ID and unique ownership label it created.
export async function createOwnedRedis() {
  const owner = randomUUID().replaceAll('-', '');
  const name = `unsolvable-p2-redis-${owner}`;
  const volume = `${name}-data`;
  const port = await reserveLoopbackPort();
  let containerId: string | undefined;
  let ownsVolume = false;
  let verifiedDockerHost: string | undefined;
  let log = '';
  async function docker(args: string[]) {
    const result = await execute('docker', verifiedDockerHost ? ['--host', verifiedDockerHost, ...args] : args, {
      timeout: 15_000, maxBuffer: 512_000, encoding: 'utf8',
      env: verifiedDockerHost ? { ...process.env, DOCKER_CONTEXT: undefined } : process.env,
    });
    return result.stdout.trim();
  }
  async function checkVolume() {
    const labels = JSON.parse(await docker(['volume', 'inspect', '--format', '{{json .Labels}}', volume])) as Record<string, string>;
    assert.equal(labels?.[ownershipLabel], owner, 'Refusing to mutate a volume not owned by this scenario');
  }
  async function checkContainer() {
    assert.ok(containerId && /^[a-f0-9]{64}$/.test(containerId));
    const current = JSON.parse(await docker(['inspect', '--format', '{{json .}}', containerId])) as Container;
    assert.equal(current.Id, containerId);
    assert.equal(current.Name, `/${name}`);
    assert.equal(current.Config.Labels[ownershipLabel], owner, 'Refusing to mutate a container not owned by this scenario');
    assert.equal(current.HostConfig.Privileged, false);
    assert.equal(current.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(current.HostConfig.MemorySwap, 128 * 1024 * 1024);
    assert.equal(current.HostConfig.NanoCpus, 500_000_000);
    assert.equal(current.HostConfig.PidsLimit, 64);
    assert.deepEqual(current.HostConfig.PortBindings['6379/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(port) }]);
    assert.ok(current.Mounts.some((mount) => mount.Type === 'volume' && mount.Name === volume && mount.Destination === '/data'));
    return current;
  }
  async function close() {
    if (containerId) {
      await checkContainer();
      log += await docker(['logs', '--tail', '200', containerId]);
      await docker(['rm', '--force', containerId]);
      containerId = undefined;
    }
    if (ownsVolume) {
      await checkVolume();
      await docker(['volume', 'rm', volume]);
      ownsVolume = false;
    }
  }
  try {
    // A developer's remote Docker context must never turn this disposable local
    // test into an operation on another host. Pin the verified local socket.
    const hostOverride = process.env.DOCKER_HOST;
    assert.ok(!hostOverride || hostOverride.startsWith('unix:///'), 'Remote Docker hosts are not allowed for this test');
    const contextHost = JSON.parse(await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'])) as string;
    assert.ok(contextHost.startsWith('unix:///'), 'Remote Docker contexts are not allowed for this test');
    verifiedDockerHost = process.env.DOCKER_CONTEXT ? contextHost : hostOverride || contextHost;
    await docker(['volume', 'create', '--label', `${ownershipLabel}=${owner}`, volume]);
    await checkVolume();
    ownsVolume = true;
    containerId = await docker(['create', '--pull=never', '--name', name,
      '--label', `${ownershipLabel}=${owner}`, '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.5', '--pids-limit', '64',
      '--security-opt', 'no-new-privileges:true', '--publish', `127.0.0.1:${port}:6379`,
      '--mount', `type=volume,source=${volume},target=/data`, image,
      'redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec']);
    await checkContainer();
    await docker(['start', containerId]);
    const initial = await checkContainer();
    return {
      port, image, imageId: initial.Image, containerId, volume,
      get log() { return log; },
      inspect: checkContainer,
      async stop() {
        await checkContainer();
        await docker(['stop', '-t', '10', containerId!]);
        const current = await checkContainer();
        assert.equal(current.State.Running, false);
        assert.equal(current.State.ExitCode, 0, 'This scenario requires a clean Redis stop, not a forced crash');
        return current;
      },
      async start() {
        await checkContainer();
        await docker(['start', containerId!]);
        const current = await checkContainer();
        assert.equal(current.State.Running, true);
        return current;
      },
      close,
    };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Owned Redis setup and cleanup failed'); }
    throw error;
  }
}
