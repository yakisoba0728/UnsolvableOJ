import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDeepStrictEqual } from 'node:util';
import { validateFiles } from './vibe.catalog.js';
import type { VibeChallengeSnapshot } from './vibe.snapshot.js';
import type { ProjectFiles, VibeCheck } from './vibe.types.js';
import {
  createVibeTransport,
  loadVibeTransportSettings,
  vibeSettingNames,
  type VibeTransportSettings,
} from './vibe.transport.js';

const diagnostic = (value: string) =>
  value.slice(0, 2000).replace(/[\0\p{Cs}]/gu, '\uFFFD');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class VibeRunner {
  private readonly dedicated?: VibeTransportSettings;
  constructor(private readonly config: ConfigService) {
    // Fail startup before serving requests if a dedicated identity is invalid.
    // Embedded tests/operators can still enable their local runner dynamically.
    if (config.get<string>('VIBE_EXECUTION_MODE') === 'dedicated')
      this.dedicated = this.settings();
  }

  private settings() {
    return loadVibeTransportSettings(
      Object.fromEntries(
        vibeSettingNames.map((name) => [name, this.config.get<string>(name)]),
      ),
    );
  }

  get available() {
    return Boolean(
      this.dedicated ||
      (this.config.get<string>('VIBE_SANDBOX_URL') &&
        this.config.get<string>('VIBE_SANDBOX_TOKEN')),
    );
  }

  async run(
    files: ProjectFiles,
    final: boolean,
    content: VibeChallengeSnapshot,
  ): Promise<VibeCheck[]> {
    validateFiles(files, false, content.editablePaths);
    if (!this.available)
      throw new ServiceUnavailableException(
        '프로젝트 실행기가 아직 설정되지 않았습니다.',
      );
    const signal = AbortSignal.timeout(45_000);
    const cached = new Set<string>();
    let transport: ReturnType<typeof createVibeTransport> | undefined;
    const request = async (
      path: string,
      options: {
        method?: 'GET' | 'POST' | 'DELETE';
        body?: string;
      } = {},
      cleanupSignal?: AbortSignal,
    ) => {
      const response = await transport!.request(path, {
        ...options,
        signal: cleanupSignal ?? signal,
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
      // A malformed/partial reply can still own cached files. Retain safe IDs
      // before rejecting its result, and never interpret strings/arrays as maps.
      // Cleanup stays bounded even when the executor exceeds its protocol budget.
      let invalidArtifacts = false;
      for (const item of Array.isArray(payload) ? payload : [payload]) {
        if (!isRecord(item) || item.fileIds === undefined) continue;
        if (!isRecord(item.fileIds)) {
          invalidArtifacts = true;
          continue;
        }
        const ids = Object.values(item.fileIds);
        if (ids.length > 16) invalidArtifacts = true;
        for (const id of ids) {
          if (
            typeof id !== 'string' ||
            !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
            (!cached.has(id) && cached.size === 16)
          ) {
            invalidArtifacts = true;
            continue;
          }
          cached.add(id);
        }
      }
      if (
        !Array.isArray(payload) ||
        payload.length !== 1 ||
        !isRecord(payload[0]) ||
        invalidArtifacts
      )
        throw new Error('Invalid execution response');
      const result = payload[0] as {
        status: string;
        exitStatus: number;
        files?: Record<string, string>;
        fileIds?: Record<string, string>;
      };
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
      transport = createVibeTransport(this.dedicated ?? this.settings());
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
      const anonymous = await transport.request('/file', {
        anonymous: true,
        signal,
      });
      await anonymous.body?.cancel();
      if (anonymous.status !== 401 && anonymous.status !== 403)
        throw new Error('Sandbox file access must require authentication');
      const compile = await execute(
        [
          '/bin/sh',
          '-c',
          '/usr/local/bin/esbuild harness.ts --bundle --platform=node --format=cjs --outfile=main.cjs && /usr/local/bin/esbuild tests/search.test.ts --bundle --platform=node --format=cjs --outfile=checks.cjs',
        ],
        Object.fromEntries(
          Object.entries({
            ...content.initialFiles,
            ...files,
            'harness.ts': content.harness,
          }).map(([path, content]) => [path, { content }]),
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
      for (const { test, hidden } of [
        ...content.publicChecks.map((test) => ({ test, hidden: false })),
        ...(final
          ? content.hiddenChecks.map((test) => ({ test, hidden: true }))
          : []),
      ]) {
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
          ...(!passed && !hidden
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
      const cleanupSignal = AbortSignal.timeout(5_000);
      await Promise.allSettled(
        [...cached].map(async (id) => {
          await (
            await request(
              `/file/${encodeURIComponent(id)}`,
              { method: 'DELETE' },
              cleanupSignal,
            )
          ).body?.cancel();
        }),
      );
      transport?.close();
    }
  }
}
