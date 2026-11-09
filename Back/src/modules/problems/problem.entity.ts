import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';
import { Submission } from '../submissions/submission.entity.js';
import { ProblemDifficulty, ProblemStatus } from './problem.enums.js';
import { TestCase } from './test-case.entity.js';

@Entity({ name: 'problems' })
@Index('uq_problems_slug', ['slug'], { unique: true })
export class Problem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ name: 'statement_md', type: 'text' })
  statementMarkdown: string;

  @Column({ name: 'input_description_md', type: 'text', default: '' })
  inputDescriptionMarkdown: string;

  @Column({ name: 'output_description_md', type: 'text', default: '' })
  outputDescriptionMarkdown: string;

  @Column({ name: 'editorial_md', type: 'text', default: '' })
  editorialMarkdown: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({
    type: 'enum',
    enum: ProblemDifficulty,
    enumName: 'problem_difficulty',
  })
  difficulty: ProblemDifficulty;

  @Column({
    type: 'enum',
    enum: ProblemStatus,
    enumName: 'problem_status',
    default: ProblemStatus.DRAFT,
  })
  status: ProblemStatus;

  @Column({ name: 'time_limit_ms', type: 'integer', default: 1000 })
  timeLimitMs: number;

  @Column({ name: 'memory_limit_mb', type: 'integer', default: 256 })
  memoryLimitMb: number;

  @Column({ name: 'current_version', type: 'integer', default: 1 })
  currentVersion: number;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  // 기업 테스트 전용 문제. 공개 목록·상세에 나오지 않고 공개(PUBLISHED)로 바꿀 수 없다.
  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  @ManyToOne(() => User, (user) => user.authoredProblems, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'author_id' })
  author: Relation<User>;

  @OneToMany(() => TestCase, (testCase) => testCase.problem, {
    cascade: ['insert'],
  })
  testCases: Relation<TestCase[]>;

  @OneToMany(() => Submission, (submission) => submission.problem)
  submissions: Relation<Submission[]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
