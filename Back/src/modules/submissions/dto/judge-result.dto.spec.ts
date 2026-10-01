import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { JudgeResultDto } from './judge-result.dto.js';

const output = {
  testCase: 1,
  stdout: '3\n',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
};
const verdict = { status: 'ACCEPTED', passedTestCases: 1, totalTestCases: 1 };

describe('judge debug output validation', () => {
  it('accepts bounded output and results from older workers', async () => {
    for (const body of [verdict, { ...verdict, debugOutputs: [output] }]) {
      expect(await validate(plainToInstance(JudgeResultDto, body))).toEqual([]);
    }
  });

  it('rejects malformed, oversized, and excessive output previews', async () => {
    for (const debugOutputs of [
      [{ ...output, stdout: 'x'.repeat(1001) }],
      [{ ...output, stderr: 'x'.repeat(1001) }],
      [{ ...output, testCase: 0 }],
      [{ ...output, stdoutTruncated: 'false' }],
      Array(6).fill(output),
    ]) {
      expect(
        (
          await validate(
            plainToInstance(JudgeResultDto, { ...verdict, debugOutputs }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
