import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { recordAudit } from '../../common/database.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import {
  CommunityCategory,
  type CommunityPostDto,
  type CommunityQuery,
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
  createdAt: string;
  updatedAt: string;
}
export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
const columns = `p.id, p.author_id AS "authorId", p.category, p.tags, p.views, p.title, p.body, p.code, p.language,
  p.problem_id AS "problemId", p.accepted_comment_id AS "acceptedCommentId",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const summaryColumns = `p.id, p.author_id AS "authorId", p.category, p.tags, p.views, p.title,
  p.accepted_comment_id AS "acceptedCommentId", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const publicDetails = `jsonb_build_object('id', u.id, 'username', u.username, 'level', u.level) AS author,
  CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('id', pr.id, 'slug', pr.slug, 'title', pr.title) ELSE NULL END AS problem,
  (SELECT count(*)::int FROM community_comments c WHERE c.post_id=p.id) AS "commentCount",
  (SELECT count(*)::int FROM community_votes v WHERE v.post_id=p.id) AS "voteCount"`;
const joins = `JOIN users u ON u.id=p.author_id LEFT JOIN problems pr ON pr.id=p.problem_id AND pr.status='PUBLISHED'`;

@Injectable()
export class CommunityService {
  constructor(private readonly db: DataSource) {}

  async list(query: CommunityQuery) {
    const params: unknown[] = [];
    const baseConditions: string[] = [];
    if (query.problemId) {
      params.push(query.problemId);
      baseConditions.push(`p.problem_id=$${params.length}`);
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
    const baseWhere = baseConditions.length
      ? 'WHERE ' + baseConditions.join(' AND ')
      : '';
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
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
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

  async detail(id: string) {
    const [post]: Post[] = await this.db.query(
      `SELECT ${columns}, ${publicDetails} FROM community_posts p ${joins} WHERE p.id=$1`,
      [id],
    );
    if (!post) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    return post;
  }

  async comments(id: string, query: CommunityQuery) {
    await this.detail(id);
    const [count]: { total: number }[] = await this.db.query(
      'SELECT count(*)::int AS total FROM community_comments WHERE post_id=$1',
      [id],
    );
    const items: Comment[] = await this.db.query(
      `SELECT c.id, c.body, c.author_id AS "authorId", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      jsonb_build_object('id', u.id, 'username', u.username, 'level', u.level) AS author,
      (SELECT count(*)::int FROM community_comment_votes v WHERE v.comment_id=c.id) AS "voteCount"
      FROM community_comments c JOIN users u ON u.id=c.author_id
      WHERE c.post_id=$1 ORDER BY (c.id=(SELECT accepted_comment_id FROM community_posts WHERE id=$1)) DESC NULLS LAST, c.created_at, c.id LIMIT $2 OFFSET $3`,
      [id, query.limit, (query.page - 1) * query.limit],
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
    return this.detail(id);
  }

  private async lock(manager: EntityManager, id: string) {
    const [post]: Post[] = await manager.query(
      `SELECT ${columns} FROM community_posts p WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!post) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    return post;
  }
  private owner(authorId: string, user: AuthenticatedUser, allowAdmin = false) {
    if (authorId !== user.id && !(allowAdmin && user.role === UserRole.ADMIN))
      throw new ForbiddenException('작성자만 변경할 수 있습니다.');
  }

  async update(id: string, dto: CommunityPostDto, user: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id);
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
    return this.detail(id);
  }
  async remove(id: string, user: AuthenticatedUser) {
    await this.db.transaction(async (manager) => {
      const post = await this.lock(manager, id);
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
      await this.lock(manager, id);
      const [comment]: { id: string }[] = await manager.query(
        'INSERT INTO community_comments(post_id,author_id,body) VALUES($1,$2,$3) RETURNING id',
        [id, user.id, body],
      );
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
      await this.lock(manager, id);
      const [comment]: { authorId: string }[] = await manager.query(
        'SELECT author_id AS "authorId" FROM community_comments WHERE id=$1 AND post_id=$2',
        [commentId, id],
      );
      if (!comment) throw new NotFoundException('답변을 찾을 수 없습니다.');
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
      const post = await this.lock(manager, id);
      this.owner(post.authorId, user);
      if (post.category !== CommunityCategory.QUESTION)
        throw new BadRequestException('질문에서만 답변을 채택할 수 있습니다.');
      if (commentId) {
        const rows: { id: string }[] = await manager.query(
          'SELECT id FROM community_comments WHERE id=$1 AND post_id=$2',
          [commentId, id],
        );
        if (!rows.length)
          throw new NotFoundException('이 질문의 답변이 아닙니다.');
      }
      await manager.query(
        'UPDATE community_posts SET accepted_comment_id=$2,updated_at=now() WHERE id=$1',
        [id, commentId],
      );
    });
    return this.detail(id);
  }
  async vote(id: string, user: AuthenticatedUser, enabled: boolean) {
    await this.db.transaction(async (manager) => {
      await this.lock(manager, id);
      if (enabled)
        await manager.query(
          'INSERT INTO community_votes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [id, user.id],
        );
      else
        await manager.query(
          'DELETE FROM community_votes WHERE post_id=$1 AND user_id=$2',
          [id, user.id],
        );
    });
    return this.voteState(id, user);
  }
  async voteState(id: string, user: AuthenticatedUser) {
    await this.detail(id);
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
  async view(id: string) {
    await this.db.query(
      'UPDATE community_posts SET views=views+1 WHERE id=$1',
      [id],
    );
    return this.detail(id);
  }
  async authorStats(id: string) {
    const post = await this.detail(id);
    const [stats] = await this.db.query(
      `SELECT (SELECT count(*)::int FROM community_posts WHERE author_id=$1) AS posts,
      (SELECT count(*)::int FROM community_posts p JOIN community_comments c ON c.id=p.accepted_comment_id WHERE c.author_id=$1) AS "acceptedAnswers"`,
      [post.authorId],
    );
    return stats as { posts: number; acceptedAnswers: number };
  }
  async interaction(id: string, user: AuthenticatedUser) {
    const post = await this.detail(id);
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
      const post = await this.lock(manager, id);
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
      await this.lock(manager, id);
      const rows: { id: string }[] = await manager.query(
        'SELECT id FROM community_comments WHERE id=$1 AND post_id=$2',
        [commentId, id],
      );
      if (!rows.length) throw new NotFoundException('답변을 찾을 수 없습니다.');
      if (enabled)
        await manager.query(
          'INSERT INTO community_comment_votes(comment_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [commentId, user.id],
        );
      else
        await manager.query(
          'DELETE FROM community_comment_votes WHERE comment_id=$1 AND user_id=$2',
          [commentId, user.id],
        );
    });
    return { ok: true };
  }
}
