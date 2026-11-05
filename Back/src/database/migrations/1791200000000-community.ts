import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Community1791200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE community_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category varchar(16) NOT NULL CHECK (category IN ('QUESTION','SOLUTION','REVIEW','FREE')),
        title varchar(150) NOT NULL,
        body text NOT NULL,
        code text NOT NULL DEFAULT '',
        language varchar(40) NOT NULL DEFAULT '',
        problem_id uuid REFERENCES problems(id) ON DELETE SET NULL,
        accepted_comment_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE community_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE community_posts ADD CONSTRAINT fk_community_accepted
        FOREIGN KEY (accepted_comment_id) REFERENCES community_comments(id) ON DELETE SET NULL;
      CREATE TABLE community_votes (
        post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX idx_community_created ON community_posts(created_at DESC, id DESC);
      CREATE INDEX idx_community_category ON community_posts(category, created_at DESC, id DESC);
      CREATE INDEX idx_community_problem ON community_posts(problem_id, created_at DESC, id DESC);
      CREATE INDEX idx_community_comments ON community_comments(post_id, created_at, id);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE community_posts DROP CONSTRAINT fk_community_accepted;
      DROP TABLE community_votes, community_comments, community_posts;`);
  }
}
