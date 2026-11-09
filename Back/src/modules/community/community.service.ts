import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { recordAudit } from '../../common/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  notifyAccepted,
  notifyAnswer,
} from '../notifications/notifications.service.js';
import { UserRole } from '../users/user-role.enum.js';
import {
  CommunityCategory,
  type CommunityPostDto,
  type CommunityQuery,
  type CommunityReportQuery,
} from './community.dto.js';

export interface Post {
  id: string;
  authorId: string;
  category: CommunityCategory;
  title: string;
  body: string;
  code: string;
  language: string;
  problemId: string | null;
  acceptedCommentId: string | null;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Comment {
  id: string;
  authorId: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}
const columns = `p.id, p.author_id AS "authorId", p.category, p.tags, p.views, p.title, p.body, p.code, p.language,
  p.accepted_comment_id AS "acceptedCommentId", p.hidden_at IS NOT NULL AS hidden,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const summaryColumns = `p.id, p.author_id AS "authorId", p.category, p.tags, p.views, p.title,
  p.accepted_comment_id AS "acceptedCommentId", p.hidden_at IS NOT NULL AS hidden,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const publicDetails = `jsonb_build_object('id', u.id, 'username', u.username, 'level', u.level) AS author,
  CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('id', pr.id, 'slug', pr.slug, 'title', pr.title) ELSE NULL END AS problem,
  (SELECT count(*)::int FROM community_comments c WHERE c.post_id=p.id AND c.hidden_at IS NULL) AS "commentCount",
  (SELECT count(*)::int FROM community_votes v WHERE v.post_id=p.id) AS "voteCount"`;
const joins = `JOIN users u ON u.id=p.author_id LEFT JOIN problems pr ON pr.id=p.problem_id AND pr.status='PUBLISHED'`;
/** 관리자가 숨긴 글·답변은 작성자와 관리자에게만 보인다. */
const canSee = (
  row: { hidden: boolean; authorId: string },
  user?: AuthenticatedUser,
) => !row.hidden || row.authorId === user?.id || user?.role === UserRole.ADMIN;

@Injectable()
export class CommunityService {
  constructor(private readonly db: DataSource) {}

  async list(query: CommunityQuery, viewer?: AuthenticatedUser) {
    const params: unknown[] = [];
    // 숨긴 글은 공개 목록에 넣지 않는다. 작성자는 내 글 목록(mine)에서 본다.
    const baseConditions = ['p.hidden_at IS NULL'];
    if (query.following === 'true') {
      if (!viewer) throw new UnauthorizedException('로그인이 필요합니다.');
      params.push(viewer.id);
      baseConditions.push(
        `p.author_id IN (SELECT author_id FROM community_follows WHERE user_id=$${params.length})`,
      );
    }
    if (query.problemId) {
      params.push(query.problemId);
      baseConditions.push(
        `EXISTS(SELECT 1 FROM problems visible_problem WHERE visible_problem.id=p.problem_id AND visible_problem.status='PUBLISHED' AND visible_problem.id=$${params.length})`,
      );
    }
    // 검색어는 제목에서만 찾고, 태그는 고른 태그를 모두 가진 글만 남긴다(대소문자 무시).
    if (query.q) {
      params.push(query.q);
      baseConditions.push(`strpos(lower(p.title),lower($${params.length}))>0`);
    }
    for (const tag of query.tag ?? []) {
      params.push(tag);
      baseConditions.push(
        `EXISTS(SELECT 1 FROM unnest(p.tags) t WHERE lower(t)=lower($${params.length}))`,
      );
    }
    const baseWhere = 'WHERE ' + baseConditions.join(' AND ');
    const groups: {
      category: CommunityCategory;
      accepted: boolean;
      count: number;
    }[] = await this.db.query(
      `SELECT category, accepted_comment_id IS NOT NULL AS accepted, count(*)::int AS count FROM community_posts p ${baseWhere} GROUP BY category, accepted_comment_id IS NOT NULL`,
      params,
    );
    const categories =
      query.categories ?? (query.category ? [query.category] : []);
    const statuses = query.status ?? [];
    const statusMatches = (accepted: boolean) =>
      !statuses.length ||
      statuses.includes(accepted ? 'accepted' : 'unaccepted');
    const categoryMatches = (category: CommunityCategory) =>
      !categories.length || categories.includes(category);
    const facets = {
      categories: {} as Record<string, number>,
      statuses: {} as Record<string, number>,
    };
    // 공지는 채택할 수 없으므로 '채택 전'으로 센다. 그래서 공지 칩·전체 칩·'채택 전' 칩에만 들어간다.
    for (const category of ['', ...Object.values(CommunityCategory)])
      facets.categories[category] = groups
        .filter(
          (g) =>
            (!category || g.category === category) && statusMatches(g.accepted),
        )
        .reduce((sum, g) => sum + g.count, 0);
    for (const status of ['', 'accepted', 'unaccepted'])
      facets.statuses[status] = groups
        .filter(
          (g) =>
            categoryMatches(g.category) &&
            (!status || g.accepted === (status === 'accepted')),
        )
        .reduce((sum, g) => sum + g.count, 0);
    const filterConditions: string[] = [];
    if (categories.length) {
      params.push(categories);
      filterConditions.push(`p.category=ANY($${params.length}::text[])`);
    }
    if (statuses.length === 1)
      filterConditions.push(
        statuses[0] === 'accepted'
          ? 'p.accepted_comment_id IS NOT NULL'
          : 'p.accepted_comment_id IS NULL',
      );
    const conditions = [...baseConditions];
    if (filterConditions.length) {
      const filters = filterConditions.join(' AND ');
      conditions.push(
        query.includePinned === 'true'
          ? `(p.category='NOTICE' OR (${filters}))`
          : `(${filters})`,
      );
    }
    const where = 'WHERE ' + conditions.join(' AND ');
    const [{ total }]: { total: number }[] = await this.db.query(
      `SELECT count(*)::int AS total FROM community_posts p ${where}`,
      params,
    );
    const sortColumn =
      query.sort === 'votes'
        ? '"voteCount"'
        : query.sort === 'answers'
          ? '"commentCount"'
          : query.sort === 'views'
            ? 'p.views'
            : 'p.created_at';
    const items: Post[] = await this.db.query(
      `SELECT ${summaryColumns}, ${publicDetails} FROM community_posts p ${joins} ${where} ORDER BY (p.category='NOTICE') DESC, ${sortColumn} DESC, p.created_at DESC, p.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return {
      items,
      total,
      facets,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /** 프로필·미션 화면용 내가 쓴 글·추천한 글·저장한 글, 목록의 팔로잉 표시용 팔로우한 작성자 */
  async mine(user: AuthenticatedUser) {
    // shortcut: 최근 100편씩만 돌려준다. 프로필에서 더 넘겨 봐야 하면 쪽 단위로 바꾼다.
    const recent = 'ORDER BY p.created_at DESC, p.id DESC LIMIT 100';
    // 내가 쓴 글은 숨겨졌어도 보여 주고, 남의 숨긴 글은 추천·저장 목록에서 뺀다.
    const visible = '(p.hidden_at IS NULL OR p.author_id=$1)';
    const [written, voted, saved, follows] = await Promise.all([
      this.db.query(
        `SELECT ${summaryColumns}, ${publicDetails} FROM community_posts p ${joins} WHERE p.author_id=$1 ${recent}`,
        [user.id],
      ) as Promise<Post[]>,
      this.db.query(
        `SELECT ${summaryColumns}, ${publicDetails} FROM community_posts p ${joins}
        JOIN community_votes v ON v.post_id=p.id AND v.user_id=$1 WHERE ${visible} ${recent}`,
        [user.id],
      ) as Promise<Post[]>,
      this.db.query(
        `SELECT ${summaryColumns}, ${publicDetails} FROM community_posts p ${joins}
        JOIN community_saved s ON s.post_id=p.id AND s.user_id=$1 WHERE ${visible} ${recent}`,
        [user.id],
      ) as Promise<Post[]>,
      this.db.query(
        'SELECT author_id AS "authorId" FROM community_follows WHERE user_id=$1',
        [user.id],
      ) as Promise<{ authorId: string }[]>,
    ]);
    return {
      written,
      voted,
      saved,
      following: follows.map((follow) => follow.authorId),
    };
  }

  async detail(id: string, viewer?: AuthenticatedUser) {
    const [post]: Post[] = await this.db.query(
      `SELECT ${columns}, pr.id AS "problemId", ${publicDetails} FROM community_posts p ${joins} WHERE p.id=$1`,
      [id],
    );
    if (!post || !canSee(post, viewer))
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    return post;
  }

  async comments(
    id: string,
    query: CommunityQuery,
    viewer?: AuthenticatedUser,
  ) {
    await this.detail(id, viewer);
    const visible = '(c.hidden_at IS NULL OR c.author_id=$2::uuid OR $3)';
    const params = [id, viewer?.id ?? null, viewer?.role === UserRole.ADMIN];
    const [count]: { total: number }[] = await this.db.query(
      `SELECT count(*)::int AS total FROM community_comments c WHERE c.post_id=$1 AND ${visible}`,
      params,
    );
    const items: Comment[] = await this.db.query(
      `SELECT c.id, c.body, c.author_id AS "authorId", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      c.hidden_at IS NOT NULL AS hidden,
      jsonb_build_object('id', u.id, 'username', u.username, 'level', u.level) AS author,
      (SELECT count(*)::int FROM community_comment_votes v WHERE v.comment_id=c.id) AS "voteCount"
      FROM community_comments c JOIN users u ON u.id=c.author_id
      WHERE c.post_id=$1 AND ${visible}
      ORDER BY (c.id=(SELECT accepted_comment_id FROM community_posts WHERE id=$1)) DESC NULLS LAST, c.created_at, c.id LIMIT $4 OFFSET $5`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return {
      items,
      total: count.total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(count.total / query.limit),
    };
  }

  private async validatePost(manager: EntityManager, dto: CommunityPostDto) {
    if (dto.category === CommunityCategory.SOLUTION && !dto.problemId)
      throw new BadRequestException('풀이를 공유할 문제를 선택하세요.');
    if (
      dto.category === CommunityCategory.REVIEW &&
      (!dto.code?.trim() || !dto.language?.trim())
    )
      throw new BadRequestException('코드 리뷰에는 코드와 언어가 필요합니다.');
    if (dto.problemId) {
      const rows: { id: string }[] = await manager.query(
        "SELECT id FROM problems WHERE id=$1 AND status='PUBLISHED' FOR SHARE",
        [dto.problemId],
      );
      if (!rows.length)
        throw new BadRequestException('공개된 문제만 연결할 수 있습니다.');
    }
  }

  async create(dto: CommunityPostDto, user: AuthenticatedUser) {
    const id = await this.db.transaction(async (manager) => {
      this.noticePermission(dto, user);
      await this.validatePost(manager, dto);
      const [post]: { id: string }[] = await manager.query(
        `INSERT INTO community_posts(author_id,category,title,body,code,language,problem_id,tags)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          user.id,
          dto.category,
          dto.title,
          dto.body,
          dto.code ?? '',
          dto.language ?? '',
          dto.problemId ?? null,
          dto.tags ?? [],
        ],
      );
      return post.id;
    });
    return this.detail(id, user);
  }

  /** 글을 잠근다. 숨긴 글은 작성자·관리자가 아니면 없는 글로 본다. */
  private async lock(
    manager: EntityManager,
    id: string,
    user: AuthenticatedUser,
  ) {
    const [post]: Post[] = await manager.query(
      `SELECT ${columns}, p.problem_id AS "problemId" FROM community_posts p WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!post || !canSee(post, user))
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    return post;
  }
  /** 글에 딸린 답변. 숨긴 답변은 작성자·관리자가 아니면 없는 답변으로 본다. */
  private async findComment(
    manager: EntityManager,
    id: string,
    commentId: string,
    user: AuthenticatedUser,
  ) {
    const [comment]: { authorId: string; hidden: boolean }[] =
      await manager.query(
        'SELECT author_id AS "authorId", hidden_at IS NOT NULL AS hidden FROM community_comments WHERE id=$1 AND post_id=$2',
        [commentId, id],
      );
    if (!comment || !canSee(comment, user))
      throw new NotFoundException('답변을 찾을 수 없습니다.');
    return comment;
  }
  private owner(authorId: string, user: AuthenticatedUser, allowAdmin = false) {
    if (authorId !== user.id && !(allowAdmin && user.role === UserRole.ADMIN))
      throw new ForbiddenException('작성자만 변경할 수 있습니다.');
  }

  async update(id: string, dto: CommunityPostDto, user: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      this.owner(post.authorId, user);
      this.noticePermission(dto, user);
      if (post.category !== dto.category)
        throw new BadRequestException('게시판 종류는 변경할 수 없습니다.');
      await this.validatePost(manager, dto);
      await manager.query(
        `UPDATE community_posts SET title=$2,body=$3,code=$4,language=$5,problem_id=$6,tags=$7,updated_at=now() WHERE id=$1`,
        [
          id,
          dto.title,
          dto.body,
          dto.code ?? '',
          dto.language ?? '',
          dto.problemId ?? null,
          dto.tags ?? [],
        ],
      );
    });
    return this.detail(id, user);
  }
  async remove(id: string, user: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      this.owner(post.authorId, user, true);
      await manager.query(
        'UPDATE community_posts SET accepted_comment_id=NULL WHERE id=$1',
        [id],
      );
      await manager.query('DELETE FROM community_posts WHERE id=$1', [id]);
      if (post.authorId !== user.id)
        await recordAudit(
          manager,
          user.id,
          'community_post.delete',
          'community_post',
          id,
          { authorId: post.authorId, title: post.title },
        );
    });
    return { ok: true };
  }
  async addComment(id: string, body: string, user: AuthenticatedUser) {
    return this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      const [comment]: { id: string }[] = await manager.query(
        'INSERT INTO community_comments(post_id,author_id,body) VALUES($1,$2,$3) RETURNING id',
        [id, user.id, body],
      );
      await notifyAnswer(manager, post.authorId, user.id, id, comment.id);
      return comment;
    });
  }
  async changeComment(
    id: string,
    commentId: string,
    body: string | null,
    user: AuthenticatedUser,
  ) {
    await this.db.transaction(async (manager) => {
      await this.lock(manager, id, user);
      const comment = await this.findComment(manager, id, commentId, user);
      this.owner(comment.authorId, user, body === null);
      if (body === null) {
        await manager.query('DELETE FROM community_comments WHERE id=$1', [
          commentId,
        ]);
        if (comment.authorId !== user.id)
          await recordAudit(
            manager,
            user.id,
            'community_comment.delete',
            'community_comment',
            commentId,
            { postId: id, authorId: comment.authorId },
          );
      } else
        await manager.query(
          'UPDATE community_comments SET body=$2,updated_at=now() WHERE id=$1',
          [commentId, body],
        );
    });
    return { ok: true };
  }
  async accept(id: string, commentId: string | null, user: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      this.owner(post.authorId, user);
      if (post.category !== CommunityCategory.QUESTION)
        throw new BadRequestException('질문에서만 답변을 채택할 수 있습니다.');
      const comment = commentId
        ? await this.findComment(manager, id, commentId, user)
        : null;
      await manager.query(
        'UPDATE community_posts SET accepted_comment_id=$2,updated_at=now() WHERE id=$1',
        [id, commentId],
      );
      if (comment && commentId)
        await notifyAccepted(manager, comment.authorId, user.id, id, commentId);
    });
    return this.detail(id, user);
  }
  async vote(id: string, user: AuthenticatedUser, enabled: boolean) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      if (enabled) {
        if (post.authorId === user.id)
          throw new BadRequestException('자신의 글은 추천할 수 없습니다.');
        await manager.query(
          'INSERT INTO community_votes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [id, user.id],
        );
      } else
        await manager.query(
          'DELETE FROM community_votes WHERE post_id=$1 AND user_id=$2',
          [id, user.id],
        );
    });
    return this.voteState(id, user);
  }
  async voteState(id: string, user: AuthenticatedUser) {
    await this.detail(id, user);
    const [state]: { voted: boolean; voteCount: number }[] =
      await this.db.query(
        `SELECT
      EXISTS(SELECT 1 FROM community_votes WHERE post_id=$1 AND user_id=$2) AS voted,
      (SELECT count(*)::int FROM community_votes WHERE post_id=$1) AS "voteCount"`,
        [id, user.id],
      );
    return state;
  }
  private noticePermission(dto: CommunityPostDto, user: AuthenticatedUser) {
    if (
      dto.category === CommunityCategory.NOTICE &&
      user.role !== UserRole.ADMIN
    )
      throw new ForbiddenException('공지 작성은 관리자만 가능합니다.');
  }
  /**
   * 같은 사람(로그인 사용자, 아니면 IP)의 조회는 하루에 한 번만 센다. 원래 값 대신 해시만 저장한다.
   * shortcut: 다시 조회되지 않는 글의 지난 기록은 남는다(글·사람당 한 줄). 커지면 주기적으로 지운다.
   */
  async view(id: string, viewerKey: string, viewer?: AuthenticatedUser) {
    await this.detail(id, viewer);
    const hash = createHash('sha256').update(viewerKey).digest('hex');
    await this.db.query(
      `DELETE FROM community_post_views WHERE post_id=$1 AND viewed_at < now() - interval '1 day'`,
      [id],
    );
    await this.db.query(
      `WITH fresh AS (
        INSERT INTO community_post_views(post_id,viewer) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING 1
      ) UPDATE community_posts SET views=views+1 WHERE id=$1 AND EXISTS(SELECT 1 FROM fresh)`,
      [id, hash],
    );
    return this.detail(id, viewer);
  }
  async authorStats(id: string, viewer?: AuthenticatedUser) {
    const post = await this.detail(id, viewer);
    const [stats] = await this.db.query(
      `SELECT (SELECT count(*)::int FROM community_posts WHERE author_id=$1 AND hidden_at IS NULL) AS posts,
      (SELECT count(*)::int FROM community_posts p JOIN community_comments c ON c.id=p.accepted_comment_id WHERE c.author_id=$1) AS "acceptedAnswers",
      (SELECT count(*)::int FROM community_follows WHERE author_id=$1) AS followers,
      (SELECT count(*)::int FROM community_follows WHERE user_id=$1) AS following`,
      [post.authorId],
    );
    return stats as {
      posts: number;
      acceptedAnswers: number;
      followers: number;
      following: number;
    };
  }
  async interaction(id: string, user: AuthenticatedUser) {
    const post = await this.detail(id, user);
    const [state] = await this.db.query(
      `SELECT
      EXISTS(SELECT 1 FROM community_votes WHERE post_id=$1 AND user_id=$2) AS voted,
      EXISTS(SELECT 1 FROM community_saved WHERE post_id=$1 AND user_id=$2) AS saved,
      EXISTS(SELECT 1 FROM community_follows WHERE author_id=$3 AND user_id=$2) AS following,
      ARRAY(SELECT v.comment_id FROM community_comment_votes v JOIN community_comments c ON c.id=v.comment_id WHERE c.post_id=$1 AND v.user_id=$2) AS "commentVotes"`,
      [id, user.id, post.authorId],
    );
    return state as {
      voted: boolean;
      saved: boolean;
      following: boolean;
      commentVotes: string[];
    };
  }
  async relationship(
    id: string,
    user: AuthenticatedUser,
    kind: 'saved' | 'follow',
    enabled: boolean,
  ) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      if (kind === 'follow' && post.authorId === user.id)
        throw new BadRequestException('자신을 팔로우할 수 없습니다.');
      const table = kind === 'saved' ? 'community_saved' : 'community_follows';
      const column = kind === 'saved' ? 'post_id' : 'author_id';
      const target = kind === 'saved' ? id : post.authorId;
      if (enabled)
        await manager.query(
          `INSERT INTO ${table}(${column},user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [target, user.id],
        );
      else
        await manager.query(
          `DELETE FROM ${table} WHERE ${column}=$1 AND user_id=$2`,
          [target, user.id],
        );
    });
    return this.interaction(id, user);
  }
  async commentVote(
    id: string,
    commentId: string,
    user: AuthenticatedUser,
    enabled: boolean,
  ) {
    await this.db.transaction(async (manager) => {
      await this.lock(manager, id, user);
      const comment = await this.findComment(manager, id, commentId, user);
      if (enabled) {
        if (comment.authorId === user.id)
          throw new BadRequestException('자신의 답변은 추천할 수 없습니다.');
        await manager.query(
          'INSERT INTO community_comment_votes(comment_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [commentId, user.id],
        );
      } else
        await manager.query(
          'DELETE FROM community_comment_votes WHERE comment_id=$1 AND user_id=$2',
          [commentId, user.id],
        );
    });
    return { ok: true };
  }

  /** 글(commentId가 없으면) 또는 답변을 신고한다. 한 사람이 같은 대상을 한 번만 신고할 수 있다. */
  async report(
    id: string,
    commentId: string | null,
    reason: string,
    user: AuthenticatedUser,
  ) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id, user);
      const authorId = commentId
        ? (await this.findComment(manager, id, commentId, user)).authorId
        : post.authorId;
      if (authorId === user.id)
        throw new BadRequestException('자신의 글은 신고할 수 없습니다.');
      const inserted: unknown[] = await manager.query(
        `INSERT INTO community_reports(reporter_id,post_id,comment_id,reason) VALUES($1,$2,$3,$4)
        ON CONFLICT DO NOTHING RETURNING id`,
        [user.id, commentId ? null : id, commentId, reason],
      );
      if (!inserted.length) throw new ConflictException('이미 신고했습니다.');
    });
    return { ok: true };
  }

  /** 관리자용 신고 목록. 기본은 처리 전 신고를 최신순으로 */
  async reports(query: CommunityReportQuery) {
    const where =
      query.status === 'all'
        ? ''
        : query.status === 'resolved'
          ? 'WHERE r.resolved_at IS NOT NULL'
          : 'WHERE r.resolved_at IS NULL';
    const [[{ total }], items] = await Promise.all([
      this.db.query(
        `SELECT count(*)::int AS total FROM community_reports r ${where}`,
      ) as Promise<{ total: number }[]>,
      this.db.query(
        `SELECT r.id, r.reason, r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
        CASE WHEN r.comment_id IS NULL THEN 'POST' ELSE 'COMMENT' END AS "targetType",
        jsonb_build_object('id', ru.id, 'username', ru.username) AS reporter,
        jsonb_build_object('id', au.id, 'username', au.username) AS author,
        jsonb_build_object('id', p.id, 'title', p.title, 'hidden', p.hidden_at IS NOT NULL) AS post,
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'body', left(c.body, 300), 'hidden', c.hidden_at IS NOT NULL) END AS comment
        FROM community_reports r
        JOIN users ru ON ru.id=r.reporter_id
        LEFT JOIN community_comments c ON c.id=r.comment_id
        JOIN community_posts p ON p.id=coalesce(r.post_id, c.post_id)
        JOIN users au ON au.id=coalesce(c.author_id, p.author_id)
        ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $1 OFFSET $2`,
        [query.limit, (query.page - 1) * query.limit],
      ) as Promise<unknown[]>,
    ]);
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /** 관리자가 글·답변을 숨기거나 되살린다. 데이터는 지우지 않고, 그 대상의 처리 전 신고를 처리됨으로 바꾼다. */
  async setHidden(
    kind: 'post' | 'comment',
    id: string,
    hidden: boolean,
    admin: AuthenticatedUser,
  ) {
    const table = kind === 'post' ? 'community_posts' : 'community_comments';
    await this.db.transaction(async (manager) => {
      const [rows]: [{ authorId: string }[], number] = await manager.query(
        `UPDATE ${table} SET hidden_at=CASE WHEN $2::boolean THEN coalesce(hidden_at, now()) END WHERE id=$1 RETURNING author_id AS "authorId"`,
        [id, hidden],
      );
      if (!rows.length)
        throw new NotFoundException(
          kind === 'post'
            ? '게시글을 찾을 수 없습니다.'
            : '답변을 찾을 수 없습니다.',
        );
      await manager.query(
        `UPDATE community_reports SET resolved_at=now() WHERE ${kind}_id=$1 AND resolved_at IS NULL`,
        [id],
      );
      await recordAudit(
        manager,
        admin.id,
        `community_${kind}.${hidden ? 'hide' : 'unhide'}`,
        `community_${kind}`,
        id,
        { authorId: rows[0].authorId },
      );
    });
    return { ok: true, hidden };
  }

  /** 숨기지 않고 신고만 처리됨으로 닫는다. */
  async resolveReport(id: string, admin: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const [rows]: [unknown[], number] = await manager.query(
        'UPDATE community_reports SET resolved_at=coalesce(resolved_at, now()) WHERE id=$1 RETURNING id',
        [id],
      );
      if (!rows.length) throw new NotFoundException('신고를 찾을 수 없습니다.');
      await recordAudit(
        manager,
        admin.id,
        'community_report.resolve',
        'community_report',
        id,
        {},
      );
    });
    return { ok: true };
  }
}
