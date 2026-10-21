import { randomBytes } from 'node:crypto';
import dataSource from '../dist/database/data-source.js';
import { PasswordHasher } from '../dist/modules/auth/password-hasher.service.js';
import { User } from '../dist/modules/users/user.entity.js';
import { UserRole } from '../dist/modules/users/user-role.enum.js';
import { Problem } from '../dist/modules/problems/problem.entity.js';
import { TestCase } from '../dist/modules/problems/test-case.entity.js';
import {
  ProblemDifficulty,
  ProblemStatus,
} from '../dist/modules/problems/problem.enums.js';

const email = 'demo-author@unsolvable.local';
const password = randomBytes(18).toString('base64url');

await dataSource.initialize();
try {
  const passwordHash = await new PasswordHasher().hash(password);
  const problem = await dataSource.transaction(async (manager) => {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtext('unsolvable-demo-seed-v1'))",
    );
    const users = manager.getRepository(User);
    const problems = manager.getRepository(Problem);
    let author = await users.findOneBy({ email });
    if (author) {
      author.passwordHash = passwordHash;
      author.role = UserRole.AUTHOR;
      author.tokenVersion += 1;
    } else {
      author = users.create({
        email,
        username: 'demo_author',
        passwordHash,
        role: UserRole.AUTHOR,
      });
    }
    author = await users.save(author);

    let problem = await problems.findOne({
      where: { slug: 'a-plus-b-demo' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!problem) {
      problem = problems.create({
        slug: 'a-plus-b-demo',
        title: 'A + B',
        statementMarkdown: '두 정수 A와 B를 입력받아 합을 출력하세요.',
        inputDescriptionMarkdown: '한 줄에 두 정수 A와 B가 주어집니다.',
        outputDescriptionMarkdown: 'A + B를 출력합니다.',
        difficulty: ProblemDifficulty.BEGINNER,
        status: ProblemStatus.PUBLISHED,
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        authorId: author.id,
        currentVersion: 1,
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true, order: 1, score: 1 },
          { input: '5 7\n', expectedOutput: '12\n', isSample: false, order: 2, score: 1 },
        ],
      });
      await problems.save(problem);
    }

    const versions = await manager.query(
      'SELECT version,snapshot FROM problem_versions WHERE problem_id=$1 ORDER BY version',
      [problem.id],
    );
    const initial = versions.find((item) => item.version === 1);
    if (!initial) {
      if (problem.currentVersion !== 1 || versions.length) {
        throw new Error(
          'Demo version 1 history is missing after edits; restore verified historical snapshots before rerunning. Current content cannot reconstruct version 1.',
        );
      }
      const testCases = await manager.find(TestCase, {
        where: { problemId: problem.id },
        order: { order: 'ASC' },
      });
      if (!testCases.length) {
        throw new Error(
          'Demo test cases are missing; operator verification is required before repairing version 1.',
        );
      }
      await manager.query(`
        INSERT INTO problem_versions (problem_id, version, snapshot)
        VALUES ($1, 1, $2::jsonb)
      `, [problem.id, JSON.stringify({
        title: problem.title,
        statementMarkdown: problem.statementMarkdown,
        inputDescriptionMarkdown: problem.inputDescriptionMarkdown,
        outputDescriptionMarkdown: problem.outputDescriptionMarkdown,
        difficulty: problem.difficulty,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitMb: problem.memoryLimitMb,
        testCases: testCases.map((item) => ({
          id: item.id, input: item.input, expectedOutput: item.expectedOutput,
          isSample: item.isSample, score: item.score, order: item.order,
        })),
      })]);
    } else if (
      !Array.isArray(initial.snapshot?.testCases) ||
      !initial.snapshot.testCases.length ||
      !versions.some((item) => item.version === problem.currentVersion)
    ) {
      throw new Error(
        'Demo version history is incomplete; restore verified historical snapshots before rerunning. Existing immutable versions were not changed.',
      );
    }
    return problem;
  });

  console.log(`Demo problem: ${problem.slug}`);
  console.log(`Author email: ${email}`);
  console.log(`Author password: ${password}`);
  console.log('Running this command again rotates the demo author password.');
} finally {
  await dataSource.destroy();
}
