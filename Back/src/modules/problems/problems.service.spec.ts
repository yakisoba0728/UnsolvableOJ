import { BadRequestException } from '@nestjs/common';
import type { DataSource, FindOperator, Repository } from 'typeorm';
import { readListCursor } from '../../common/list-cursor.js';
import { ListProblemsQuery } from './dto/list-problems.query.js';
import type { Problem } from './problem.entity.js';
import { ProblemStatus } from './problem.enums.js';
import { ProblemsService } from './problems.service.js';
import { UserRole } from '../users/user-role.enum.js';

const ids = [1, 2, 3].map(
  (value) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`,
);
const time = '2026-10-20T10:00:00.123456Z';
const encode = (id: string) =>
  Buffer.from(JSON.stringify([time, id])).toString('base64url');

function fixture(rows: { id: string }[]) {
  const repository = {
    find: vi.fn().mockResolvedValue(rows),
    count: vi.fn().mockResolvedValue(10),
  };
  const query = vi.fn(async (sql: string) =>
    sql.includes('to_char') ? [{ createdAt: time }] : [],
  );
  return {
    repository,
    query,
    service: new ProblemsService(
      repository as unknown as Repository<Problem>,
      { query } as unknown as DataSource,
    ),
  };
}

describe('public problem continuation', () => {
  it('uses an exact-time cursor instead of moving offsets and retains visibility filters', async () => {
    const { service, repository } = fixture(ids.map((id) => ({ id })));
    const result = await service.findAll(
      Object.assign(new ListProblemsQuery(), {
        page: 9,
        limit: 2,
        cursor: encode(ids[2]),
      }),
    );
    const options = repository.find.mock.calls[0][0];
    expect(options).toMatchObject({ skip: 0, take: 3 });
    const [older, tied] = options.where;
    expect(older.status).toBe(ProblemStatus.PUBLISHED);
    expect(tied.status).toBe(ProblemStatus.PUBLISHED);
    expect(
      (older.createdAt as FindOperator<Date>).objectLiteralParameters,
    ).toEqual({ cursorTime: time });
    expect((tied.id as FindOperator<string>).value).toBe(ids[2]);
    expect(repository.count).toHaveBeenCalledWith({
      where: { status: ProblemStatus.PUBLISHED },
    });
    expect(result.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(readListCursor(result.nextCursor!)).toEqual({
      createdAt: time,
      id: ids[1],
    });
  });

  it('keeps legacy page offsets and does not manufacture a cursor on the last page', async () => {
    const { service, repository, query } = fixture([{ id: ids[0] }]);
    const result = await service.findAll(
      Object.assign(new ListProblemsQuery(), { page: 2, limit: 2 }),
    );
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2, take: 3 }),
    );
    expect(result).toMatchObject({ total: 10, totalPages: 5, nextCursor: null });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('to_char'),
      expect.anything(),
    );
  });

  it('rejects malformed cursors before accessing the database', async () => {
    const { service, repository, query } = fixture([]);
    await expect(
      service.findAll(
        Object.assign(new ListProblemsQuery(), { cursor: 'invalid' }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.count).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('public problem detail', () => {
  it.each([
    [[{ input: '1\n', expectedOutput: '1\n', isSample: true }]],
    [[]],
  ])('loads only sample cases and returns %j', async (samples) => {
    const findOneBy = vi.fn().mockResolvedValue({ id: ids[0], slug: 'sum' });
    const find = vi.fn().mockResolvedValue(samples);
    const service = new ProblemsService(
      { findOneBy } as unknown as Repository<Problem>,
      { manager: { find } } as unknown as DataSource,
    );
    const result = await service.findPublishedBySlug('SUM');
    expect(findOneBy).toHaveBeenCalledWith({
      slug: 'sum',
      status: ProblemStatus.PUBLISHED,
    });
    expect(find).toHaveBeenCalledWith(expect.anything(), {
      where: { problemId: ids[0], isSample: true },
      order: { order: 'ASC' },
    });
    expect(result.samples).toEqual(
      samples.map(({ input, expectedOutput }) => ({ input, expectedOutput })),
    );
  });
});

describe('problem update', () => {
  it('rejects an empty body as a bad request', async () => {
    const { service } = fixture([]);
    await expect(
      service.update(ids[0], {}, {
        id: ids[1],
        email: 'author@example.com',
        username: 'author',
        role: UserRole.AUTHOR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
