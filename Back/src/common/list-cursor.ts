import { BadRequestException, ConflictException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import {
  LessThan,
  Raw,
  type DataSource,
  type FindManyOptions,
  type FindOptionsOrder,
  type FindOptionsWhere,
  type Repository,
} from 'typeorm';
import type { ListQuery } from './list-query.js';

export function readListCursor(value?: string) {
  if (value === undefined) return undefined;
  try {
    if (value.length > 256) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const parts: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(parts) ||
      parts.length !== 2 ||
      typeof parts[0] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parts[0]) ||
      !isISO8601(parts[0], { strict: true, strictSeparator: true }) ||
      typeof parts[1] !== 'string' ||
      !isUUID(parts[1])
    )
      throw new Error();
    return { createdAt: parts[0], id: parts[1] };
  } catch {
    throw new BadRequestException('목록 커서가 올바르지 않습니다.');
  }
}

export async function createListCursor(
  db: DataSource,
  table: 'problems' | 'submissions',
  id: string,
) {
  // JavaScript Date drops PostgreSQL microseconds and would skip nearby rows.
  const rows = await db.query<{ createdAt: string }[]>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
     FROM ${table} WHERE id = $1`,
    [id],
  );
  if (!rows[0])
    throw new ConflictException('목록이 변경되었습니다. 다시 불러와 주세요.');
  return Buffer.from(JSON.stringify([rows[0].createdAt, id])).toString(
    'base64url',
  );
}

export async function findListPage<T extends { id: string; createdAt: Date }>(
  repository: Repository<T>,
  db: DataSource,
  table: 'problems' | 'submissions',
  query: ListQuery,
  where: FindOptionsWhere<T>,
  options: Pick<FindManyOptions<T>, 'select' | 'relations'>,
) {
  const cursor = readListCursor(query.cursor);
  const pageWhere = cursor
    ? ([
        {
          ...where,
          createdAt: Raw((alias) => `${alias} < :cursorTime::timestamptz`, {
            cursorTime: cursor.createdAt,
          }),
        },
        {
          ...where,
          createdAt: Raw((alias) => `${alias} = :cursorTime::timestamptz`, {
            cursorTime: cursor.createdAt,
          }),
          id: LessThan(cursor.id),
        },
      ] as FindOptionsWhere<T>[])
    : where;
  const [rows, total] = await Promise.all([
    repository.find({
      ...options,
      where: pageWhere,
      order: { createdAt: 'DESC', id: 'DESC' } as FindOptionsOrder<T>,
      skip: cursor ? 0 : (query.page - 1) * query.limit,
      take: query.limit + 1,
    }),
    repository.count({ where }),
  ]);
  const items = rows.slice(0, query.limit);
  const nextCursor =
    rows.length > query.limit
      ? await createListCursor(db, table, items.at(-1)!.id)
      : null;
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
    nextCursor,
  };
}
