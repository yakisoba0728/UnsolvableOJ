import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Problem } from '../problems/problem.entity.js';
import { Submission } from '../submissions/submission.entity.js';
import { UserRole } from './user-role.enum.js';

@Entity({ name: 'users' })
@Index('uq_users_email', ['email'], { unique: true })
@Index('uq_users_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ type: 'varchar', length: 30 })
  username: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role',
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ type: 'integer', default: 1 })
  level: number;

  @Column({ type: 'integer', default: 0 })
  xp: number;

  @Column({ type: 'integer', default: 0 })
  rating: number;

  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Problem, (problem) => problem.author)
  authoredProblems: Relation<Problem[]>;

  @OneToMany(() => Submission, (submission) => submission.user)
  submissions: Relation<Submission[]>;
}
