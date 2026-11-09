import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
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
  const repository = {};
  // 목록은 SQL 한 벌(개수 묶음·태그·쪽·통계)로 읽는다. SQL 내용으로 어떤 쿼리인지 가린다.
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes('to_char')) return [{ createdAt: time }];
    if (sql.includes('GROUP BY 1, 2'))
      return [{ difficulty: 'BEGINNER', state: 'none', count: 10 }];
    if (sql.includes('unnest') || sql.includes('problem_id = ANY')) return [];
    return rows;
  });
  const listSql = () =>
    query.mock.calls.find(([sql]) => sql.includes('ORDER BY') && sql.includes('OFFSET')) as [string, unknown[]];
  return {
    repository,
    query,
    listSql,
    service: new ProblemsService(
      repository as unknown as Repository<Problem>,
      { query } as unknown as DataSource,
    ),
  };
}

const list = (values: Partial<ListProblemsQuery>) =>
  Object.assign(new ListProblemsQuery(), values);

describe('public problem list', () => {
  it('uses an exact-time cursor instead of moving offsets and retains visibility filters', async () => {
    const { service, listSql } = fixture(ids.map((id) => ({ id })));
    const result = await service.findAll(
      list({ page: 9, limit: 2, cursor: encode(ids[2]) }),
    );
    const [sql, params] = listSql();
    expect(sql).toContain("p.status = 'PUBLISHED' AND NOT p.is_private");
    expect(sql).toContain('(p.created_at, p.id) < ($1::timestamptz, $2::uuid)');
    expect(params).toEqual([time, ids[2], 3, 0]);
    expect(result.total).toBe(10);
    expect(result.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(readListCursor(result.nextCursor!)).toEqual({
      createdAt: time,
      id: ids[1],
    });
  });

  it('keeps legacy page offsets and does not manufacture a cursor on the last page', async () => {
    const { service, query, listSql } = fixture([{ id: ids[0] }]);
    const result = await service.findAll(list({ page: 2, limit: 2 }));
    expect(listSql()[1]).toEqual([3, 2]);
    expect(result).toMatchObject({ total: 10, totalPages: 5, nextCursor: null });
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('to_char'),
      expect.anything(),
    );
  });

  it('omits the cursor for other sorts so clients page by number', async () => {
    const { service } = fixture(ids.map((id) => ({ id })));
    const result = await service.findAll(list({ limit: 2, sort: 'title' }));
    expect(result).not.toHaveProperty('nextCursor');
    await expect(
      service.findAll(list({ sort: 'latest', reverse: 'true', cursor: encode(ids[0]) })),
    ).rejects.toThrow(BadRequestException);
  });

  it('filters by tag and keeps the visibility filter', async () => {
    const { service, listSql } = fixture([]);
    await service.findAll(list({ tag: '그래프' }));
    const [sql, params] = listSql();
    expect(sql).toContain("p.status = 'PUBLISHED' AND NOT p.is_private");
    expect(sql).toContain('$1 = ANY(p.tags)');
    expect(params[0]).toBe('그래프');
  });

  it('escapes LIKE wildcards in the search word', async () => {
    const { service, listSql } = fixture([]);
    await service.findAll(list({ q: ' 100%_\\a ' }));
    const [sql, params] = listSql();
    expect(sql).toContain("p.title ILIKE $1 ESCAPE '\\'");
    expect(params[0]).toBe('%100\\%\\_\\\\a%');
  });

  it('requires a login to filter by solve state', async () => {
    const { service, query } = fixture([]);
    await expect(service.findAll(list({ solve: ['solved'] }))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed cursors before accessing the database', async () => {
    const { service, query } = fixture([]);
    await expect(
      service.findAll(list({ cursor: 'invalid' })),
    ).rejects.toThrow(BadRequestException);
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
