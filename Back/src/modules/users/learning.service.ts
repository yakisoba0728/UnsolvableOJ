import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * One statement gives every panel the same PostgreSQL snapshot. Only scalar
 * submission evidence enters the window; source, diagnostics and exam data do
 * not leave the database. The existing (user_id, created_at) index bounds it.
 */
export const LEARNING_DASHBOARD_SQL = `
WITH bounds AS (
  SELECT statement_timestamp() AS now,
    (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date AS today
), scoped AS MATERIALIZED (
  SELECT s.id, s.problem_id, s.status, s.created_at
  FROM submissions s
  JOIN problems p ON p.id = s.problem_id
  CROSS JOIN bounds b
  WHERE s.user_id = $1 AND s.is_test = false AND s.attempt_id IS NULL
    AND p.status = 'PUBLISHED' AND p.is_private = false
    AND s.created_at >= ((b.today - ($2::integer - 1))::timestamp AT TIME ZONE 'Asia/Seoul')
    AND s.created_at <= b.now
), per_problem AS MATERIALIZED (
  SELECT problem_id, bool_or(status = 'ACCEPTED') AS solved,
    max(created_at) AS last_submitted_at
  FROM scoped GROUP BY problem_id
), daily AS (
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
    count(*)::integer AS submissions,
    count(*) FILTER (WHERE status = 'ACCEPTED')::integer AS accepted
  FROM scoped GROUP BY day
), difficulty_counts AS (
  SELECT p.difficulty, count(*)::integer AS attempted,
    count(*) FILTER (WHERE pp.solved)::integer AS solved
  FROM per_problem pp JOIN problems p ON p.id = pp.problem_id
  GROUP BY p.difficulty
), tag_counts AS MATERIALIZED (
  SELECT t.tag, count(*)::integer AS attempted,
    count(*) FILTER (WHERE pp.solved)::integer AS solved
  FROM per_problem pp JOIN problems p ON p.id = pp.problem_id
  CROSS JOIN LATERAL (SELECT DISTINCT unnest(p.tags) AS tag) t
  GROUP BY t.tag
), review_candidates AS MATERIALIZED (
  SELECT pp.problem_id, pp.last_submitted_at
  FROM per_problem pp
  WHERE NOT pp.solved AND NOT EXISTS (
    SELECT 1 FROM user_problem_solves solved
    WHERE solved.user_id = $1 AND solved.problem_id = pp.problem_id
  )
  ORDER BY pp.last_submitted_at DESC, pp.problem_id LIMIT 10
), latest_review AS (
  SELECT DISTINCT ON (s.problem_id) s.problem_id, s.status
  FROM scoped s JOIN review_candidates r ON r.problem_id = s.problem_id
  ORDER BY s.problem_id, s.created_at DESC, s.id DESC
)
SELECT jsonb_build_object(
  'days', $2::integer,
  'timeZone', 'Asia/Seoul',
  'generatedAt', b.now,
  'summary', jsonb_build_object(
    'submissions', (SELECT count(*)::integer FROM scoped),
    'acceptedSubmissions', (SELECT count(*)::integer FROM scoped WHERE status = 'ACCEPTED'),
    'solvedProblems', (SELECT count(*)::integer FROM per_problem WHERE solved),
    'attemptedProblems', (SELECT count(*)::integer FROM per_problem),
    'activeDays', (SELECT count(*)::integer FROM daily)
  ),
  'activity', (
    SELECT jsonb_agg(jsonb_build_object(
      'date', to_char(b.today - offsets.n, 'YYYY-MM-DD'),
      'submissions', COALESCE(d.submissions, 0),
      'acceptedSubmissions', COALESCE(d.accepted, 0)
    ) ORDER BY offsets.n DESC)
    FROM generate_series(0, $2::integer - 1) offsets(n)
    LEFT JOIN daily d ON d.day = b.today - offsets.n
  ),
  'difficulties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'difficulty', kinds.difficulty, 'attempted', COALESCE(counts.attempted, 0),
    'solved', COALESCE(counts.solved, 0)
  ) ORDER BY kinds.difficulty)
    FROM unnest(enum_range(NULL::problem_difficulty)) kinds(difficulty)
    LEFT JOIN difficulty_counts counts ON counts.difficulty = kinds.difficulty
  ), '[]'::jsonb),
  'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tag', tag, 'attempted', attempted, 'solved', solved
  ) ORDER BY attempted DESC, tag COLLATE "C")
    FROM (SELECT * FROM tag_counts ORDER BY attempted DESC, tag COLLATE "C" LIMIT 20) top_tags
  ), '[]'::jsonb),
  'tagsTruncated', (SELECT count(*) > 20 FROM tag_counts),
  'review', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'difficulty', p.difficulty,
    'lastSubmittedAt', r.last_submitted_at, 'lastStatus', latest.status,
    'bookmarked', EXISTS(SELECT 1 FROM problem_bookmarks saved
      WHERE saved.user_id = $1 AND saved.problem_id = p.id)
  ) ORDER BY r.last_submitted_at DESC, p.id)
    FROM review_candidates r JOIN problems p ON p.id = r.problem_id
    JOIN latest_review latest ON latest.problem_id = r.problem_id
  ), '[]'::jsonb)
) AS dashboard
FROM users u CROSS JOIN bounds b
WHERE u.id = $1 AND u.deleted_at IS NULL
`;

@Injectable()
export class LearningService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async dashboard(userId: string, days: number) {
    const [row] = await this.db.query(LEARNING_DASHBOARD_SQL, [userId, days]);
    if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return row.dashboard;
  }
}
