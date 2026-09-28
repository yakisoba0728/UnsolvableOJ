import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../modules/users/user.entity.js';
import { Problem } from '../modules/problems/problem.entity.js';
import { TestCase } from '../modules/problems/test-case.entity.js';
import { Submission } from '../modules/submissions/submission.entity.js';
import { InitialSchema1726916400000 } from './migrations/1726916400000-initial-schema.js';
import { BackendFoundations1790550000000 } from './migrations/1790550000000-backend-foundations.js';
import { BackfillSolves1790551000000 } from './migrations/1790551000000-backfill-solves.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [User, Problem, TestCase, Submission],
  migrations: [
    InitialSchema1726916400000,
    BackendFoundations1790550000000,
    BackfillSolves1790551000000,
  ],
  synchronize: false,
});
