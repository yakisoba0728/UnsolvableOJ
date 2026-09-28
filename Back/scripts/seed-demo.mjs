import { randomBytes } from 'node:crypto';
import dataSource from '../dist/database/data-source.js';
import { PasswordHasher } from '../dist/modules/auth/password-hasher.service.js';
import { User } from '../dist/modules/users/user.entity.js';
import { UserRole } from '../dist/modules/users/user-role.enum.js';
import { Problem } from '../dist/modules/problems/problem.entity.js';
import {
  ProblemDifficulty,
  ProblemStatus,
} from '../dist/modules/problems/problem.enums.js';

const email = 'demo-author@unsolvable.local';
const password = randomBytes(18).toString('base64url');

await dataSource.initialize();
try {
  const users = dataSource.getRepository(User);
  const problems = dataSource.getRepository(Problem);
  const passwordHash = await new PasswordHasher().hash(password);
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

  let problem = await problems.findOneBy({ slug: 'a-plus-b-demo' });
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
      testCases: [
        { input: '1 2\n', expectedOutput: '3\n', isSample: true, order: 1, score: 1 },
        { input: '5 7\n', expectedOutput: '12\n', isSample: false, order: 2, score: 1 },
      ],
    });
    await problems.save(problem);
  }

  await dataSource.query(`
    INSERT INTO problem_versions (problem_id, version, snapshot)
    VALUES ($1, 1, $2::jsonb) ON CONFLICT DO NOTHING
  `, [problem.id, JSON.stringify({
    title: problem.title,
    statementMarkdown: problem.statementMarkdown,
    inputDescriptionMarkdown: problem.inputDescriptionMarkdown,
    outputDescriptionMarkdown: problem.outputDescriptionMarkdown,
    difficulty: problem.difficulty,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    testCases: problem.testCases?.map((item) => ({
      id: item.id, input: item.input, expectedOutput: item.expectedOutput,
      isSample: item.isSample, score: item.score, order: item.order,
    })) ?? [],
  })]);

  console.log(`Demo problem: ${problem.slug}`);
  console.log(`Author email: ${email}`);
  console.log(`Author password: ${password}`);
  console.log('Running this command again rotates the demo author password.');
} finally {
  await dataSource.destroy();
}
