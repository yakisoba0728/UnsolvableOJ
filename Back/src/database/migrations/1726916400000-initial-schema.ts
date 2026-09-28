import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1726916400000 implements MigrationInterface {
  name = 'InitialSchema1726916400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_role" AS ENUM ('USER', 'AUTHOR', 'ADMIN');
      CREATE TYPE "problem_difficulty" AS ENUM ('BEGINNER', 'EASY', 'MEDIUM', 'HARD', 'EXPERT');
      CREATE TYPE "problem_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
      CREATE TYPE "submission_language" AS ENUM ('C', 'CPP', 'JAVA', 'PYTHON', 'JAVASCRIPT', 'TYPESCRIPT', 'GO', 'RUST');
      CREATE TYPE "submission_status" AS ENUM (
        'QUEUED', 'JUDGING', 'ACCEPTED', 'WRONG_ANSWER',
        'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR',
        'COMPILE_ERROR', 'OUTPUT_LIMIT_EXCEEDED', 'SYSTEM_ERROR', 'CANCELLED'
      );

      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(320) NOT NULL,
        "username" varchar(30) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "role" "user_role" NOT NULL DEFAULT 'USER',
        "level" integer NOT NULL DEFAULT 1,
        "xp" integer NOT NULL DEFAULT 0,
        "rating" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email");
      CREATE UNIQUE INDEX "uq_users_username" ON "users" ("username");

      CREATE TABLE "problems" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slug" varchar(80) NOT NULL,
        "title" varchar(150) NOT NULL,
        "statement_md" text NOT NULL,
        "input_description_md" text NOT NULL DEFAULT '',
        "output_description_md" text NOT NULL DEFAULT '',
        "difficulty" "problem_difficulty" NOT NULL,
        "status" "problem_status" NOT NULL DEFAULT 'DRAFT',
        "time_limit_ms" integer NOT NULL DEFAULT 1000,
        "memory_limit_mb" integer NOT NULL DEFAULT 256,
        "author_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_problems_author" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX "uq_problems_slug" ON "problems" ("slug");

      CREATE TABLE "test_cases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "problem_id" uuid NOT NULL,
        "input" text NOT NULL,
        "expected_output" text NOT NULL,
        "is_sample" boolean NOT NULL DEFAULT false,
        "order" integer NOT NULL,
        "score" integer NOT NULL DEFAULT 1,
        CONSTRAINT "fk_test_cases_problem" FOREIGN KEY ("problem_id") REFERENCES "problems" ("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "idx_test_cases_problem_order" ON "test_cases" ("problem_id", "order");

      CREATE TABLE "submissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "problem_id" uuid NOT NULL,
        "language" "submission_language" NOT NULL,
        "source_code" text NOT NULL,
        "status" "submission_status" NOT NULL DEFAULT 'QUEUED',
        "runtime_ms" integer,
        "memory_kb" integer,
        "passed_test_cases" integer NOT NULL DEFAULT 0,
        "total_test_cases" integer NOT NULL DEFAULT 0,
        "compile_output" text,
        "judge_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_submissions_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_submissions_problem" FOREIGN KEY ("problem_id") REFERENCES "problems" ("id") ON DELETE RESTRICT
      );
      CREATE INDEX "idx_submissions_user_created" ON "submissions" ("user_id", "created_at");
      CREATE INDEX "idx_submissions_problem_created" ON "submissions" ("problem_id", "created_at");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "submissions";
      DROP TABLE "test_cases";
      DROP TABLE "problems";
      DROP TABLE "users";
      DROP TYPE "submission_status";
      DROP TYPE "submission_language";
      DROP TYPE "problem_status";
      DROP TYPE "problem_difficulty";
      DROP TYPE "user_role";
    `);
  }
}
