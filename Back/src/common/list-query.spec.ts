import { ValidationPipe } from '@nestjs/common';
import { ListProblemsQuery } from '../modules/problems/dto/list-problems.query.js';
import { ListSubmissionsQuery } from '../modules/submissions/dto/list-submissions.query.js';

describe.each([ListProblemsQuery, ListSubmissionsQuery])(
  'list page limits: %s',
  (metatype) => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    it('supports bounded 1000-item pages while preserving the default', async () => {
      expect(
        await pipe.transform({}, { type: 'query', metatype }),
      ).toMatchObject({ page: 1, limit: 20 });
      expect(
        await pipe.transform(
          { page: '6', limit: '1000' },
          { type: 'query', metatype },
        ),
      ).toMatchObject({ page: 6, limit: 1000 });
    });

    it.each(['0', '1001', '1.5'])(
      'rejects invalid page size %s',
      async (limit) => {
        await expect(
          pipe.transform({ limit }, { type: 'query', metatype }),
        ).rejects.toThrow();
      },
    );
  },
);
