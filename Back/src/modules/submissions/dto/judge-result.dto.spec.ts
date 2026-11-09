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
const testResult = {
  testCase: 1,
  isSample: false,
  status: 'WRONG_ANSWER',
  runtimeMs: 12,
  memoryKb: 2048,
};

describe('judge debug output validation', () => {
  it('accepts bounded output and results from older workers', async () => {
    for (const body of [
      verdict,
      { ...verdict, debugOutputs: [output] },
      { ...verdict, testResults: [testResult] },
    ]) {
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

  it('rejects malformed and excessive test results', async () => {
    for (const testResults of [
      [{ ...testResult, testCase: 0 }],
      [{ ...testResult, status: 'COMPILE_ERROR' }],
      [{ ...testResult, runtimeMs: -1 }],
      [{ ...testResult, memoryKb: 1_000_000_001 }],
      [{ ...testResult, isSample: 'false' }],
      [{ ...testResult, runtimeMs: 1.5 }],
      Array(101).fill(testResult),
    ]) {
      expect(
        (
          await validate(
            plainToInstance(JudgeResultDto, { ...verdict, testResults }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
