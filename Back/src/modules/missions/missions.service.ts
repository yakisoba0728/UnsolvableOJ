import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { analysisCatalog } from './analysis-catalog.js';
import {
  badgeNames,
  currentStreak,
  DAY,
  definitions,
  kstDay,
  periods,
  type MissionKey,
} from './mission-policy.js';

interface State {
  id: string;
  mission_key: MissionKey;
  period_key: string;
  progress: number;
  target: number;
  reward_xp: number;
  badge: string | null;
  problem_id: string | null;
  completed_at: Date | null;
  claimed_at: Date | null;
}
const learningVerdicts =
  "('ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED')";

@Injectable()
export class MissionsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async locked<T>(
    userId: string,
    run: (m: EntityManager, now: Date) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (m) => {
      // Serialize only this user's mission requests. Never lock source submissions:
      // the judge locks those first and then updates users, so reversing that order deadlocks.
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('missions:' || $1, 0))",
        [userId],
      );
      const [{ now }]: { now: Date }[] = await m.query(
        'SELECT clock_timestamp() AS now',
      );
      return run(m, now);
    });
  }

  async list(userId: string) {
    return this.locked(userId, async (m, now) => {
      const p = periods(now);
      const states = await this.refresh(m, userId, now);
      const [{ done }]: { done: number }[] = await m.query(
        'SELECT count(*)::int AS done FROM mission_states WHERE user_id=$1 AND claimed_at >= $2 AND claimed_at < $3',
        [userId, p.month, p.monthEnd],
      );
      const badges = await this.badges(m, userId);
      const items = await Promise.all(
        states.map(async (state) => {
          const definition = definitions.find(
            (d) => d.id === state.mission_key,
          )!;
          const expiresAt =
            definition.period === 'streak'
              ? null
              : definition.period === 'week'
                ? p.weekEnd
                : definition.period === 'month'
                  ? p.monthEnd
                  : p.dayEnd;
          const [problem]: { slug: string; title: string; status: string }[] =
            state.problem_id
              ? await m.query(
                  'SELECT slug,title,status FROM problems WHERE id=$1',
                  [state.problem_id],
                )
              : [];
          return {
            ...definition,
            current: state.progress,
            stateId: state.id,
            status:
              state.progress >= state.target
                ? 'done'
                : state.progress
                  ? 'active'
                  : 'idle',
            reward: state.reward_xp
              ? `+${state.reward_xp} XP${state.badge ? ' · 배지' : ''}`
              : '+배지',
            claimedAt: state.claimed_at,
            completedAt: state.completed_at,
            expiresAt,
            available:
              state.mission_key !== 'bonus' || problem?.status === 'PUBLISHED',
            description:
              state.mission_key === 'bonus'
                ? problem?.status === 'PUBLISHED'
                  ? `${problem.title} · 오늘 첫 정답 보너스`
                  : '새로 풀 수 있는 공개 문제가 없어요.'
                : definition.description,
            action:
              state.mission_key === 'analysis'
                ? { to: '/analysis', label: '코드 분석 하러 가기' }
                : state.mission_key === 'community'
                  ? { to: '/community/new', label: '글 쓰러 가기' }
                  : {
                      to:
                        state.mission_key === 'bonus' &&
                        problem?.status === 'PUBLISHED'
                          ? `/problems/view/${encodeURIComponent(problem.slug)}`
                          : '/problems',
                      label: '문제 풀러 가기',
                    },
          };
        }),
      );
      return {
        items,
        badges,
        serverTime: now.toISOString(),
        timezone: 'Asia/Seoul',
        season: {
          done,
          total: 15,
          daysLeft: Math.max(
            0,
            Math.ceil((p.monthEnd.getTime() - now.getTime()) / DAY) - 1,
          ),
        },
      };
    });
  }

  async claim(userId: string, id: string) {
    return this.locked(userId, async (m, now) => {
      const [previous]: State[] = await m.query(
        'SELECT * FROM mission_states WHERE id=$1 AND user_id=$2',
        [id, userId],
      );
      if (!previous) throw new NotFoundException('미션을 찾을 수 없습니다.');
      if (previous.claimed_at) return this.receipt(m, userId, previous, true);
      const states = await this.refresh(m, userId, now);
      const state = states.find((s) => s.id === id);
      if (!state)
        throw new ConflictException(
          '미션 기간이 끝났습니다. 목록을 새로고침해 주세요.',
        );
      if (!state.completed_at)
        throw new ConflictException('아직 미션을 달성하지 않았습니다.');
      const [claimed]: State[] = await m.query(
        'WITH changed AS (UPDATE mission_states SET claimed_at=$2 WHERE id=$1 AND claimed_at IS NULL RETURNING *) SELECT * FROM changed',
        [id, now],
      );
      await m.query(
        'UPDATE users SET xp=xp+$2, level=1+(xp+$2)/100, updated_at=$3 WHERE id=$1',
        [userId, state.reward_xp, now],
      );
      if (state.badge)
        await m.query(
          'INSERT INTO user_badges(user_id,badge,awarded_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [userId, state.badge, now],
        );
      return this.receipt(m, userId, claimed, false);
    });
  }

  private async receipt(
    m: EntityManager,
    userId: string,
    state: State,
    alreadyClaimed: boolean,
  ) {
    const [user]: { xp: number; level: number }[] = await m.query(
      'SELECT xp,level FROM users WHERE id=$1',
      [userId],
    );
    return {
      stateId: state.id,
      claimedAt: state.claimed_at,
      awardedXp: state.reward_xp,
      alreadyClaimed,
      ...user,
      badges: await this.badges(m, userId),
    };
  }
  private async badges(m: EntityManager, userId: string) {
    const rows: { badge: string; awardedAt: Date }[] = await m.query(
      'SELECT badge,awarded_at AS "awardedAt" FROM user_badges WHERE user_id=$1 ORDER BY awarded_at,badge',
      [userId],
    );
    return rows.map((r) => ({ ...r, name: badgeNames[r.badge] ?? r.badge }));
  }

  private async refresh(m: EntityManager, userId: string, now: Date) {
    const p = periods(now);
    const [facts]: {
      daily: number;
      weekly: number;
      night: number;
      community: number;
      analysis: number;
      days: string[];
    }[] = await m.query(
      `
      SELECT
        (SELECT count(DISTINCT problem_id)::int FROM submissions WHERE user_id=$1 AND (accepted_for_xp OR status='ACCEPTED') AND created_at >= $2 AND created_at < $3) AS daily,
        (SELECT count(DISTINCT problem_id)::int FROM submissions WHERE user_id=$1 AND (accepted_for_xp OR status='ACCEPTED') AND created_at >= $4 AND created_at < $3) AS weekly,
        (SELECT count(*)::int FROM submissions WHERE user_id=$1 AND status::text IN ${learningVerdicts} AND created_at >= $2 AND created_at < LEAST($3,$2::timestamptz+interval '6 hours')) AS night,
        (SELECT count(*)::int FROM community_posts WHERE author_id=$1 AND category='SOLUTION' AND created_at >= $5 AND created_at < $3) AS community,
        (SELECT count(*)::int FROM analysis_attempts WHERE user_id=$1 AND day=$6::date) AS analysis,
        ARRAY(SELECT DISTINCT to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') FROM submissions WHERE user_id=$1 AND status::text IN ${learningVerdicts} AND created_at < $3) AS days
    `,
      [userId, p.start, now, p.week, p.month, p.day],
    );
    const streak = currentStreak(facts.days, p.day);
    const result: State[] = [];
    for (const d of definitions) {
      const key =
        d.period === 'streak'
          ? streak.start
          : d.period === 'week'
            ? kstDay(p.week)
            : d.period === 'month'
              ? kstDay(p.month)
              : p.day;
      const badge =
        d.id === 'night'
          ? 'night-coder'
          : d.id === 'streak'
            ? 'seven-day-streak'
            : null;
      // Assign a stable daily bonus once. Never reroll by refreshing the page or editing browser storage.
      let [state]: State[] = await m.query(
        'SELECT * FROM mission_states WHERE user_id=$1 AND mission_key=$2 AND period_key=$3',
        [userId, d.id, key],
      );
      if (!state) {
        const [bonus]: { id: string; xp: number }[] =
          d.id === 'bonus'
            ? await m.query(
                `
          SELECT p.id, CASE p.difficulty WHEN 'BEGINNER' THEN 10 WHEN 'EASY' THEN 20 WHEN 'MEDIUM' THEN 40 WHEN 'HARD' THEN 80 ELSE 160 END AS xp
          FROM problems p WHERE p.status='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM user_problem_solves s WHERE s.user_id=$1 AND s.problem_id=p.id)
          ORDER BY md5(p.id::text || $1::text || $2) LIMIT 1`,
                [userId, key],
              )
            : [];
        [state] = await m.query(
          `INSERT INTO mission_states(user_id,mission_key,period_key,target,reward_xp,badge,problem_id)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            userId,
            d.id,
            key,
            d.target,
            bonus?.xp ?? d.xp,
            badge,
            bonus?.id ?? null,
          ],
        );
      }
      if (!state.claimed_at) {
        let progress: number;
        if (d.id === 'bonus') {
          const [{ count }]: { count: number }[] = await m.query(
            `SELECT count(*)::int AS count FROM user_problem_solves s
            JOIN problems p ON p.id=s.problem_id JOIN submissions a ON a.id=s.accepted_submission_id
            WHERE s.user_id=$1 AND s.problem_id=$2 AND p.status='PUBLISHED' AND a.created_at >= $3 AND a.created_at < $4`,
            [userId, state.problem_id, p.start, now],
          );
          progress = count;
        } else progress = d.id === 'streak' ? streak.count : facts[d.id];
        progress = Math.min(d.target, progress);
        [state] = await m.query(
          `WITH changed AS (UPDATE mission_states SET progress=$2,
          completed_at=CASE WHEN $2 >= target THEN COALESCE(completed_at,$3) ELSE NULL END WHERE id=$1 RETURNING *) SELECT * FROM changed`,
          [state.id, progress, now],
        );
      }
      result.push(state);
    }
    return result;
  }

  async answer(userId: string, questionId: string, selected: number) {
    const question = analysisCatalog.find((q) => q.id === questionId);
    if (!question) throw new NotFoundException('분석 문제를 찾을 수 없습니다.');
    return this.locked(userId, async (m, now) => {
      const [row] = await m.query(
        `INSERT INTO analysis_attempts(user_id,question_id,day,selected,correct,solved,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$5,$6,$6)
        ON CONFLICT(user_id,question_id,day) DO UPDATE SET selected=EXCLUDED.selected,correct=EXCLUDED.correct,
          solved=analysis_attempts.solved OR EXCLUDED.correct,updated_at=EXCLUDED.updated_at
        RETURNING user_id AS "userId", question_id AS "questionId",selected,correct,solved,updated_at AS at`,
        [
          userId,
          questionId,
          kstDay(now),
          selected,
          question.answer === selected,
          now,
        ],
      );
      return row;
    });
  }
  attempts(userId: string) {
    return this.db.query(
      `SELECT DISTINCT ON (question_id) user_id AS "userId",question_id AS "questionId",selected,correct,
      bool_or(solved) OVER (PARTITION BY question_id) AS solved,updated_at AS at
      FROM analysis_attempts WHERE user_id=$1 ORDER BY question_id,updated_at DESC`,
      [userId],
    );
  }
}
