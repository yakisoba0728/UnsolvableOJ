/** Limit candidates before loading their per-problem submission details. */
export const enterpriseResultPageSql = `
  SELECT a.*, u.username, coalesce(detail.problems, '[]') AS problems
    FROM (
      SELECT * FROM enterprise_attempts WHERE test_id=$1
      ORDER BY started_at, id LIMIT $2 OFFSET $3
    ) a
    JOIN users u ON u.id=a.user_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'problemId', s.problem_id, 'solved', s.solved,
        'submissions', s.count, 'submissionId', s.submission_id
      ) ORDER BY s.problem_id) AS problems
      FROM (
        SELECT problem_id, bool_or(status='ACCEPTED') AS solved, count(*)::int AS count,
          (array_agg(id ORDER BY (status='ACCEPTED') DESC, created_at DESC, id DESC))[1] AS submission_id
        FROM submissions WHERE attempt_id=a.id GROUP BY problem_id
      ) s
    ) detail ON true
    ORDER BY a.started_at, a.id`;

/**
 * Whole-assessment totals stay global even though details are paginated.
 * Match assessmentScore: round each candidate first, then round the mean;
 * missing Vibe tasks score zero, started unevaluated tasks remain pending.
 * Only scalar report scores are read; workspace files/history never leave SQL.
 */
const enterpriseResultScoresCte = `
  WITH attempts AS MATERIALIZED (
    SELECT id, user_id, started_at, deadline_at, finished_at
    FROM enterprise_attempts WHERE test_id=$1
  ), solved AS (
    SELECT s.attempt_id, count(DISTINCT s.problem_id)::int AS count
    FROM submissions s JOIN attempts a ON a.id=s.attempt_id
    WHERE s.status='ACCEPTED' GROUP BY s.attempt_id
  ), vibe AS (
    SELECT v.enterprise_attempt_id AS attempt_id,
      bool_or(v.state #>> '{report,evaluationStatus}' IS DISTINCT FROM 'complete') AS pending,
      sum(CASE WHEN v.state #>> '{report,evaluationStatus}'='complete' THEN
        (v.state #>> '{report,outcome}')::numeric +
        (v.state #>> '{report,prompt,score}')::numeric +
        (v.state #>> '{report,process,score}')::numeric ELSE 0 END) AS score
    FROM vibe_attempts v JOIN attempts a ON a.id=v.enterprise_attempt_id
    WHERE v.challenge_id=ANY($2::text[]) GROUP BY v.enterprise_attempt_id
  ), scores AS (
    SELECT a.*, coalesce(s.count,0)::int AS solved,
      CASE WHEN coalesce(v.pending, false) THEN NULL ELSE
      round((coalesce(s.count,0)*100 + coalesce(v.score,0)) / $3::numeric)::int END AS score
    FROM attempts a LEFT JOIN solved s ON s.attempt_id=a.id
      LEFT JOIN vibe v ON v.attempt_id=a.id
  )`;

/** Fixed-size aggregate projection: no candidate arrays or source/workspace data. */
export const enterpriseResultSummarySql = `${enterpriseResultScoresCte}
  SELECT count(*)::int AS candidates,
    count(*) FILTER (WHERE score IS NULL)::int AS pending,
    round(avg(score))::int AS "averageScore",
    count(*) FILTER (WHERE score=100)::int AS perfect,
    json_build_object(
      'finished', count(*) FILTER (WHERE finished_at IS NOT NULL)::int,
      'active', count(*) FILTER (WHERE finished_at IS NULL AND deadline_at > now())::int,
      'expired', count(*) FILTER (WHERE finished_at IS NULL AND deadline_at <= now())::int,
      'scoreBands', json_build_array(
        count(*) FILTER (WHERE score BETWEEN 0 AND 19)::int,
        count(*) FILTER (WHERE score BETWEEN 20 AND 39)::int,
        count(*) FILTER (WHERE score BETWEEN 40 AND 59)::int,
        count(*) FILTER (WHERE score BETWEEN 60 AND 79)::int,
        count(*) FILTER (WHERE score BETWEEN 80 AND 100)::int
      )
    ) AS analytics
  FROM scores`;

/** Caller verifies the row cap in the SAME repeatable-read transaction first. */
export const enterpriseResultExportSql = `${enterpriseResultScoresCte}
  SELECT u.username, s.started_at, s.deadline_at, s.finished_at, s.solved, s.score,
    CASE WHEN s.finished_at IS NOT NULL THEN 'FINISHED'
      WHEN s.deadline_at <= now() THEN 'EXPIRED' ELSE 'ACTIVE' END AS status
  FROM scores s JOIN users u ON u.id=s.user_id
  ORDER BY s.started_at, s.id LIMIT $4`;
