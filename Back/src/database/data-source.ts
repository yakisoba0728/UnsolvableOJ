import 'dotenv/config';
import { VibeCoding1795400000000 } from './migrations/1795400000000-vibe-coding.js';
import { Missions1793000000000 } from './migrations/1793000000000-missions.js';
import { DebugOutputs1790552000000 } from './migrations/1790552000000-debug-outputs.js';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from '../config/database.config.js';
import { User } from '../modules/users/user.entity.js';
import { Problem } from '../modules/problems/problem.entity.js';
import { TestCase } from '../modules/problems/test-case.entity.js';
import { Submission } from '../modules/submissions/submission.entity.js';
import { InitialSchema1726916400000 } from './migrations/1726916400000-initial-schema.js';
import { BackendFoundations1790550000000 } from './migrations/1790550000000-backend-foundations.js';
import { BackfillSolves1790551000000 } from './migrations/1790551000000-backfill-solves.js';
import { SubmissionXpEvidence1790553000000 } from './migrations/1790553000000-submission-xp-evidence.js';
import { BackendHardening1790554000000 } from './migrations/1790554000000-backend-hardening.js';
import { Community1791200000000 } from './migrations/1791200000000-community.js';
import { CommunityUi1791200001000 } from './migrations/1791200001000-community-ui.js';
import { LearningEvidence1793001000000 } from './migrations/1793001000000-learning-evidence.js';
import { UserSuspension1794100000000 } from './migrations/1794100000000-user-suspension.js';
import { ProblemTagsEditorial1794200000000 } from './migrations/1794200000000-problem-tags-editorial.js';
import { CommunityModerationNotifications1794300000000 } from './migrations/1794300000000-community-moderation-notifications.js';
import { TestSubmissions1794400000000 } from './migrations/1794400000000-test-submissions.js';
import { PrivateProblems1794500000000 } from './migrations/1794500000000-private-problems.js';
import { EnterpriseTests1794600000000 } from './migrations/1794600000000-enterprise-tests.js';
import { RefreshTokens1794700000000 } from './migrations/1794700000000-refresh-tokens.js';
import { AccountSecurity1795000000000 } from './migrations/1795000000000-account-security.js';
import { EnterpriseInvites1795100000000 } from './migrations/1795100000000-enterprise-invites.js';
import { ProblemStats1795200000000 } from './migrations/1795200000000-problem-stats.js';
import { TestResults1795300000000 } from './migrations/1795300000000-test-results.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

export default new DataSource({
  type: 'postgres',
  ...databaseConnectionOptions(
    databaseUrl,
    process.env.DATABASE_SSL === 'true',
  ),
  entities: [User, Problem, TestCase, Submission],
  migrations: [
    InitialSchema1726916400000,
    BackendFoundations1790550000000,
    BackfillSolves1790551000000,
    DebugOutputs1790552000000,
    SubmissionXpEvidence1790553000000,
    BackendHardening1790554000000,
    Community1791200000000,
    CommunityUi1791200001000,
    Missions1793000000000,
    LearningEvidence1793001000000,
    UserSuspension1794100000000,
    ProblemTagsEditorial1794200000000,
    CommunityModerationNotifications1794300000000,
    TestSubmissions1794400000000,
    PrivateProblems1794500000000,
    EnterpriseTests1794600000000,
    RefreshTokens1794700000000,
    AccountSecurity1795000000000,
    EnterpriseInvites1795100000000,
    ProblemStats1795200000000,
    TestResults1795300000000,
    VibeCoding1795400000000,
  ],
  synchronize: false,
});
