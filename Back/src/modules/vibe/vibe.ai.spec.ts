import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { VibeAttemptRow } from './vibe.types.js';
import {
  currentVibeSnapshot,
  snapshotEditableFiles,
  vibeVersion,
} from './vibe.snapshot.js';

const generate = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: generate,
}));
import { VibeAi } from './vibe.ai.js';

const attempt = (): VibeAttemptRow => {
  const content = currentVibeSnapshot();
  content.challenge.title = 'Retained task';
  content.initialFiles['README.md'] = 'Retained template';
  content.assistSystem = 'Retained assistant instructions';
  content.reviewSystem = 'Retained evaluator instructions';
  return {
    id: randomUUID(),
    user_id: randomUUID(),
    challenge_id: content.challenge.id,
    challenge_version: vibeVersion(content),
    challenge_snapshot: content,
    revision: 1,
    model: 'test-no-network',
    started_at: new Date(),
    deadline_at: new Date(Date.now() + 60_000),
    submitted_at: null,
    enterprise_attempt_id: null,
    operation_id: null,
    busy_until: null,
    state: {
      files: snapshotEditableFiles(content),
      messages: [],
      runs: [],
      events: [],
      undo: null,
      report: null,
      aiRequests: 0,
      evaluations: 0,
    },
  };
};
const ai = new VibeAi(
  new ConfigService({ OPENAI_API_KEY: 'test-unused-key-no-provider-request' }),
);
beforeEach(() => generate.mockReset());

describe('Vibe AI consumes archived assessment evidence without paid provider calls', () => {
  it('uses retained instructions, metadata and initial files without sending hidden fixtures', async () => {
    generate.mockResolvedValue({
      output: { text: '저장된 과제를 확인했습니다.', files: [] },
    });
    const row = attempt();
    await ai.assist(row);
    const options = generate.mock.calls[0][0];
    expect(options.system).toBe(row.challenge_snapshot.assistSystem);
    const prompt = JSON.parse(options.prompt);
    expect(prompt.task.title).toBe('Retained task');
    expect(prompt.files['README.md']).toBe('Retained template');
    expect(options.prompt).not.toMatch(/hiddenChecks|harness|test-unused-key/);
    expect(options.maxRetries).toBe(0);
  });

  it('evaluates the archived task with actual message/event identities and rejects invented evidence', async () => {
    const row = attempt();
    const id = randomUUID();
    row.state.events.push({
      id,
      type: 'save',
      createdAt: new Date().toISOString(),
      revision: row.revision,
    });
    generate.mockResolvedValue({
      output: {
        prompt: {
          score: 0,
          feedback: '프롬프트 기록이 없습니다.',
          evidence: [],
        },
        process: {
          score: 10,
          feedback: '변경 저장 기록이 있습니다.',
          evidence: [id],
        },
      },
    });
    await ai.evaluate(row, '내 회고');
    const options = generate.mock.calls[0][0];
    expect(options.system).toBe(row.challenge_snapshot.reviewSystem);
    const prompt = JSON.parse(options.prompt);
    expect(prompt.task.title).toBe('Retained task');
    expect(prompt.initialFiles['README.md']).toBe('Retained template');
    expect(prompt.finalFiles).toEqual(row.state.files);
    expect(options.prompt).not.toMatch(/hiddenChecks|harness|test-unused-key/);
    generate.mockResolvedValue({
      output: {
        prompt: {
          score: 10,
          feedback: '존재하지 않는 근거',
          evidence: [randomUUID()],
        },
        process: { score: 10, feedback: '근거 없음', evidence: [] },
      },
    });
    await expect(ai.evaluate(row, '')).rejects.toThrow('unknown evidence');
  });
});
