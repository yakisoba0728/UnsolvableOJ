import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { ProblemBookmarksService } from './problem-bookmarks.service.js';
import { UserRole } from '../users/user-role.enum.js';

const user = { id: 'owner-id', role: UserRole.USER, tokenVersion: 3 };

describe('private problem bookmarks', () => {
  it('does not create a bookmark when an authenticated actor became inactive', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'problem-id' }]).mockResolvedValueOnce([]);
    const service = new ProblemBookmarksService({
      transaction: (run: (manager: Pick<EntityManager, 'query'>) => unknown) => run({ query }),
    } as unknown as DataSource);
    await expect(service.save('problem-id', user)).rejects.toThrow(UnauthorizedException);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not insert when the public problem disappeared after authentication', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new ProblemBookmarksService({
      transaction: (run: (manager: Pick<EntityManager, 'query'>) => unknown) => run({ query }),
    } as unknown as DataSource);
    await expect(service.save('problem-id', user)).rejects.toThrow(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns no bookmark state for an unavailable problem', async () => {
    const service = new ProblemBookmarksService({ query: vi.fn().mockResolvedValue([]) } as unknown as DataSource);
    await expect(service.get('problem-id', user)).rejects.toThrow(NotFoundException);
  });
});
