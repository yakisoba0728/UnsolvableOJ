import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  editableFiles,
  hiddenChecks,
  publicChecks,
  validateFiles,
} from './vibe.catalog.js';
import { VibeRunner } from './vibe.runner.js';

afterEach(() => vi.unstubAllGlobals());
describe('vibe project trust boundaries', () => {
  it('only accepts the exact editable project files, bounded PostgreSQL text and no path traversal', () => {
    const files = editableFiles();
    expect(validateFiles(files)).toEqual(files);
    expect(validateFiles({}, true)).toEqual({});
    for (const bad of [
      null,
      [],
      {},
      { ...files, '../harness.ts': 'changed' },
      { ...files, 'src/search.ts': '\0' },
      { ...files, 'src/search.ts': '\ud800' },
      { ...files, 'src/search.ts': '가'.repeat(10_001) },
    ])
      expect(() => validateFiles(bad)).toThrow();
  });

  it('compiles multiple files in the sandbox, compares outputs outside user code and reclaims artifacts', async () => {
    const commands: Record<string, unknown>[] = [];
    const deleted: string[] = [];
    let executions = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        const path = url.pathname;
        if (options.method === 'DELETE') {
          deleted.push(path);
          return new Response('{}');
        }
        if (path === '/version') return Response.json({ os: 'linux' });
        if (path === '/config')
          return Response.json({
            runnerConfig: {
              seccomp: true,
              cgroupType: 2,
              workDir: '/w',
              cgroupControllers: ['cpu', 'memory', 'pids'],
            },
          });
        if (path === '/file') return Response.json([]);
        if (typeof options.body !== 'string')
          throw new Error('Expected a JSON request');
        const { cmd } = JSON.parse(options.body);
        commands.push(cmd[0]);
        executions++;
        return Response.json([
          {
            status: 'Accepted',
            exitStatus: 0,
            files: {
              stdout: JSON.stringify(
                publicChecks[executions - 2]?.expected ?? [],
              ),
              stderr: '',
            },
            fileIds:
              executions === 1
                ? {
                    'main.cjs': 'compiled-main',
                    'checks.cjs': 'compiled-checks',
                  }
                : {},
          },
        ]);
      }),
    );
    const runner = new VibeRunner(
      new ConfigService({
        VIBE_SANDBOX_URL: 'http://sandbox.test',
        VIBE_SANDBOX_TOKEN: 'private-test-token',
      }),
    );
    const checks = await runner.run(editableFiles(), false);
    expect(checks).toHaveLength(publicChecks.length + 1);
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(commands[0].copyIn).toHaveProperty(['src/search.ts']);
    expect(JSON.stringify(commands)).not.toContain('private-test-token');
    expect(commands).toHaveLength(publicChecks.length + 2);
    expect(deleted.sort()).toEqual([
      '/file/compiled-checks',
      '/file/compiled-main',
    ]);
  });

  it('rejects unsafe sandbox settings before running any code', async () => {
    const fetcher = vi.fn(async (url: URL) =>
      Response.json(
        url.pathname === '/version'
          ? { os: 'linux' }
          : { runnerConfig: { seccomp: false } },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const runner = new VibeRunner(
      new ConfigService({
        VIBE_SANDBOX_URL: 'http://sandbox.test',
        VIBE_SANDBOX_TOKEN: 'token',
      }),
    );
    await expect(runner.run(editableFiles(), true)).rejects.toThrow(
      '격리 실행기',
    );
    expect(fetcher.mock.calls.some(([url]) => url.pathname === '/run')).toBe(
      false,
    );
  });

  it('does not accept a forged assertion message as a passing functional test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        if (options.method === 'DELETE') return new Response('{}');
        if (url.pathname === '/version') return Response.json({ os: 'linux' });
        if (url.pathname === '/config')
          return Response.json({
            runnerConfig: {
              seccomp: true,
              cgroupType: 2,
              workDir: '/w',
              cgroupControllers: ['cpu', 'memory', 'pids'],
            },
          });
        if (url.pathname === '/file') return Response.json([]);
        return Response.json([
          {
            status: 'Accepted',
            exitStatus: 0,
            files: { stdout: 'ALL TESTS PASSED' },
            fileIds: { 'main.cjs': 'a', 'checks.cjs': 'b' },
          },
        ]);
      }),
    );
    const result = await new VibeRunner(
      new ConfigService({
        VIBE_SANDBOX_URL: 'http://sandbox.test',
        VIBE_SANDBOX_TOKEN: 'token',
      }),
    ).run(editableFiles(), true);
    expect(result).toHaveLength(publicChecks.length + hiddenChecks.length);
    expect(result.every((c) => !c.passed)).toBe(true);
    expect(
      result
        .filter((c) => c.name.startsWith('숨김'))
        .every((c) => c.detail === undefined),
    ).toBe(true);
  });
});
