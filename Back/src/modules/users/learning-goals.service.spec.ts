import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource, EntityManager } from 'typeorm';
import { SetLearningGoalDto } from './dto/learning-goal.dto.js';
import { LearningGoalsService } from './learning-goals.service.js';
import { UserRole } from './user-role.enum.js';

describe('private learning goal boundary', () => {
  it.each([
    { targetProblems: 0, days: 7 },
    { targetProblems: 1001, days: 7 },
    { targetProblems: 1.5, days: 30 },
    { targetProblems: '10', days: 30 },
    { targetProblems: 10, days: 8 },
    { targetProblems: 10, days: '7' },
    { targetProblems: 10, days: 7, userId: 'another-account' },
    { targetProblems: 10, days: 7, solvedProblems: 10 },
  ])('rejects invalid or server-owned input %j', async (input) => {
    const errors = await validate(plainToInstance(SetLearningGoalDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([7, 30, 90])(
    'accepts an integer target in the %i-day window',
    async (days) => {
      expect(
        await validate(
          plainToInstance(SetLearningGoalDto, { targetProblems: 1000, days }),
        ),
      ).toEqual([]);
    },
  );

  it.each(['set', 'reset', 'remove'] as const)(
    'fences %s if the caller became inactive after authentication',
    async (action) => {
      const query = vi.fn().mockResolvedValue([]);
      const service = new LearningGoalsService({
        transaction: (
          run: (manager: Pick<EntityManager, 'query'>) => unknown,
        ) => run({ query }),
      } as unknown as DataSource);
      const user = { id: 'owner', role: UserRole.USER, tokenVersion: 3 };
      const result =
        action === 'set'
          ? service.set(user, { targetProblems: 10, days: 7 })
          : service[action](user);
      await expect(result).rejects.toThrow(UnauthorizedException);
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
});
