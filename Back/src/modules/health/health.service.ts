import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import type { DataSource } from 'typeorm';
import { JUDGE_QUEUE } from '../../common/queue.constants.js';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(JUDGE_QUEUE) private readonly judgeQueue: Queue,
  ) {}

  async check() {
    const [database, redis] = await Promise.allSettled([
      this.dataSource.query('SELECT 1'),
      this.judgeQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);
    const dependencies = {
      database: database.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
    };

    if (database.status === 'rejected' || redis.status === 'rejected') {
      throw new ServiceUnavailableException({
        status: 'degraded',
        dependencies,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      dependencies,
      queue: redis.value,
      timestamp: new Date().toISOString(),
    };
  }
}
