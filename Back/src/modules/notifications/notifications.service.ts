import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

/** 내 글에 남이 답변을 달았다. 답변을 저장한 트랜잭션에서 부른다. */
export async function notifyAnswer(
  manager: EntityManager,
  postAuthorId: string,
  actorId: string,
  postId: string,
  commentId: string,
) {
  if (postAuthorId === actorId) return;
  await manager.query(
    `INSERT INTO notifications(user_id,type,actor_id,post_id,comment_id) VALUES($1,'ANSWER',$2,$3,$4)`,
    [postAuthorId, actorId, postId, commentId],
  );
}

/** 내 답변이 채택됐다. 채택을 풀었다 다시 해도 답변당 한 번만 알린다. */
export async function notifyAccepted(
  manager: EntityManager,
  commentAuthorId: string,
  actorId: string,
  postId: string,
  commentId: string,
) {
  if (commentAuthorId === actorId) return;
  await manager.query(
    `INSERT INTO notifications(user_id,type,actor_id,post_id,comment_id) VALUES($1,'ACCEPTED',$2,$3,$4)
    ON CONFLICT (comment_id) WHERE type='ACCEPTED' DO NOTHING`,
    [commentAuthorId, actorId, postId, commentId],
  );
}

/**
 * 제출의 채점이 끝났음을 제출자에게 알린다. 최종 판정을 저장한 트랜잭션에서 부른다.
 * 제출당 알림은 하나다. 재전송은 무해하고, 재채점이 끝나면 같은 알림을 안 읽음·최신 시각으로 올린다.
 */
export async function notifySubmissionJudged(
  manager: EntityManager,
  submissionId: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO notifications(user_id,type,submission_id)
    SELECT user_id,'JUDGED',id FROM submissions WHERE id=$1
    ON CONFLICT (submission_id) DO UPDATE SET read_at=NULL, created_at=now()`,
    [submissionId],
  );
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DataSource) {}

  async list(userId: string, page: number, limit: number) {
    const [items, [counts]] = await Promise.all([
      this.db.query(
        `SELECT n.id, n.type, n.read_at AS "readAt", n.created_at AS "createdAt", n.comment_id AS "commentId",
        CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id', a.id, 'username', a.username) END AS actor,
        CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id', p.id, 'title', p.title) END AS post,
        CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id', s.id, 'status', s.status, 'problemTitle', pr.title) END AS submission
        FROM notifications n
        LEFT JOIN users a ON a.id=n.actor_id
        LEFT JOIN community_posts p ON p.id=n.post_id
        LEFT JOIN submissions s ON s.id=n.submission_id
        LEFT JOIN problems pr ON pr.id=s.problem_id
        WHERE n.user_id=$1 ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
        [userId, limit, (page - 1) * limit],
      ) as Promise<unknown[]>,
      this.db.query(
        `SELECT count(*)::int AS total, (count(*) FILTER (WHERE read_at IS NULL))::int AS unread
        FROM notifications WHERE user_id=$1`,
        [userId],
      ) as Promise<{ total: number; unread: number }[]>,
    ]);
    return {
      items,
      total: counts.total,
      unread: counts.unread,
      page,
      limit,
      totalPages: Math.ceil(counts.total / limit),
    };
  }

  async unreadCount(userId: string) {
    const [row]: { unread: number }[] = await this.db.query(
      'SELECT count(*)::int AS unread FROM notifications WHERE user_id=$1 AND read_at IS NULL',
      [userId],
    );
    return row;
  }

  async markRead(userId: string, id: string) {
    const [rows]: [unknown[], number] = await this.db.query(
      'UPDATE notifications SET read_at=coalesce(read_at, now()) WHERE id=$1 AND user_id=$2 RETURNING id',
      [id, userId],
    );
    if (!rows.length) throw new NotFoundException('알림을 찾을 수 없습니다.');
    return this.unreadCount(userId);
  }

  async markAllRead(userId: string) {
    await this.db.query(
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',
      [userId],
    );
    return { unread: 0 };
  }
}
