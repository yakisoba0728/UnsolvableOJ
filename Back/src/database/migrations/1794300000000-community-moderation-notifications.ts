import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityModerationNotifications1794300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE community_posts ADD COLUMN hidden_at timestamptz;
      ALTER TABLE community_comments ADD COLUMN hidden_at timestamptz;
      CREATE TABLE community_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id uuid REFERENCES community_posts(id) ON DELETE CASCADE,
        comment_id uuid REFERENCES community_comments(id) ON DELETE CASCADE,
        reason varchar(500) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        CHECK ((post_id IS NULL) <> (comment_id IS NULL))
      );
      CREATE UNIQUE INDEX uq_community_report_post ON community_reports(reporter_id, post_id) WHERE post_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_community_report_comment ON community_reports(reporter_id, comment_id) WHERE comment_id IS NOT NULL;
      CREATE INDEX idx_community_reports_open ON community_reports(created_at DESC) WHERE resolved_at IS NULL;
      CREATE INDEX idx_community_reports_post ON community_reports(post_id);
      CREATE INDEX idx_community_reports_comment ON community_reports(comment_id);
      CREATE TABLE community_post_views (
        post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        viewer varchar(64) NOT NULL,
        viewed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (post_id, viewer)
      );
      CREATE INDEX idx_community_follows_user ON community_follows(user_id, author_id);
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type varchar(16) NOT NULL CHECK (type IN ('ANSWER','ACCEPTED','JUDGED')),
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        post_id uuid REFERENCES community_posts(id) ON DELETE CASCADE,
        comment_id uuid REFERENCES community_comments(id) ON DELETE CASCADE,
        submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC, id DESC);
      CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
      CREATE INDEX idx_notifications_post ON notifications(post_id);
      CREATE INDEX idx_notifications_comment ON notifications(comment_id);
      CREATE UNIQUE INDEX uq_notifications_accepted ON notifications(comment_id) WHERE type='ACCEPTED';
      -- 제출 알림만 submission_id를 가지므로 제출당 하나다(재채점은 같은 알림을 다시 안 읽음으로 올린다).
      CREATE UNIQUE INDEX uq_notifications_submission ON notifications(submission_id);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE notifications, community_post_views, community_reports;
      DROP INDEX idx_community_follows_user;
      ALTER TABLE community_comments DROP COLUMN hidden_at;
      ALTER TABLE community_posts DROP COLUMN hidden_at;
    `);
  }
}
