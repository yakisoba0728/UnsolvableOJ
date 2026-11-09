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

  it('trims tags and defaults tags/editorial on create only', async () => {
    const created = await pipe.transform(
      {
        slug: 'tagged',
        title: 'Tagged',
        statementMarkdown: '',
        inputDescriptionMarkdown: '',
        outputDescriptionMarkdown: '',
        difficulty: 'BEGINNER',
        testCases: [{ input: '', expectedOutput: '', isSample: true }],
      },
      { type: 'body', metatype: CreateProblemDto },
    );
    expect(created).toMatchObject({ tags: [], editorialMarkdown: '' });
    const updated = await pipe.transform(
      { tags: [' 수학 ', '그래프'], editorialMarkdown: '# 해설' },
      { type: 'body', metatype: UpdateProblemDto },
    );
    expect(updated).toEqual({
      tags: ['수학', '그래프'],
      editorialMarkdown: '# 해설',
    });
  });

  it.each([
    { name: 'null tags', body: { tags: null } },
    { name: 'non-array tags', body: { tags: '수학' } },
    { name: 'blank tag', body: { tags: ['  '] } },
    { name: 'long tag', body: { tags: ['가'.repeat(31)] } },
    { name: 'too many tags', body: { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } },
    { name: 'duplicate after trim', body: { tags: ['dp', ' dp'] } },
    { name: 'non-string tag', body: { tags: [1] } },
    { name: 'NUL tag', body: { tags: ['a\0b'] } },
    { name: 'unpaired surrogate tag', body: { tags: ['a\uD800'] } },
    { name: 'null editorial', body: { editorialMarkdown: null } },
    { name: 'long editorial', body: { editorialMarkdown: 'a'.repeat(100_001) } },
    { name: 'NUL editorial', body: { editorialMarkdown: 'a\0' } },
  ])('rejects $name', async ({ body }) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: UpdateProblemDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

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

  describe.each([
    { name: 'CreateProblemDto', metatype: CreateProblemDto },
    { name: 'UpdateProblemDto', metatype: UpdateProblemDto },
  ])('$name test-case elements', ({ metatype }) => {
    const testCase = { input: ' \n', expectedOutput: '', isSample: false };
    const content = {
      slug: 'test-case-shape',
      title: 'Test case shape',
      statementMarkdown: '',
      inputDescriptionMarkdown: '',
      outputDescriptionMarkdown: '',
      difficulty: 'BEGINNER',
    };
    const validate = (testCases: unknown) =>
      pipe.transform(
        metatype === CreateProblemDto ? { ...content, testCases } : { testCases },
        { type: 'body', metatype },
      );

    it.each([
      { name: 'empty array element', value: [[]] },
      { name: 'nested valid object array', value: [[testCase]] },
      { name: 'empty and nested valid arrays', value: [[], [testCase]] },
      { name: 'mixed object and array', value: [testCase, []] },
      { name: 'null element', value: [null] },
      { name: 'string element', value: ['case'] },
      { name: 'number element', value: [1] },
      { name: 'boolean element', value: [true] },
      { name: 'incomplete object', value: [{}] },
      { name: 'null collection', value: null },
      { name: 'non-array collection', value: testCase },
    ])('rejects $name through the real ValidationPipe', async ({ value }) => {
      await expect(validate(value)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts hidden-only objects and preserves empty/whitespace input and output', async () => {
      const testCases = [
        testCase,
        { input: '', expectedOutput: '\t\r\n ', isSample: false },
      ];
      const dto = await validate(testCases);
      expect(dto.testCases).toMatchObject(testCases);
      expect(
        dto.testCases.every((item: { score: number }) => item.score === 1),
      ).toBe(true);
    });
  });
});
