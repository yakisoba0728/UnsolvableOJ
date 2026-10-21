import 'dotenv/config';
import { DebugOutputs1790552000000 } from './migrations/1790552000000-debug-outputs.js';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from '../config/env.validation.js';
import { User } from '../modules/users/user.entity.js';
import { Problem } from '../modules/problems/problem.entity.js';
import { TestCase } from '../modules/problems/test-case.entity.js';
import { Submission } from '../modules/submissions/submission.entity.js';
import { InitialSchema1726916400000 } from './migrations/1726916400000-initial-schema.js';
import { BackendFoundations1790550000000 } from './migrations/1790550000000-backend-foundations.js';
import { BackfillSolves1790551000000 } from './migrations/1790551000000-backfill-solves.js';
import { SubmissionXpEvidence1790553000000 } from './migrations/1790553000000-submission-xp-evidence.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

export default new DataSource({
  type: 'postgres',
  ...databaseConnectionOptions(databaseUrl, process.env.DATABASE_SSL === 'true'),
  entities: [User, Problem, TestCase, Submission],
  migrations: [
    InitialSchema1726916400000,
    BackendFoundations1790550000000,
    BackfillSolves1790551000000,
    DebugOutputs1790552000000,
    SubmissionXpEvidence1790553000000,
  ],
  synchronize: false,
});
