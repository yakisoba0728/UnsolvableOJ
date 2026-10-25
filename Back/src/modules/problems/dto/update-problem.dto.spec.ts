import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProblemDto } from './create-problem.dto.js';
import { UpdateProblemDto } from './update-problem.dto.js';

describe('Problem DTO validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('preserves omitted fields in partial and empty updates', async () => {
    for (const body of [{ title: 'New title' }, {}]) {
      const dto = await pipe.transform(body, {
        type: 'body',
        metatype: UpdateProblemDto,
      });
      expect(dto).toEqual(body);
      expect(Object.keys(dto)).toEqual(Object.keys(body));
    }
  });

  it.each(['title', 'timeLimitMs', 'memoryLimitMb', 'testCases'])(
    'rejects null %s instead of bypassing validation',
    async (field) => {
      await expect(
        pipe.transform(
          { [field]: null },
          { type: 'body', metatype: UpdateProblemDto },
        ),
      ).rejects.toThrow();
    },
  );

  it('rejects a null status instead of overwriting the DRAFT default', async () => {
    await expect(
      pipe.transform(
        {
          slug: 'new-problem',
          title: 'New',
          statementMarkdown: '',
          inputDescriptionMarkdown: '',
          outputDescriptionMarkdown: '',
          difficulty: 'BEGINNER',
          status: null,
          testCases: [{ input: '', expectedOutput: '', isSample: true }],
        },
        { type: 'body', metatype: CreateProblemDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still supplies limits when creating a problem', async () => {
    const dto = await pipe.transform(
      {
        slug: 'new-problem',
        title: 'New',
        statementMarkdown: '',
        inputDescriptionMarkdown: '',
        outputDescriptionMarkdown: '',
        difficulty: 'BEGINNER',
        testCases: [{ input: '', expectedOutput: '', isSample: true }],
      },
      { type: 'body', metatype: CreateProblemDto },
    );
    expect(dto).toMatchObject({
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      status: 'DRAFT',
    });
  });
});
