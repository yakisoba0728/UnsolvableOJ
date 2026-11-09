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

  it('filters by tag with array containment and keeps the visibility filter', async () => {
    const { service, repository } = fixture([]);
    await service.findAll(
      Object.assign(new ListProblemsQuery(), { tag: '그래프' }),
    );
    const { where } = repository.find.mock.calls[0][0];
    expect(where.status).toBe(ProblemStatus.PUBLISHED);
    expect((where.tags as FindOperator<string[]>).type).toBe('arrayContains');
    expect((where.tags as FindOperator<string[]>).value).toEqual(['그래프']);
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
  it.each(['abc\0def', '\0', 'abc\uD800def', 'abc\uDC00def'])(
    'rejects PostgreSQL-unsafe slug %j before any database access',
    async (slug) => {
      const repository = { findOne: vi.fn(), find: vi.fn() };
      const db = { transaction: vi.fn(), query: vi.fn() };
      const service = new ProblemsService(
        repository as unknown as Repository<Problem>,
        db as unknown as DataSource,
      );
      await expect(service.findPublishedBySlug(slug)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.transaction).not.toHaveBeenCalled();
      expect(db.query).not.toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.find).not.toHaveBeenCalled();
    },
  );

  it.each(['SUM', 'legacy-한글-😀', 'literal-\\u0000', 'literal-%00'])(
    'does not tighten the format of PostgreSQL-safe lookup slug %j',
    async (slug) => {
      const findOneBy = vi
        .fn()
        .mockResolvedValue({ id: ids[0], slug: slug.toLowerCase() });
      const find = vi.fn().mockResolvedValue([]);
      const service = new ProblemsService(
        {} as Repository<Problem>,
        {
          transaction: vi.fn(async (isolation, run) => {
            expect(isolation).toBe('REPEATABLE READ');
            return run({ findOneBy, find, query: vi.fn().mockResolvedValue([]) });
          }),
        } as unknown as DataSource,
      );
      await expect(service.findPublishedBySlug(slug)).resolves.toMatchObject({
        slug: slug.toLowerCase(),
      });
      expect(findOneBy).toHaveBeenCalledWith(expect.anything(), {
        slug: slug.toLowerCase(),
        status: ProblemStatus.PUBLISHED,
      });
    },
  );

  it.each([
    [[{ input: '1\n', expectedOutput: '1\n', isSample: true }]],
    [[]],
  ])('loads only sample cases and returns %j', async (samples) => {
    const findOneBy = vi.fn().mockResolvedValue({ id: ids[0], slug: 'sum' });
    const find = vi.fn().mockResolvedValue(samples);
    const query = vi
      .fn()
      .mockResolvedValue([
        { problemId: ids[0], solverCount: 3, acceptanceRate: 42.9 },
      ]);
    const service = new ProblemsService(
      {} as Repository<Problem>,
      { transaction: vi.fn(async (isolation, run) => {
        expect(isolation).toBe('REPEATABLE READ');
        return run({ findOneBy, find, query });
      }) } as unknown as DataSource,
    );
    const result = await service.findPublishedBySlug('SUM');
    expect(findOneBy).toHaveBeenCalledWith(expect.anything(), {
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
    // Same aggregate as the list, read inside the detail snapshot transaction.
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM submissions'), [[ids[0]]]);
    expect(result).toMatchObject({ solverCount: 3, acceptanceRate: 42.9 });
  });
});

describe('problem update', () => {
  it('rejects an empty body as a bad request', async () => {
    const { service } = fixture([]);
    await expect(
      service.update(ids[0], {}, {
        id: ids[1],
        role: UserRole.AUTHOR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
