import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';
import {
  harness,
  hiddenChecks,
  publicChecks,
  validateFiles,
} from './vibe.catalog.js';
import type { ProjectFiles, VibeCheck } from './vibe.types.js';

const diagnostic = (value: string) =>
  value.slice(0, 2000).replace(/[\0\p{Cs}]/gu, '\uFFFD');

@Injectable()
export class VibeRunner {
  constructor(private readonly config: ConfigService) {}

  get available() {
    return Boolean(
      this.config.get<string>('VIBE_SANDBOX_URL') &&
      this.config.get<string>('VIBE_SANDBOX_TOKEN'),
    );
  }

  async run(files: ProjectFiles, final: boolean): Promise<VibeCheck[]> {
    validateFiles(files);
    if (!this.available)
      throw new ServiceUnavailableException(
        '프로젝트 실행기가 아직 설정되지 않았습니다.',
      );
    const url = this.config.getOrThrow<string>('VIBE_SANDBOX_URL');
    const token = this.config.getOrThrow<string>('VIBE_SANDBOX_TOKEN');
    const signal = AbortSignal.timeout(45_000);
    const cached = new Set<string>();
    const request = async (
      path: string,
      options: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      } = {},
      cleanup = false,
    ) => {
      const response = await fetch(new URL(path, url), {
        ...options,
        redirect: 'error',
        signal: cleanup ? AbortSignal.timeout(5_000) : signal,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Sandbox request failed');
      }
      return response;
    };
    const execute = async (
      args: string[],
      copyIn: Record<string, { content: string } | { fileId: string }>,
      input = '',
      artifacts: string[] = [],
    ) => {
      const payload: unknown = await (
        await request('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: [
              {
                args,
                env: [
                  'PATH=/usr/local/bin:/usr/bin:/bin',
                  'HOME=/w',
                  'LANG=C.UTF-8',
                ],
                copyIn,
                files: [
                  { content: input },
                  { name: 'stdout', max: 16_384 },
                  { name: 'stderr', max: 16_384 },
                ],
                copyOut: ['stdout', 'stderr'],
                copyOutCached: artifacts.map((path) => `${path}?`),
                copyOutMax: 1_048_576,
                cpuLimit: artifacts.length ? 5_000_000_000 : 1_000_000_000,
                clockLimit: artifacts.length ? 10_000_000_000 : 2_000_000_000,
                memoryLimit: 512 * 1024 * 1024,
                procLimit: 64,
                cpuRateLimit: 1000,
              },
            ],
          }),
        })
      ).json();
      if (!Array.isArray(payload) || payload.length !== 1)
        throw new Error('Invalid execution response');
      const result = payload[0] as {
        status: string;
        exitStatus: number;
        files?: Record<string, string>;
        fileIds?: Record<string, string>;
      };
      for (const id of Object.values(result.fileIds ?? {}))
        if (typeof id === 'string') cached.add(id);
      if (
        ![
          'Accepted',
          'Nonzero Exit Status',
          'Signalled',
          'Dangerous Syscall',
          'Time Limit Exceeded',
          'Memory Limit Exceeded',
          'Output Limit Exceeded',
        ].includes(result.status)
      )
        throw new Error('Sandbox execution failed');
      return result;
    };
    try {
      const version = await (await request('/version')).json();
      const settings = await (await request('/config')).json();
      const runner = settings?.runnerConfig;
      if (
        version?.os !== 'linux' ||
        ![1, 2].includes(runner?.cgroupType) ||
        runner?.seccomp !== true ||
        runner?.workDir !== '/w' ||
        !['cpu', 'memory', 'pids'].every((name) =>
          runner?.cgroupControllers?.includes(name),
        )
      )
        throw new Error('Sandbox isolation is unavailable');
      await (await request('/file')).body?.cancel();
      const compile = await execute(
        [
          '/bin/sh',
          '-c',
          '/usr/local/bin/esbuild harness.ts --bundle --platform=node --format=cjs --outfile=main.cjs && /usr/local/bin/esbuild tests/search.test.ts --bundle --platform=node --format=cjs --outfile=checks.cjs',
        ],
        Object.fromEntries(
          Object.entries({ ...files, 'harness.ts': harness }).map(
            ([path, content]) => [path, { content }],
          ),
        ),
        '',
        ['main.cjs', 'checks.cjs'],
      );
      if (compile.status !== 'Accepted' || compile.exitStatus !== 0)
        return [
          {
            name: '프로젝트 빌드',
            passed: false,
            detail: diagnostic(
              compile.files?.stderr ??
                '컴파일 오류 또는 자원 제한을 확인해 주세요.',
            ),
          },
        ];
      const artifact = compile.fileIds?.['main.cjs'];
      const checksArtifact = compile.fileIds?.['checks.cjs'];
      if (!artifact || !checksArtifact)
        throw new Error('Compiled files missing');
      const checks: VibeCheck[] = [];
      for (const test of [...publicChecks, ...(final ? hiddenChecks : [])]) {
        const execution = await execute(
          ['/usr/bin/node', '/w/main.cjs'],
          { 'main.cjs': { fileId: artifact } },
          JSON.stringify(test.input),
        );
        let actual: unknown;
        try {
          actual = JSON.parse(execution.files?.stdout ?? '');
        } catch {
          actual = null;
        }
        const passed =
          execution.status === 'Accepted' &&
          execution.exitStatus === 0 &&
          isDeepStrictEqual(actual, test.expected);
        checks.push({
          name: test.name,
          passed,
          ...(!passed && !test.name.startsWith('숨김')
            ? {
                detail: diagnostic(
                  execution.files?.stderr ||
                    `기대 결과: ${JSON.stringify(test.expected)}\n실제 출력: ${execution.files?.stdout ?? ''}`,
                ),
              }
            : {}),
        });
      }
      if (!final) {
        const own = await execute(['/usr/bin/node', '/w/checks.cjs'], {
          'checks.cjs': { fileId: checksArtifact },
        });
        checks.push({
          name: '작성한 회귀 테스트',
          passed: own.status === 'Accepted' && own.exitStatus === 0,
          detail: diagnostic(
            own.files?.stderr || own.files?.stdout || own.status,
          ),
        });
      }
      return checks;
    } catch {
      throw new ServiceUnavailableException(
        '격리 실행기에 연결하지 못했습니다. 코드는 저장되어 있습니다. 잠시 뒤 다시 시도해 주세요.',
      );
    } finally {
      await Promise.allSettled(
        [...cached].map(async (id) => {
          await (
            await request(
              `/file/${encodeURIComponent(id)}`,
              { method: 'DELETE' },
              true,
            )
          ).body?.cancel();
        }),
      );
    }
  }
}
