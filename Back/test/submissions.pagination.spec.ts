import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  FindOperator,
  type DataSource,
  type FindManyOptions,
  type FindOptionsWhere,
  type Repository,
} from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { Problem } from '../src/modules/problems/problem.entity.js';
import { ListSubmissionsQuery } from '../src/modules/submissions/dto/list-submissions.query.js';
import { SubmissionStatus } from '../src/modules/submissions/submission.enums.js';
import type { Submission } from '../src/modules/submissions/submission.entity.js';
import { SubmissionsService } from '../src/modules/submissions/submissions.service.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';

// Hydrated entity dates lose microseconds; cursor reads must use the stored value.
type StoredSubmission = Submission & { pgCreatedAt: string };
const encodeCursor = (parts: unknown) =>
  Buffer.from(JSON.stringify(parts)).toString('base64url');

function setup() {
  const user = {
    id: randomUUID(),
    email: 'solver@example.com',
    username: 'solver',
    role: UserRole.USER,
  };
  const problemId = randomUUID();
  const row = (
    suffix: number,
    pgCreatedAt: string,
    scope: Partial<Submission> = {},
  ) =>
    ({
      id: `30000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
      userId: user.id,
      problemId,
      status: SubmissionStatus.WRONG_ANSWER,
      createdAt: new Date(pgCreatedAt),
      pgCreatedAt,
      ...scope,
    }) as StoredSubmission;
  const rows = [
    row(1, '2026-10-20T00:00:00.123459Z'),
    row(5, '2026-10-20T00:00:00.123456Z'),
    row(4, '2026-10-20T00:00:00.123456Z'),
    row(9, '2026-10-20T00:00:00.123455Z'),
  ];
  function matches(item: StoredSubmission, where: FindOptionsWhere<Submission>) {
    if (where.userId !== undefined && item.userId !== where.userId) return false;
    if (where.problemId !== undefined && item.problemId !== where.problemId)
      return false;
    if (where.id instanceof FindOperator) {
      expect(where.id.type).toBe('lessThan');
      if (item.id >= where.id.value) return false;
    }
    if (where.createdAt === undefined) return true;
    expect(where.createdAt).toBeInstanceOf(FindOperator);
    const comparison = where.createdAt as FindOperator<Date>;
    expect(comparison.type).toBe('raw');
    const sql = comparison.getSql?.('created_at');
    expect([
      'created_at < :cursorTime::timestamptz',
      'created_at = :cursorTime::timestamptz',
    ]).toContain(sql);
    const boundary = comparison.objectLiteralParameters?.cursorTime as string;
    expect(typeof boundary).toBe('string');
    return sql === 'created_at < :cursorTime::timestamptz'
      ? item.pgCreatedAt < boundary
      : item.pgCreatedAt === boundary;
  }
  const submissions = {
    find: vi.fn(async (options: FindManyOptions<Submission>) => {
      const where = options.where ?? {};
      const branches = Array.isArray(where) ? where : [where];
      const ordered = rows
        .filter((item) => branches.some((branch) => matches(item, branch)))
        .sort(
          (left, right) =>
            right.pgCreatedAt.localeCompare(left.pgCreatedAt) ||
            right.id.localeCompare(left.id),
        );
      const start = options.skip ?? 0;
      return ordered.slice(start, start + (options.take ?? rows.length));
    }),
    count: vi.fn(async ({ where }: { where: FindOptionsWhere<Submission> }) =>
      rows.filter((item) => matches(item, where)).length,
    ),
  };
  const db = {
    query: vi.fn(async (_sql: string, [id]: string[]) => {
      const item = rows.find((candidate) => candidate.id === id);
      return item ? [{ createdAt: item.pgCreatedAt }] : [];
    }),
  };
  const service = new SubmissionsService(
    submissions as unknown as Repository<Submission>,
    {} as Repository<Problem>,
    db as unknown as DataSource,
    {} as Queue,
  );
  return { service, submissions, db, rows, row, user, problemId };
}

describe('stable submission traversal', () => {
  it('survives head inserts, equal-time UUID ties, and sub-millisecond timestamps', async () => {
    const { service, submissions, db, rows, row, user } = setup();
    const originalIds = rows.map((item) => item.id);
    expect(rows[0].createdAt.getTime()).toBe(rows[1].createdAt.getTime());
    const first = await service.findMine(user, { page: 1, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(originalIds.slice(0, 2));
    expect(
      JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')),
    ).toEqual(['2026-10-20T00:00:00.123456Z', originalIds[1]]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM submissions'),
      [originalIds[1]],
    );

    rows.unshift(row(8, '2026-10-20T00:00:00.123999Z'));
    const next = await service.findMine(user, {
      page: 99,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(next.items.map((item) => item.id)).toEqual(originalIds.slice(2));
    expect([...first.items, ...next.items].map((item) => item.id)).toEqual(
      originalIds,
    );
    expect(next).toMatchObject({
      page: 99,
      limit: 2,
      total: 5,
      totalPages: 3,
      nextCursor: null,
    });
    expect(submissions.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 0, take: 3 }),
    );
    expect(submissions.count).toHaveBeenLastCalledWith({
      where: { userId: user.id },
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('keeps user and problem filters on both cursor branches and the global count', async () => {
    const { service, submissions, rows, row, user, problemId } = setup();
    const originalIds = rows.map((item) => item.id);
    rows.push(
      row(10, '2026-10-20T00:00:00.123455Z', { userId: randomUUID() }),
      row(2, '2026-10-20T00:00:00.123456Z', { userId: randomUUID() }),
      row(11, '2026-10-20T00:00:00.123455Z', { problemId: randomUUID() }),
      row(3, '2026-10-20T00:00:00.123456Z', { problemId: randomUUID() }),
    );
    const first = await service.findMine(user, { page: 1, limit: 2, problemId });
    const next = await service.findMine(user, {
      page: 2,
      limit: 2,
      problemId,
      cursor: first.nextCursor!,
    });
    expect(next.items.map((item) => item.id)).toEqual(originalIds.slice(2));
    expect(next).toMatchObject({ total: 4, totalPages: 2, nextCursor: null });
    const branches = submissions.find.mock.calls.at(-1)![0]
      .where as FindOptionsWhere<Submission>[];
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch).toMatchObject({ userId: user.id, problemId });
      expect(
        (branch.createdAt as FindOperator<Date>).objectLiteralParameters,
      ).toEqual({
        cursorTime: '2026-10-20T00:00:00.123456Z',
      });
    }
    expect(submissions.count).toHaveBeenLastCalledWith({
      where: { userId: user.id, problemId },
    });
  });

  it('retains legacy offset pages, excludes source/debug columns, and ends without a cursor query', async () => {
    const { service, submissions, db, rows, user } = setup();
    const page = await service.findMine(user, { page: 2, limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([rows[1].id]);
    expect(page).toMatchObject({ page: 2, limit: 1, total: 4, totalPages: 4 });
    const options = submissions.find.mock.calls[0][0];
    expect(options).toMatchObject({
      skip: 1,
      take: 2,
      relations: { problem: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    expect(options.select).not.toHaveProperty('sourceCode');
    expect(options.select).not.toHaveProperty('debugOutputs');
    expect(page.items[0]).not.toHaveProperty('sourceCode');
    expect(page.items[0]).not.toHaveProperty('debugOutputs');
    expect(
      (await service.findMine(user, { page: 4, limit: 1 })).nextCursor,
    ).toBeNull();
    expect(await service.findMine(user, { page: 5, limit: 1 })).toMatchObject({
      items: [],
      total: 4,
      nextCursor: null,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    '',
    'not-a-cursor',
    'x'.repeat(257),
    encodeCursor(['2026-10-20T00:00:00.123Z', randomUUID()]),
    encodeCursor(['2026-02-30T00:00:00.123456Z', randomUUID()]),
    encodeCursor(['2026-10-20T00:00:00.123456Z', 'invalid-id']),
  ])('rejects invalid cursor %j before accessing storage', async (cursor) => {
    const { service, submissions, db, user } = setup();
    await expect(
      service.findMine(user, { page: 1, limit: 2, cursor }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(submissions.find).not.toHaveBeenCalled();
    expect(submissions.count).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('submission cursor query validation', () => {
  it('accepts omitted or bounded strings and rejects nonstrings or oversized cursors', async () => {
    for (const body of [{}, { cursor: 'x'.repeat(256) }]) {
      expect(await validate(plainToInstance(ListSubmissionsQuery, body))).toEqual(
        [],
      );
    }
    for (const cursor of [123, {}, ['cursor'], 'x'.repeat(257)]) {
      expect(
        (await validate(plainToInstance(ListSubmissionsQuery, { cursor }))).length,
      ).toBeGreaterThan(0);
    }
  });
});
