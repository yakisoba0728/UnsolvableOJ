import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  editableFiles,
  hiddenChecks,
  publicChecks,
  validateFiles,
} from './vibe.catalog.js';
import { VibeRunner } from './vibe.runner.js';
import { currentVibeSnapshot } from './vibe.snapshot.js';

afterEach(() => vi.unstubAllGlobals());
describe('vibe project trust boundaries', () => {
  it('executes the selected harness and test cohort instead of the live catalog', async () => {
    const content = currentVibeSnapshot();
    content.harness += '\n// pinned harness sentinel';
    content.initialFiles['src/fixed.ts'] = 'export const pinned = 17;';
    content.publicChecks = [
      {
        name: 'Selected public check',
        input: { sentinel: 'selected-public' },
        expected: [42],
      },
    ];
    content.hiddenChecks = [
      {
        name: 'Private selected check',
        input: { sentinel: 'private-selected' },
        expected: [99],
      },
    ];
    const commands: {
      copyIn: Record<string, { content?: string }>;
      files: { content?: string }[];
    }[] = [];
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
        if (url.pathname === '/file')
          return new Headers(options.headers).has('Authorization')
            ? Response.json([])
            : new Response(null, { status: 401 });
        const { cmd } = JSON.parse(options.body as string);
        commands.push(cmd[0]);
        return Response.json([
          {
            status: 'Accepted',
            exitStatus: 0,
            files: {
              stdout: JSON.stringify(commands.length === 2 ? [42] : [100]),
            },
            fileIds:
              commands.length === 1
                ? { 'main.cjs': 'main', 'checks.cjs': 'checks' }
                : {},
          },
        ]);
      }),
    );
    const runner = new VibeRunner(
      new ConfigService({
        VIBE_SANDBOX_URL: 'http://sandbox.test',
        VIBE_SANDBOX_TOKEN: 'test-token',
      }),
    );
    const checks = await runner.run(editableFiles(), true, content);
    expect(checks).toEqual([
      { name: 'Selected public check', passed: true },
      { name: 'Private selected check', passed: false },
    ]);
    expect(commands[0].copyIn['harness.ts'].content).toBe(content.harness);
    expect(commands[0].copyIn['src/fixed.ts'].content).toBe(
      content.initialFiles['src/fixed.ts'],
    );
    expect(
      commands.slice(1).map((cmd) => JSON.parse(cmd.files[0].content!)),
    ).toEqual([
      { sentinel: 'selected-public' },
      { sentinel: 'private-selected' },
    ]);
    expect(JSON.stringify(checks)).not.toContain('private-selected');
  });
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
        if (path === '/file')
          return new Headers(options.headers).has('Authorization')
            ? Response.json([])
            : new Response(null, { status: 401 });
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
    const checks = await runner.run(
      editableFiles(),
      false,
      currentVibeSnapshot(),
    );
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
    await expect(
      runner.run(editableFiles(), true, currentVibeSnapshot()),
    ).rejects.toThrow('격리 실행기');
    expect(fetcher.mock.calls.some(([url]) => url.pathname === '/run')).toBe(
      false,
    );
  });

  it('rejects a sandbox that accepts anonymous file access before executing code', async () => {
    const fetcher = vi.fn(async (url: URL) => {
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
          fileIds: { 'main.cjs': 'a', 'checks.cjs': 'b' },
        },
      ]);
    });
    vi.stubGlobal('fetch', fetcher);
    const runner = new VibeRunner(
      new ConfigService({
        VIBE_SANDBOX_URL: 'http://sandbox.test',
        VIBE_SANDBOX_TOKEN: 'fixture-token',
      }),
    );
    await expect(
      runner.run(editableFiles(), false, currentVibeSnapshot()),
    ).rejects.toThrow('격리 실행기');
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
        if (url.pathname === '/file')
          return new Headers(options.headers).has('Authorization')
            ? Response.json([])
            : new Response(null, { status: 401 });
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
    ).run(editableFiles(), true, currentVibeSnapshot());
    expect(result).toHaveLength(publicChecks.length + hiddenChecks.length);
    expect(result.every((c) => !c.passed)).toBe(true);
    expect(
      result
        .filter((c) => c.name.startsWith('숨김'))
        .every((c) => c.detail === undefined),
    ).toBe(true);
  });

  it.each([
    {
      name: 'unexpected multiple command results',
      payload: [
        { status: 'Accepted', exitStatus: 0, fileIds: { 'main.cjs': 'main' } },
        { status: 'Internal Error', fileIds: { partial: 'partial' } },
      ],
      deleted: ['main', 'partial'],
    },
    {
      name: 'an invalid result before valid cleanup metadata',
      payload: [null, { fileIds: { partial: 'partial' } }],
      deleted: ['partial'],
    },
    {
      name: 'an invalid artifact between two valid artifacts',
      payload: [
        {
          status: 'Accepted',
          exitStatus: 0,
          fileIds: { first: 'first', invalid: '../unsafe', last: 'last' },
        },
      ],
      deleted: ['first', 'last'],
    },
    {
      name: 'artifact overflow without an unbounded cleanup fanout',
      payload: [
        {
          status: 'Accepted',
          exitStatus: 0,
          fileIds: Object.fromEntries(
            Array.from({ length: 17 }, (_, i) => [`file-${i}`, `cached-${i}`]),
          ),
        },
      ],
      deleted: Array.from({ length: 16 }, (_, i) => `cached-${i}`).sort(),
    },
    {
      name: 'a string instead of the artifact map',
      payload: [{ status: 'Accepted', exitStatus: 0, fileIds: 'artifact' }],
      deleted: [],
    },
    {
      name: 'an array instead of the artifact map',
      payload: [{ status: 'Accepted', exitStatus: 0, fileIds: ['main'] }],
      deleted: [],
    },
  ])(
    'fails closed and reclaims bounded known artifacts for $name',
    async ({ payload, deleted }) => {
      const removals: string[] = [];
      let executions = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL, options: RequestInit) => {
          if (options.method === 'DELETE') {
            removals.push(url.pathname.slice('/file/'.length));
            return new Response(null, { status: 204 });
          }
          if (url.pathname === '/version')
            return Response.json({ os: 'linux' });
          if (url.pathname === '/config')
            return Response.json({
              runnerConfig: {
                seccomp: true,
                cgroupType: 2,
                workDir: '/w',
                cgroupControllers: ['cpu', 'memory', 'pids'],
              },
            });
          if (url.pathname === '/file')
            return new Headers(options.headers).has('Authorization')
              ? Response.json([])
              : new Response(null, { status: 401 });
          expect(url.pathname).toBe('/run');
          executions++;
          return Response.json(payload);
        }),
      );
      const runner = new VibeRunner(
        new ConfigService({
          VIBE_SANDBOX_URL: 'http://sandbox.test',
          VIBE_SANDBOX_TOKEN: 'fixture-token',
        }),
      );
      await expect(
        runner.run(editableFiles(), true, currentVibeSnapshot()),
      ).rejects.toThrow('격리 실행기');
      expect(executions).toBe(1);
      expect(removals.sort()).toEqual(deleted);
    },
  );
});
