import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  challenge,
  editableFiles,
  initialFiles,
  VIBE_LIMITS,
  validateFiles,
} from './vibe.catalog.js';
import { VibeAi } from './vibe.ai.js';
import { canJoinEnterprise } from '../enterprise/enterprise-access.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { VibeRunner } from './vibe.runner.js';
import type {
  ProjectFiles,
  VibeAttemptRow,
  VibeEvent,
  VibeReport,
  VibeState,
} from './vibe.types.js';

@Injectable()
export class VibeService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ai: VibeAi,
    private readonly runner: VibeRunner,
  ) {}

  catalog() {
    return {
      items: [challenge],
      limits: VIBE_LIMITS,
      availability: { ai: this.ai.available, runner: this.runner.available },
    };
  }
  async list(userId: string) {
    return this.db.query(
      `SELECT id, challenge_id AS "challengeId", started_at AS "startedAt", deadline_at AS "deadlineAt", submitted_at AS "submittedAt", CASE WHEN jsonb_typeof(state->'report')='object' THEN (state->'report')-'model' END AS report FROM vibe_attempts WHERE user_id=$1 AND enterprise_attempt_id IS NULL ORDER BY started_at DESC LIMIT 20`,
      [userId],
    );
  }
  private view(row: VibeAttemptRow, reviewer = false) {
    const report =
      !row.enterprise_attempt_id || row.score_visible || reviewer
        ? row.state.report
        : null;
    return {
      id: row.id,
      challenge,
      enterprise: row.enterprise_attempt_id
        ? {
            testId: row.enterprise_test_id,
            attemptId: row.enterprise_attempt_id,
            finished: row.enterprise_closed,
            scoreVisible: row.score_visible,
          }
        : null,
      revision: row.revision,
      startedAt: row.started_at,
      deadlineAt: row.deadline_at,
      submittedAt: row.submitted_at,
      busyUntil: row.busy_until,
      files: { ...initialFiles, ...row.state.files },
      editablePaths: Object.keys(editableFiles()),
      messages: row.state.messages,
      events: row.state.events,
      runs: row.state.runs,
      report: report && {
        outcome: report.outcome,
        passed: report.passed,
        total: report.total,
        prompt: report.prompt,
        process: report.process,
        evaluationStatus: report.evaluationStatus,
        reflection: report.reflection,
        checks: report.checks,
      },
      canUndo: Boolean(row.state.undo),
      remainingAiRequests: VIBE_LIMITS.aiRequests - row.state.aiRequests,
      remainingRuns: VIBE_LIMITS.runs - row.state.runs.length,
      availability: { ai: this.ai.available, runner: this.runner.available },
      limits: VIBE_LIMITS,
    };
  }
  private async owned(
    id: string,
    userId: string,
    manager: EntityManager = this.db.manager,
    lock = false,
  ) {
    // Parent first: ending an exam and editing its workspace must use the same lock order.
    if (lock)
      await manager.query(
        'SELECT a.id FROM enterprise_attempts a JOIN vibe_attempts v ON v.enterprise_attempt_id=a.id WHERE v.id=$1 AND v.user_id=$2 FOR UPDATE OF a',
        [id, userId],
      );
    const [row]: VibeAttemptRow[] = await manager.query(
      `SELECT v.*, LEAST(v.deadline_at,a.deadline_at,t.ends_at) AS deadline_at, t.id AS enterprise_test_id,
        coalesce(a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now(),false) AS enterprise_closed,
        coalesce(t.show_score_to_candidates AND (a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now()),false) AS score_visible
       FROM vibe_attempts v LEFT JOIN enterprise_attempts a ON a.id=v.enterprise_attempt_id LEFT JOIN enterprise_tests t ON t.id=a.test_id
       WHERE v.id=$1 AND v.user_id=$2 AND (v.enterprise_attempt_id IS NULL OR ${canJoinEnterprise('$2')})${lock ? ' FOR UPDATE OF v' : ''}`,
      [id, userId],
    );
    if (!row) throw new NotFoundException('연습 기록을 찾을 수 없습니다.');
    return row;
  }
  private initialState(): VibeState {
    return {
      files: editableFiles(),
      messages: [],
      events: [],
      runs: [],
      undo: null,
      report: null,
      aiRequests: 0,
      evaluations: 0,
    };
  }
  private async snapshot(
    manager: EntityManager,
    row: VibeAttemptRow,
    action: string,
    paths: string[] = [],
    messageId?: string,
  ) {
    await manager.query(
      'INSERT INTO vibe_revisions(attempt_id,revision,action,files,paths,message_id) VALUES($1,$2,$3,$4,$5,$6)',
      [
        row.id,
        row.revision,
        action,
        JSON.stringify(row.state.files),
        paths,
        messageId ?? null,
      ],
    );
  }
  async startEnterprise(examId: string, challengeId: string, userId: string) {
    return this.db.transaction(async (manager) => {
      const [exam]: {
        deadline_at: Date;
        closed: boolean;
        vibe_challenge_ids: string[];
      }[] = await manager.query(
        `SELECT LEAST(a.deadline_at,t.ends_at) AS deadline_at, (a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now()) AS closed, t.vibe_challenge_ids
         FROM enterprise_attempts a JOIN enterprise_tests t ON t.id=a.test_id WHERE a.id=$1 AND a.user_id=$2 AND ${canJoinEnterprise('$2')} FOR UPDATE OF a`,
        [examId, userId],
      );
      if (
        !exam ||
        !exam.vibe_challenge_ids.includes(challengeId) ||
        challengeId !== challenge.id
      )
        throw new NotFoundException('응시 과제를 찾을 수 없습니다.');
      const [existing]: VibeAttemptRow[] = await manager.query(
        'SELECT * FROM vibe_attempts WHERE enterprise_attempt_id=$1 AND challenge_id=$2',
        [examId, challengeId],
      );
      if (existing)
        return this.view(await this.owned(existing.id, userId, manager));
      if (exam.closed)
        throw new ConflictException(
          '응시가 끝나 새 과제를 시작할 수 없습니다.',
        );
      const [row]: VibeAttemptRow[] = await manager.query(
        'INSERT INTO vibe_attempts(user_id,challenge_id,state,model,enterprise_attempt_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          userId,
          challengeId,
          JSON.stringify(this.initialState()),
          this.ai.model,
          examId,
          exam.deadline_at,
        ],
      );
      await this.snapshot(manager, row, 'initial');
      return this.view(await this.owned(row.id, userId, manager));
    });
  }
  /** Read retained assessment evidence using staff authority, not a candidate's current invitation.
   * This is deliberately separate from owned(), which still protects candidate operations.
   */
  private async staffOwned(
    id: string,
    userId: string,
    staff: AuthenticatedUser,
  ) {
    const [row]: VibeAttemptRow[] = await this.db.query(
      `SELECT v.*, LEAST(v.deadline_at,a.deadline_at,t.ends_at) AS deadline_at, t.id AS enterprise_test_id,
        (a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now()) AS enterprise_closed,
        (t.show_score_to_candidates AND (a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now())) AS score_visible
       FROM vibe_attempts v JOIN enterprise_attempts a ON a.id=v.enterprise_attempt_id JOIN enterprise_tests t ON t.id=a.test_id
       JOIN users reviewer ON reviewer.id=$3
       WHERE v.id=$1 AND v.user_id=$2 AND (t.owner_id=reviewer.id OR reviewer.role='ADMIN')
         AND reviewer.deleted_at IS NULL AND reviewer.suspended_at IS NULL
         AND ($4::integer IS NULL OR reviewer.token_version=$4)`,
      [id, userId, staff.id, staff.tokenVersion ?? null],
    );
    if (!row) throw new NotFoundException('응시 과제를 찾을 수 없습니다.');
    return row;
  }
  async reviewForStaff(id: string, userId: string, staff: AuthenticatedUser) {
    const row = await this.staffOwned(id, userId, staff);
    const revisions = await this.db.query(
      'SELECT revision,action,paths,message_id AS "messageId",created_at AS "createdAt" FROM vibe_revisions WHERE attempt_id=$1 ORDER BY revision',
      [id],
    );
    return { ...this.view(row, true), revisions };
  }
  async revisionForStaff(
    id: string,
    userId: string,
    revision: number,
    staff: AuthenticatedUser,
  ) {
    await this.staffOwned(id, userId, staff);
    const rows: { revision: number; files: ProjectFiles }[] =
      await this.db.query(
        'SELECT revision,files FROM vibe_revisions WHERE attempt_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 2',
        [id, revision],
      );
    if (rows[0]?.revision !== revision)
      throw new NotFoundException('수정 기록을 찾을 수 없습니다.');
    return {
      revision,
      files: rows[0].files,
      previousFiles: rows[1]?.files ?? rows[0].files,
    };
  }
  async finalize(id: string, userId: string) {
    const row = await this.owned(id, userId);
    if (!row.submitted_at) return this.run(id, userId, row.revision, true);
    if (row.state.report?.evaluationStatus !== 'complete')
      return this.evaluate(id, userId, row.revision);
    return this.get(id, userId);
  }
  async finalizeExam(examId: string, userId: string) {
    const rows: { id: string }[] = await this.db.query(
      'SELECT id FROM vibe_attempts WHERE enterprise_attempt_id=$1 AND user_id=$2',
      [examId, userId],
    );
    // A busy or unavailable task stays pending; its saved snapshot remains available to the reviewer.
    await Promise.allSettled(rows.map((row) => this.finalize(row.id, userId)));
  }
  async get(id: string, userId: string) {
    return this.view(await this.owned(id, userId));
  }

  async start(challengeId: string, userId: string) {
    if (challengeId !== challenge.id)
      throw new NotFoundException('과제를 찾을 수 없습니다.');
    return this.db.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe-user:' || $1, 0))",
        [userId],
      );
      const [active]: VibeAttemptRow[] = await manager.query(
        'SELECT * FROM vibe_attempts WHERE user_id=$1 AND challenge_id=$2 AND enterprise_attempt_id IS NULL AND submitted_at IS NULL AND deadline_at>now() ORDER BY started_at DESC LIMIT 1',
        [userId, challengeId],
      );
      if (active) return this.view(active);
      const [{ count }]: { count: number }[] = await manager.query(
        "SELECT count(*)::int AS count FROM vibe_attempts WHERE user_id=$1 AND enterprise_attempt_id IS NULL AND started_at>now()-interval '1 day'",
        [userId],
      );
      if (count >= VIBE_LIMITS.dailyAttempts)
        throw new HttpException(
          '새 연습은 24시간에 5회까지 시작할 수 있습니다.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      const state = this.initialState();
      const [row]: VibeAttemptRow[] = await manager.query(
        'INSERT INTO vibe_attempts(user_id,challenge_id,state,model) VALUES($1,$2,$3,$4) RETURNING *',
        [userId, challengeId, JSON.stringify(state), this.ai.model],
      );
      await this.snapshot(manager, row, 'initial');
      return this.view(row);
    });
  }

  private assertRevision(
    row: VibeAttemptRow,
    revision: number,
    submitted = false,
    expired = false,
  ) {
    if (row.revision !== revision)
      throw new ConflictException(
        '다른 탭에서 변경되었습니다. 현재 코드를 복사해 보관하고 최신 기록을 다시 열어 주세요.',
      );
    if (!submitted && row.submitted_at)
      throw new ConflictException('제출을 마친 연습은 수정할 수 없습니다.');
    if (
      !expired &&
      (row.enterprise_closed || row.deadline_at.getTime() <= Date.now())
    )
      throw new ConflictException(
        '연습 시간이 끝났습니다. 마지막 저장본을 제출할 수 있습니다.',
      );
    if (row.busy_until && row.busy_until.getTime() > Date.now())
      throw new ConflictException(
        '진행 중인 작업이 있습니다. 잠시 뒤 다시 시도해 주세요.',
      );
    // A resumed edit invalidates a timed-out operation before its late response can overwrite it.
    row.operation_id = null;
    row.busy_until = null;
    if (!expired && row.state.events.length >= 150)
      throw new BadRequestException(
        '변경 기록 한도에 도달했습니다. 현재 저장본을 제출해 주세요.',
      );
  }
  private event(
    row: VibeAttemptRow,
    type: VibeEvent['type'],
    extra: Partial<VibeEvent> = {},
  ) {
    row.state.events.push({
      id: randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      revision: row.revision,
      ...extra,
    });
  }
  private async persist(manager: EntityManager, row: VibeAttemptRow) {
    const [saved]: VibeAttemptRow[] = await manager.query(
      'WITH saved AS (UPDATE vibe_attempts SET state=$2,revision=$3,submitted_at=$4,operation_id=$5,busy_until=$6 WHERE id=$1 RETURNING *) SELECT * FROM saved',
      [
        row.id,
        JSON.stringify(row.state),
        row.revision,
        row.submitted_at,
        row.operation_id,
        row.busy_until,
      ],
    );
    return this.owned(saved.id, saved.user_id, manager);
  }
  async edit(
    id: string,
    userId: string,
    revision: number,
    action: 'save' | 'apply' | 'undo',
    files?: unknown,
    messageId?: string,
  ) {
    return this.db.transaction(async (manager) => {
      const row = await this.owned(id, userId, manager, true);
      this.assertRevision(row, revision);
      let next: ProjectFiles;
      if (action === 'save') next = validateFiles(files);
      else if (action === 'undo') {
        if (!row.state.undo)
          throw new ConflictException('되돌릴 변경이 없습니다.');
        next = row.state.undo;
      } else {
        const proposal = row.state.messages.find(
          (m) => m.id === messageId && m.role === 'assistant' && !m.failed,
        );
        if (!proposal?.files || !Object.keys(proposal.files).length)
          throw new BadRequestException('적용할 변경안이 없습니다.');
        if (proposal.baseRevision !== row.revision)
          throw new ConflictException(
            '답변을 받은 뒤 코드가 바뀌었습니다. 최신 코드로 다시 질문해 주세요.',
          );
        next = { ...row.state.files, ...validateFiles(proposal.files, true) };
      }
      const paths = Object.keys(next).filter(
        (path) => next[path] !== row.state.files[path],
      );
      if (!paths.length) return this.view(row);
      row.state.undo = action === 'undo' ? null : row.state.files;
      row.state.files = next;
      row.revision++;
      this.event(row, action, { paths, ...(messageId ? { messageId } : {}) });
      await this.snapshot(manager, row, action, paths, messageId);
      return this.view(await this.persist(manager, row));
    });
  }

  private async operation(
    id: string,
    userId: string,
    revision: number,
    kind: 'chat' | 'run' | 'submit' | 'evaluate',
  ) {
    return this.db.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe-operations', 0))",
      );
      const row = await this.owned(id, userId, manager, true);
      this.assertRevision(
        row,
        revision,
        kind === 'evaluate',
        kind === 'submit' || kind === 'evaluate',
      );
      if (kind === 'evaluate' && !row.submitted_at)
        throw new ConflictException('먼저 저장본을 제출해 주세요.');
      if (
        (kind === 'chat' && row.state.aiRequests >= VIBE_LIMITS.aiRequests) ||
        (kind === 'run' && row.state.runs.length >= VIBE_LIMITS.runs) ||
        (kind === 'evaluate' && row.state.evaluations >= 3)
      )
        throw new BadRequestException(
          '이 연습의 요청 한도를 모두 사용했습니다.',
        );
      const [{ count }]: { count: number }[] = await manager.query(
        'SELECT count(*)::int AS count FROM vibe_attempts WHERE busy_until>now()',
      );
      if (count >= 2)
        throw new HttpException(
          '현재 연습 작업이 많습니다. 잠시 뒤 다시 시도해 주세요.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      if (kind === 'chat') row.state.aiRequests++;
      if (kind === 'evaluate' || kind === 'submit') row.state.evaluations++;
      row.operation_id = randomUUID();
      row.busy_until = new Date(Date.now() + 180_000);
      return this.persist(manager, row);
    });
  }
  private async finish(row: VibeAttemptRow) {
    const saved: VibeAttemptRow[] = await this.db.query(
      'WITH saved AS (UPDATE vibe_attempts SET state=$2,submitted_at=$3,operation_id=NULL,busy_until=NULL WHERE id=$1 AND operation_id=$4 RETURNING *) SELECT * FROM saved',
      [row.id, JSON.stringify(row.state), row.submitted_at, row.operation_id],
    );
    if (!saved[0])
      throw new ConflictException(
        '작업이 만료되었습니다. 최신 기록을 다시 열어 주세요.',
      );
    return this.view(await this.owned(saved[0].id, saved[0].user_id));
  }
  private async release(row: VibeAttemptRow) {
    await this.db.query(
      'UPDATE vibe_attempts SET operation_id=NULL,busy_until=NULL WHERE id=$1 AND operation_id=$2',
      [row.id, row.operation_id],
    );
  }

  async chat(id: string, userId: string, revision: number, prompt: string) {
    if (!prompt.trim()) throw new BadRequestException('질문을 입력해 주세요.');
    if (!this.ai.available)
      throw new HttpException(
        '대화 기능이 아직 준비되지 않았습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    const row = await this.operation(id, userId, revision, 'chat');
    row.state.messages.push({
      id: randomUUID(),
      role: 'user',
      text: prompt.trim(),
      baseRevision: revision,
      createdAt: new Date().toISOString(),
    });
    try {
      const reply = await this.ai.assist(row);
      row.state.messages.push({
        id: randomUUID(),
        role: 'assistant',
        ...reply,
        baseRevision: revision,
        createdAt: new Date().toISOString(),
      });
    } catch {
      row.state.messages.push({
        id: randomUUID(),
        role: 'assistant',
        text: '답변을 받지 못했습니다. 다시 질문해 주세요.',
        failed: true,
        baseRevision: revision,
        createdAt: new Date().toISOString(),
      });
    }
    return this.finish(row);
  }

  async run(
    id: string,
    userId: string,
    revision: number,
    final = false,
    reflection = '',
  ) {
    const row = await this.operation(
      id,
      userId,
      revision,
      final ? 'submit' : 'run',
    );
    try {
      const checks = await this.runner.run(row.state.files, final);
      if (row.enterprise_attempt_id && row.enterprise_closed) reflection = '';
      if (final) {
        const total = 11;
        const passed = checks.filter((c) => c.passed).length;
        const report: VibeReport = {
          outcome: Math.round((passed / total) * 40),
          passed,
          total,
          prompt: null,
          process: null,
          evaluationStatus: 'unavailable',
          model: row.model,
          reflection,
          checks,
        };
        this.event(row, 'submit');
        try {
          Object.assign(report, await this.ai.evaluate(row, reflection), {
            evaluationStatus: 'complete',
          });
        } catch {
          /* Execution scores remain available when AI evaluation is temporarily unavailable. */
        }
        row.state.report = report;
        row.submitted_at = new Date();
      } else {
        row.state.runs.push({
          id: randomUUID(),
          revision,
          createdAt: new Date().toISOString(),
          checks,
        });
        this.event(row, 'run');
      }
      return await this.finish(row);
    } catch (error) {
      await this.release(row);
      throw error;
    }
  }

  async evaluate(id: string, userId: string, revision: number) {
    const row = await this.operation(id, userId, revision, 'evaluate');
    try {
      if (!row.state.report)
        throw new BadRequestException('평가할 제출이 없습니다.');
      if (row.state.report.evaluationStatus === 'complete')
        return await this.finish(row);
      Object.assign(
        row.state.report,
        await this.ai.evaluate(row, row.state.report.reflection),
        { evaluationStatus: 'complete' },
      );
      return await this.finish(row);
    } catch {
      await this.release(row);
      throw new HttpException(
        '과정 평가를 완료하지 못했습니다. 결과물 점수는 보존되어 있습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
