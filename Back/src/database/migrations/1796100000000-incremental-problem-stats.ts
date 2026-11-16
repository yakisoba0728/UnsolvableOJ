import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Replace repeated full-history recounts with statement deltas and solver multiplicities. */
export class IncrementalProblemStats1796100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!q.isTransactionActive)
      throw new Error('Problem statistics upgrade requires a transaction.');
    // Freeze writers while deriving the initial multiplicities and replacing the
    // trigger. This migration is not an online/concurrent production rollout.
    await q.query('LOCK TABLE submissions IN SHARE ROW EXCLUSIVE MODE');
    await q.query('LOCK TABLE problem_stats IN SHARE ROW EXCLUSIVE MODE');
    await q.query(`
      CREATE TABLE problem_solver_counts (
        problem_id uuid NOT NULL REFERENCES problem_stats(problem_id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        accepted_count integer NOT NULL CHECK (accepted_count > 0),
        PRIMARY KEY (problem_id, user_id)
      );
      COMMENT ON TABLE problem_solver_counts IS
        'Derived accepted-submission multiplicities. The FK targets the already locked statistics row; no user FK avoids a new stats-to-user lock edge. Submission DELETE/TRUNCATE maintains user cleanup.';

      INSERT INTO problem_stats(problem_id,solver_count,accepted_count,finished_count)
      SELECT problem_id,count(DISTINCT user_id) FILTER (WHERE status='ACCEPTED'),
        count(*) FILTER (WHERE status='ACCEPTED'),count(*) FROM submissions
      WHERE NOT is_test AND status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED')
      GROUP BY problem_id
      ON CONFLICT(problem_id) DO UPDATE SET solver_count=EXCLUDED.solver_count,
        accepted_count=EXCLUDED.accepted_count,finished_count=EXCLUDED.finished_count;
      UPDATE problem_stats p SET solver_count=0,accepted_count=0,finished_count=0
      WHERE NOT EXISTS(SELECT 1 FROM submissions s WHERE s.problem_id=p.problem_id
        AND NOT s.is_test AND s.status NOT IN ('QUEUED','JUDGING','SYSTEM_ERROR','CANCELLED'));
      INSERT INTO problem_solver_counts(problem_id,user_id,accepted_count)
      SELECT problem_id,user_id,count(*)::integer FROM submissions
      WHERE NOT is_test AND status='ACCEPTED' GROUP BY problem_id,user_id;
      ALTER TABLE problem_stats ADD CONSTRAINT problem_stats_nonnegative
        CHECK (solver_count>=0 AND accepted_count>=solver_count AND finished_count>=accepted_count);
      DROP TRIGGER trg_submissions_problem_stats ON submissions;
    `);
    // Keep the historical recount function untouched for a lossless down path.
    await q.query(`
      CREATE FUNCTION refresh_problem_stats_delta() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        changes_sql text;
        rows_sql text;
        target uuid;
        has_changes boolean := false;
        previous_target uuid;
        delta record;
        multiplicity integer;
        solver_delta integer := 0;
        accepted_delta integer := 0;
        finished_delta integer := 0;
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          DELETE FROM problem_solver_counts;
          DELETE FROM problem_stats;
          RETURN NULL;
        END IF;
        rows_sql := '';
        IF TG_OP<>'INSERT' THEN
          rows_sql := 'SELECT problem_id,user_id,
            -((status=''ACCEPTED'')::integer) AS accepted_delta,-1 AS finished_delta
            FROM old_submissions WHERE NOT is_test
              AND status NOT IN (''QUEUED'',''JUDGING'',''SYSTEM_ERROR'',''CANCELLED'')';
        END IF;
        IF TG_OP='UPDATE' THEN rows_sql := rows_sql || ' UNION ALL '; END IF;
        IF TG_OP<>'DELETE' THEN
          rows_sql := rows_sql || 'SELECT problem_id,user_id,
            (status=''ACCEPTED'')::integer AS accepted_delta,1 AS finished_delta
            FROM new_submissions WHERE NOT is_test
              AND status NOT IN (''QUEUED'',''JUDGING'',''SYSTEM_ERROR'',''CANCELLED'')';
        END IF;
        changes_sql := 'SELECT problem_id,user_id,sum(accepted_delta)::integer AS accepted_delta,
          sum(finished_delta)::integer AS finished_delta FROM (' || rows_sql || ') evidence
          GROUP BY problem_id,user_id HAVING sum(accepted_delta)<>0 OR sum(finished_delta)<>0';

        -- Acquire every target before updating any counter, in one stable order.
        -- A count-equivalent verdict change or lease heartbeat has no target.
        FOR target IN EXECUTE 'SELECT DISTINCT problem_id FROM (' || changes_sql || ') changes ORDER BY problem_id' LOOP
          has_changes := true;
          INSERT INTO problem_stats(problem_id) VALUES(target) ON CONFLICT DO NOTHING;
          PERFORM 1 FROM problem_stats WHERE problem_id=target FOR UPDATE;
        END LOOP;
        IF NOT has_changes THEN RETURN NULL; END IF;

        FOR delta IN EXECUTE changes_sql || ' ORDER BY problem_id,user_id' LOOP
          IF previous_target IS NOT NULL AND previous_target<>delta.problem_id THEN
            UPDATE problem_stats SET solver_count=solver_count+solver_delta,
              accepted_count=accepted_count+accepted_delta,finished_count=finished_count+finished_delta
            WHERE problem_id=previous_target;
            solver_delta := 0; accepted_delta := 0; finished_delta := 0;
          END IF;
          previous_target := delta.problem_id;
          accepted_delta := accepted_delta+delta.accepted_delta;
          finished_delta := finished_delta+delta.finished_delta;
          IF delta.accepted_delta>0 THEN
            INSERT INTO problem_solver_counts(problem_id,user_id,accepted_count)
            VALUES(delta.problem_id,delta.user_id,delta.accepted_delta)
            ON CONFLICT(problem_id,user_id) DO UPDATE SET accepted_count=
              problem_solver_counts.accepted_count+EXCLUDED.accepted_count
            RETURNING accepted_count INTO multiplicity;
            IF multiplicity=delta.accepted_delta THEN solver_delta := solver_delta+1; END IF;
          ELSIF delta.accepted_delta<0 THEN
            SELECT accepted_count INTO multiplicity FROM problem_solver_counts
              WHERE problem_id=delta.problem_id AND user_id=delta.user_id;
            IF multiplicity IS NULL OR multiplicity+delta.accepted_delta<0 THEN
              RAISE EXCEPTION 'Problem solver counter is inconsistent; reconcile statistics before writing';
            END IF;
            IF multiplicity+delta.accepted_delta=0 THEN
              DELETE FROM problem_solver_counts WHERE problem_id=delta.problem_id AND user_id=delta.user_id;
              solver_delta := solver_delta-1;
            ELSE
              UPDATE problem_solver_counts SET accepted_count=accepted_count+delta.accepted_delta
                WHERE problem_id=delta.problem_id AND user_id=delta.user_id;
            END IF;
          END IF;
        END LOOP;
        IF previous_target IS NOT NULL THEN
          UPDATE problem_stats SET solver_count=solver_count+solver_delta,
            accepted_count=accepted_count+accepted_delta,finished_count=finished_count+finished_delta
          WHERE problem_id=previous_target;
        END IF;
        RETURN NULL;
      END $$;

      CREATE TRIGGER trg_submissions_stats_insert AFTER INSERT ON submissions
        REFERENCING NEW TABLE AS new_submissions FOR EACH STATEMENT EXECUTE FUNCTION refresh_problem_stats_delta();
      CREATE TRIGGER trg_submissions_stats_update AFTER UPDATE ON submissions
        REFERENCING OLD TABLE AS old_submissions NEW TABLE AS new_submissions
        FOR EACH STATEMENT EXECUTE FUNCTION refresh_problem_stats_delta();
      CREATE TRIGGER trg_submissions_stats_delete AFTER DELETE ON submissions
        REFERENCING OLD TABLE AS old_submissions FOR EACH STATEMENT EXECUTE FUNCTION refresh_problem_stats_delta();
      CREATE TRIGGER trg_submissions_stats_truncate AFTER TRUNCATE ON submissions
        FOR EACH STATEMENT EXECUTE FUNCTION refresh_problem_stats_delta();
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    if (!q.isTransactionActive)
      throw new Error('Problem statistics rollback requires a transaction.');
    await q.query('LOCK TABLE submissions IN SHARE ROW EXCLUSIVE MODE');
    await q.query('LOCK TABLE problem_stats IN SHARE ROW EXCLUSIVE MODE');
    await q.query(`
      DROP TRIGGER trg_submissions_stats_insert ON submissions;
      DROP TRIGGER trg_submissions_stats_update ON submissions;
      DROP TRIGGER trg_submissions_stats_delete ON submissions;
      DROP TRIGGER trg_submissions_stats_truncate ON submissions;
      DROP FUNCTION refresh_problem_stats_delta();
      DROP TABLE problem_solver_counts;
      ALTER TABLE problem_stats DROP CONSTRAINT problem_stats_nonnegative;
      CREATE TRIGGER trg_submissions_problem_stats
        AFTER INSERT OR DELETE OR UPDATE OF status,is_test ON submissions
        FOR EACH ROW EXECUTE FUNCTION refresh_problem_stats();
    `);
  }
}
