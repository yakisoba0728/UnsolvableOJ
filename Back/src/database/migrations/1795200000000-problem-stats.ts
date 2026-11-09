import type { MigrationInterface, QueryRunner } from 'typeorm';

// 통계에 드는 제출: 검증용이 아니고 판정이 끝난 것(대기·채점 중·시스템 오류·취소 제외).
const FINISHED = "NOT is_test AND status NOT IN ('QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED')";

export class ProblemStats1795200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 문제 목록의 푼 사람·정답률(정렬 포함)을 요청마다 제출에서 모으지 않도록 문제별로 미리 센다.
    // 채점 결과·재채점·직접 넣은 행·사용자 삭제까지 한 곳에서 맞추려고 제출 트리거로 갱신한다.
    // 행이 없는 문제는 제출이 없는 것이다(읽을 때 0·정답률 없음).
    await q.query(`
      CREATE TABLE problem_stats (
        problem_id uuid PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
        solver_count integer NOT NULL DEFAULT 0,
        accepted_count integer NOT NULL DEFAULT 0,
        finished_count integer NOT NULL DEFAULT 0
      )`);
    // shortcut: 바뀔 때마다 그 문제의 끝난 제출을 다시 센다(인기 문제 1,600건에 약 1ms). 한 문제에 제출이 수만 건이면 증감 방식으로 바꾼다.
    await q.query(`
      CREATE FUNCTION refresh_problem_stats() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        target uuid;
        was boolean := false;
        is_now boolean := false;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          target := OLD.problem_id;
          was := NOT OLD.is_test AND OLD.status NOT IN ('QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED');
        END IF;
        IF TG_OP <> 'DELETE' THEN
          target := NEW.problem_id;
          is_now := NOT NEW.is_test AND NEW.status NOT IN ('QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED');
        END IF;
        -- 제출·채점 시작처럼 통계에 들지 않는 변화는 건너뛴다.
        IF NOT (was OR is_now) THEN
          RETURN NULL;
        END IF;
        -- 먼저 문제의 통계 행을 잠그고 다음 문장(새 스냅숏)에서 센다.
        -- 한 문장으로 세면 동시에 끝난 다른 채점이 보이지 않아 덮어쓴다.
        INSERT INTO problem_stats (problem_id) VALUES (target)
          ON CONFLICT (problem_id) DO UPDATE SET solver_count = problem_stats.solver_count;
        UPDATE problem_stats SET (solver_count, accepted_count, finished_count) = (
          SELECT count(DISTINCT user_id) FILTER (WHERE status = 'ACCEPTED'),
            count(*) FILTER (WHERE status = 'ACCEPTED'), count(*)
          FROM submissions WHERE problem_id = target AND ${FINISHED})
        WHERE problem_id = target;
        RETURN NULL;
      END $$`);
    // 임대 갱신처럼 판정·검증 여부를 건드리지 않는 수정에는 불리지 않는다.
    await q.query(`
      CREATE TRIGGER trg_submissions_problem_stats
      AFTER INSERT OR DELETE OR UPDATE OF status, is_test ON submissions
      FOR EACH ROW EXECUTE FUNCTION refresh_problem_stats()`);
    await q.query(`
      INSERT INTO problem_stats (problem_id, solver_count, accepted_count, finished_count)
      SELECT problem_id, count(DISTINCT user_id) FILTER (WHERE status = 'ACCEPTED'),
        count(*) FILTER (WHERE status = 'ACCEPTED'), count(*)
      FROM submissions WHERE ${FINISHED}
      GROUP BY problem_id`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER trg_submissions_problem_stats ON submissions');
    await q.query('DROP FUNCTION refresh_problem_stats()');
    await q.query('DROP TABLE problem_stats');
  }
}
