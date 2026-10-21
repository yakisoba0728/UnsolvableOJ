import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createListCursor, readListCursor } from './list-cursor.js';

const id = '10000000-0000-4000-8000-000000000001';
const createdAt = '2026-10-20T10:00:00.123456Z';
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('list cursors', () => {
  it('preserves the microseconds that JavaScript dates discard', async () => {
    const query = vi.fn().mockResolvedValue([{ createdAt }]);
    const cursor = await createListCursor(
      { query } as unknown as DataSource,
      'submissions',
      id,
    );
    expect(readListCursor(cursor)).toEqual({ createdAt, id });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SS.US'),
      [id],
    );
    expect(readListCursor(undefined)).toBeUndefined();
  });

  it.each([
    '',
    'not-a-cursor',
    'x'.repeat(257),
    encode([createdAt, id]) + '=',
    encode([createdAt]),
    encode(['2026-02-30T10:00:00.123456Z', id]),
    encode(['2026-10-20T10:00:00.123Z', id]),
    encode([createdAt, 'not-a-uuid']),
    encode({ createdAt, id }),
  ])('rejects malformed cursors: %s', (cursor) => {
    expect(() => readListCursor(cursor)).toThrow(BadRequestException);
  });

  it('does not silently truncate when the anchor was deleted', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(
      createListCursor({ query } as unknown as DataSource, 'problems', id),
    ).rejects.toThrow(ConflictException);
  });
});
