import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Problem } from './problem.entity.js';

@Entity({ name: 'test_cases' })
@Index('idx_test_cases_problem_order', ['problemId', 'order'], { unique: true })
export class TestCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'problem_id', type: 'uuid' })
  problemId: string;

  @ManyToOne(() => Problem, (problem) => problem.testCases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'problem_id' })
  problem: Relation<Problem>;

  @Column({ type: 'text' })
  input: string;

  @Column({ name: 'expected_output', type: 'text' })
  expectedOutput: string;

  @Column({ name: 'is_sample', type: 'boolean', default: false })
  isSample: boolean;

  @Column({ type: 'integer' })
  order: number;

  @Column({ type: 'integer', default: 1 })
  score: number;
}
