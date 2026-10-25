import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateProblemDto } from '../modules/problems/dto/create-problem.dto.js';
import { UpdateProblemDto } from '../modules/problems/dto/update-problem.dto.js';
import { CreateSubmissionDto } from '../modules/submissions/dto/create-submission.dto.js';

describe('PostgreSQL-unsafe user text', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (metatype: new () => object, body: object) =>
    pipe.transform(body, { type: 'body', metatype });
  const testCases = (overrides: object) => ({
    testCases: [
      { input: '1\n', expectedOutput: '1\n', isSample: true, ...overrides },
    ],
  });
  const problem = (overrides: object) => ({
    slug: 'new-problem',
    title: 'New',
    statementMarkdown: '',
    inputDescriptionMarkdown: '',
    outputDescriptionMarkdown: '',
    difficulty: 'BEGINNER',
    ...testCases({}),
    ...overrides,
  });

  describe.each(['\0', '\uD800', '\uDC00', 'a\uDE00b'])('%j', (unsafe) => {
    it.each([
      ['title', { title: `T${unsafe}` }],
      ['statementMarkdown', { statementMarkdown: unsafe }],
      ['inputDescriptionMarkdown', { inputDescriptionMarkdown: unsafe }],
      ['outputDescriptionMarkdown', { outputDescriptionMarkdown: unsafe }],
      ['input', testCases({ input: unsafe })],
      ['expectedOutput', testCases({ expectedOutput: unsafe })],
    ])('rejects problem %s on create and update', async (field, body) => {
      for (const [metatype, value] of [
        [CreateProblemDto, problem(body)],
        [UpdateProblemDto, body],
      ] as const) {
        const error: unknown = await validate(metatype, value).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(BadRequestException);
        expect(
          JSON.stringify((error as BadRequestException).getResponse()),
        ).toContain(`${field}에는 NUL`);
      }
    });

    it('rejects submission source code', async () => {
      await expect(
        validate(CreateSubmissionDto, {
          language: 'PYTHON',
          sourceCode: `print(1)${unsafe}`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('keeps accepting Unicode text, emoji pairs and escaped NUL', async () => {
    const text = '한글 😀\t\r\n\\u0000';
    await expect(
      validate(
        CreateProblemDto,
        problem({
          title: text,
          statementMarkdown: text,
          ...testCases({ input: text, expectedOutput: text }),
        }),
      ),
    ).resolves.toMatchObject({ title: text, statementMarkdown: text });
    await expect(
      validate(CreateSubmissionDto, { language: 'PYTHON', sourceCode: text }),
    ).resolves.toMatchObject({ sourceCode: text });
  });
});
