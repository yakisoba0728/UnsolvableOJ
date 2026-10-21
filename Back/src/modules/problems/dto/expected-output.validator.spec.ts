import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateProblemDto, CreateTestCaseDto } from './create-problem.dto.js';
import { UpdateProblemDto } from './update-problem.dto.js';

describe('expected output byte limit', () => {
  function errors(expectedOutput: unknown) {
    return validateSync(
      plainToInstance(CreateTestCaseDto, {
        input: '',
        expectedOutput,
        isSample: true,
      }),
    );
  }

  it('accepts 999999 ASCII bytes and rejects 1000000', () => {
    expect(errors('a'.repeat(999_999))).toEqual([]);
    expect(errors('a'.repeat(1_000_000))).toHaveLength(1);
  });

  it('counts UTF-8 bytes for multibyte output, not characters', () => {
    const output = '가'.repeat(333_333);
    expect(errors(output)).toEqual([]);
    expect(errors(output + 'a')).toHaveLength(1);
    expect(errors('가'.repeat(400_000))).toHaveLength(1);
  });

  it.each(['\t', '\n', '\v', '\f', '\r', ' '])(
    'excludes trailing ASCII whitespace %j from the byte limit',
    (suffix) => {
      expect(errors('a'.repeat(999_999) + suffix)).toEqual([]);
      expect(errors('가'.repeat(333_333) + 'a' + suffix)).toHaveLength(1);
    },
  );

  it('does not exclude leading or embedded ASCII whitespace or trailing NBSP', () => {
    for (const output of [
      ' '.repeat(999_999) + 'a',
      'a'.repeat(999_998) + '\nb',
      'a'.repeat(999_999) + '\u00a0',
      '가'.repeat(333_333) + '\u00a0\t\n\v\f\r ',
    ]) {
      expect(errors(output)).toHaveLength(1);
    }
  });

  it('allows empty outputs and keeps the existing raw character bound', () => {
    expect(errors('')).toEqual([]);
    expect(errors('\t\n\v\f\r ')).toEqual([]);
    expect(errors(' '.repeat(1_000_000))).toEqual([]);
    expect(errors(' '.repeat(1_000_001))).toHaveLength(1);
  });

  it.each([null, 1, {}])('still rejects non-string output %j', (value) => {
    expect(errors(value)).toHaveLength(1);
  });
});

describe.each([
  {
    name: 'CreateProblemDto',
    metatype: CreateProblemDto,
    fields: { slug: 'new-problem' },
  },
  { name: 'UpdateProblemDto', metatype: UpdateProblemDto, fields: {} },
])('$name expected output validation', ({ metatype, fields }) => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const content = {
    ...fields,
    title: 'New',
    statementMarkdown: '',
    inputDescriptionMarkdown: '',
    outputDescriptionMarkdown: '',
    difficulty: 'BEGINNER',
  };

  it('inherits the limit and preserves raw output for API and importer validation', async () => {
    const expectedOutput = '가'.repeat(333_333) + '\t\n\v\f\r ';
    const body = {
      ...content,
      testCases: [{ input: '', expectedOutput, isSample: true }],
    };
    const dto = await pipe.transform(body, { type: 'body', metatype });
    expect(dto.testCases[0].expectedOutput).toBe(expectedOutput);
    expect(
      validateSync(plainToInstance<object, object>(metatype, body)),
    ).toEqual([]);
  });

  it('rejects unjudgeable output in the nested shared test-case DTO', async () => {
    const body = {
      ...content,
      testCases: [
        { input: '', expectedOutput: '가'.repeat(333_333) + 'a', isSample: true },
      ],
    };
    expect(
      validateSync(plainToInstance<object, object>(metatype, body)),
    ).toHaveLength(1);
    await expect(
      pipe.transform(body, { type: 'body', metatype }),
    ).rejects.toThrow();
  });
});
