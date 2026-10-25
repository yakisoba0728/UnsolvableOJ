import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Problem } from '../problems/problem.entity.js';
import { User } from '../users/user.entity.js';
import { SubmissionLanguage, SubmissionStatus } from './submission.enums.js';
import type { DebugOutputDto } from './dto/debug-output.dto.js';

@Entity({ name: 'submissions' })
@Index('idx_submissions_user_created', ['userId', 'createdAt'])
@Index('idx_submissions_problem_created', ['problemId', 'createdAt'])
export class Submission {
  @Column({
    name: 'debug_outputs',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  debugOutputs: DebugOutputDto[];

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.submissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ name: 'problem_id', type: 'uuid' })
  problemId: string;

  @ManyToOne(() => Problem, (problem) => problem.submissions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'problem_id' })
  problem: Relation<Problem>;

  @Column({
    type: 'enum',
    enum: SubmissionLanguage,
    enumName: 'submission_language',
  })
  language: SubmissionLanguage;

  @Column({ name: 'source_code', type: 'text' })
  sourceCode: string;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    enumName: 'submission_status',
    default: SubmissionStatus.QUEUED,
  })
  status: SubmissionStatus;

  @Column({ name: 'accepted_for_xp', type: 'boolean', default: false })
  acceptedForXp: boolean;

  @Column({ name: 'runtime_ms', type: 'integer', nullable: true })
  runtimeMs: number | null;

  @Column({ name: 'memory_kb', type: 'integer', nullable: true })
  memoryKb: number | null;

  @Column({ name: 'passed_test_cases', type: 'integer', default: 0 })
  passedTestCases: number;

  @Column({ name: 'total_test_cases', type: 'integer', default: 0 })
  totalTestCases: number;

  @Column({ name: 'compile_output', type: 'text', nullable: true })
  compileOutput: string | null;

  @Column({ name: 'judge_message', type: 'text', nullable: true })
  judgeMessage: string | null;

  @Column({ name: 'problem_version', type: 'integer', default: 1 })
  problemVersion: number;

  @Column({ name: 'judge_generation', type: 'integer', default: 1 })
  judgeGeneration: number;

  @Column({ name: 'judge_attempt_id', type: 'uuid', nullable: true })
  judgeAttemptId: string | null;

  @Column({
    name: 'judge_lease_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  judgeLeaseExpiresAt: Date | null;

  @Column({ name: 'recovery_count', type: 'integer', default: 0 })
  recoveryCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
