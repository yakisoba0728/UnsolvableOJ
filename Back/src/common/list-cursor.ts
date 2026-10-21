import { BadRequestException, ConflictException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import type { DataSource } from 'typeorm';

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
