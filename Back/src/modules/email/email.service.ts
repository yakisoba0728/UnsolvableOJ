import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { randomUUID, createHmac } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { newEmailToken, seal, tokenHash, unseal } from './email-crypto.js';

type Recipient = {
  id: string;
  email: string;
  email_verified_at: Date | null;
  deleted_at: Date | null;
  suspended_at: Date | null;
  token_version: number;
};
type Payload = { from: string; to: string[]; subject: string; text: string };
type Job = {
  id: string;
  user_id: string;
  kind: 'VERIFY' | 'ANSWER' | 'ACCEPTED';
  notification_id: string | null;
  encrypted_payload: string | null;
  consent_version: string | null;
  attempts: number;
  lease_id: string;
  expired: boolean;
  obsolete: boolean;
};

/** Only named, documented transient 409 errors may reuse a provider request. */
async function retryableConflict(response: Response) {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) return false;
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || !('name' in body)) return false;
    return (
      body.name === 'concurrent_idempotent_requests' ||
      body.name === 'resource_locked'
    );
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopping = false;
  private ticks = 0;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}
  get enabled() {
    return this.config.get<boolean>('EMAIL_ENABLED', false) === true;
  }
  private get secret() {
    return this.config.getOrThrow<string>('EMAIL_TOKEN_SECRET');
  }
  private get origin() {
    return this.config.getOrThrow<string>('EMAIL_APP_ORIGIN');
  }
  onModuleInit() {
    if (
      this.enabled &&
      this.config.get<boolean>('EMAIL_WORKER_ENABLED', true)
    ) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          /* No addresses, links or provider bodies in logs. Durable jobs retry. */
        });
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async active(
    m: EntityManager,
    user: AuthenticatedUser,
  ): Promise<Recipient> {
    const [row]: Recipient[] = await m.query(
      'SELECT id,email,email_verified_at,deleted_at,suspended_at,token_version FROM users WHERE id=$1 FOR UPDATE',
      [user.id],
    );
    if (
      !row ||
      row.deleted_at ||
      row.suspended_at ||
      ('tokenVersion' in user && row.token_version !== user.tokenVersion)
    )
      throw new UnauthorizedException('다시 로그인해 주세요.');
    if (user.sessionId) {
      const tokens = await m.query(
        'SELECT 1 FROM refresh_tokens WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1',
        [user.id, user.sessionId],
      );
      if (!tokens.length)
        throw new UnauthorizedException('다시 로그인해 주세요.');
    }
    return row;
  }
  private async prefs(m: EntityManager, row: Recipient) {
    const [prefs] = await m.query(
      'SELECT answer,accepted FROM email_preferences WHERE user_id=$1',
      [row.id],
    );
    return {
      verified: !!row.email_verified_at,
      answer: prefs?.answer ?? false,
      accepted: prefs?.accepted ?? false,
      enabled: this.enabled,
    };
  }
  preferences(user: AuthenticatedUser) {
    return this.db.transaction(async (m) =>
      this.prefs(m, await this.active(m, user)),
    );
  }
  updatePreferences(
    user: AuthenticatedUser,
    prefs: { answer: boolean; accepted: boolean },
  ) {
    return this.db.transaction(async (m) => {
      const row = await this.active(m, user);
      const previous = await this.prefs(m, row);
      const addsConsent =
        (prefs.answer && !previous.answer) ||
        (prefs.accepted && !previous.accepted);
      if (addsConsent && (!this.enabled || !row.email_verified_at))
        throw new BadRequestException(
          '메일 발송 설정과 이메일 인증을 먼저 완료해 주세요.',
        );
      await m.query(
        'INSERT INTO email_preferences(user_id,answer,accepted) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET answer=$2,accepted=$3,answer_version=CASE WHEN email_preferences.answer IS DISTINCT FROM $2 THEN email_preferences.answer_version+1 ELSE email_preferences.answer_version END,accepted_version=CASE WHEN email_preferences.accepted IS DISTINCT FROM $3 THEN email_preferences.accepted_version+1 ELSE email_preferences.accepted_version END',
        [user.id, prefs.answer, prefs.accepted],
      );
      await m.query(
        "UPDATE email_outbox SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND state='pending' AND ((kind='ANSWER' AND NOT $2) OR (kind='ACCEPTED' AND NOT $3))",
        [user.id, prefs.answer, prefs.accepted],
      );
      return this.prefs(m, row);
    });
  }
  requestVerification(user: AuthenticatedUser) {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        '이메일 발송이 아직 설정되지 않았습니다.',
      );
    return this.db.transaction(async (m) => {
      const row = await this.active(m, user);
      const message = {
        message: '인증 메일 요청을 처리했습니다. 수신함을 확인해 주세요.',
      };
      if (row.email_verified_at) return message;
      // HMAC key prevents cleartext recipient retention; this quota survives withdrawal/re-registration.
      const recipientKey = createHmac('sha256', this.secret)
        .update(row.email.toLowerCase())
        .digest('hex');
      await m.query(
        'INSERT INTO email_request_limits(recipient_key) VALUES($1) ON CONFLICT DO NOTHING',
        [recipientKey],
      );
      const [{ count, recent }]: {
        count: number;
        recent: boolean;
      }[] = await m.query(
        "SELECT (SELECT count(*)::int FROM unnest(request_times) requested_at WHERE requested_at>clock_timestamp()-interval '24 hours') AS count,coalesce(last_requested_at>clock_timestamp()-interval '60 seconds',false) AS recent FROM email_request_limits WHERE recipient_key=$1 FOR UPDATE",
        [recipientKey],
      );
      if (recent || count >= 5)
        throw new BadRequestException(
          '잠시 후 다시 요청해 주세요. 인증 메일은 하루 최대 5회입니다.',
        );
      await m.query(
        "UPDATE email_request_limits SET request_times=ARRAY(SELECT requested_at FROM unnest(request_times) requested_at WHERE requested_at>clock_timestamp()-interval '24 hours') || ARRAY[clock_timestamp()],last_requested_at=clock_timestamp() WHERE recipient_key=$1",
        [recipientKey],
      );
      await m.query(
        "UPDATE email_tokens SET used_at=clock_timestamp() WHERE user_id=$1 AND purpose='VERIFY' AND used_at IS NULL",
        [user.id],
      );
      await m.query(
        "UPDATE email_outbox SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND kind='VERIFY' AND state='pending'",
        [user.id],
      );
      const token = newEmailToken();
      await m.query(
        "INSERT INTO email_tokens(token_hash,user_id,purpose,email,expires_at) VALUES($1,$2,'VERIFY',$3,clock_timestamp()+interval '1 hour')",
        [tokenHash(token), user.id, row.email],
      );
      const payload: Payload = {
        from: this.config.getOrThrow<string>('EMAIL_FROM'),
        to: [row.email],
        subject: '못풀준 이메일 인증',
        text: `본인이 요청한 인증만 진행해 주세요. 한 시간 안에 같은 계정으로 로그인해 인증 버튼을 눌러 주세요.\n${this.origin}/email/verify#token=${token}`,
      };
      await m.query(
        "INSERT INTO email_outbox(user_id,kind,encrypted_payload) VALUES($1,'VERIFY',$2)",
        [user.id, seal(payload, this.secret)],
      );
      return message;
    });
  }
  confirm(user: AuthenticatedUser, token: string) {
    return this.db.transaction(async (m) => {
      const row = await this.active(m, user);
      const [valid] = await m.query(
        "SELECT 1 FROM email_tokens WHERE token_hash=$1 AND user_id=$2 AND email=$3 AND purpose='VERIFY' AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
        [tokenHash(token), user.id, row.email],
      );
      if (!valid)
        throw new BadRequestException(
          '만료되었거나 사용할 수 없는 인증 링크입니다.',
        );
      await m.query(
        'UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1',
        [user.id],
      );
      await m.query(
        "UPDATE email_tokens SET used_at=clock_timestamp() WHERE user_id=$1 AND purpose='VERIFY' AND used_at IS NULL",
        [user.id],
      );
      await m.query(
        "UPDATE email_outbox SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND kind='VERIFY' AND state='pending'",
        [user.id],
      );
      return { message: '이메일 인증을 완료했습니다.' };
    });
  }
  async unsubscribe(token: string) {
    const message = { message: '이메일 알림 수신 해제를 처리했습니다.' };
    const [owner] = await this.db.query(
      "SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose='UNSUBSCRIBE'",
      [tokenHash(token)],
    );
    if (!owner) return message;
    return this.db.transaction(async (m) => {
      const [row]: Recipient[] = await m.query(
        'SELECT id,email,deleted_at FROM users WHERE id=$1 FOR UPDATE',
        [owner.user_id],
      );
      if (!row || row.deleted_at) return message;
      const [valid] = await m.query(
        "SELECT 1 FROM email_tokens WHERE token_hash=$1 AND email=$2 AND purpose='UNSUBSCRIBE' AND expires_at>clock_timestamp()",
        [tokenHash(token), row.email],
      );
      if (!valid) return message;
      await m.query(
        'INSERT INTO email_preferences(user_id,answer,accepted) VALUES($1,false,false) ON CONFLICT(user_id) DO UPDATE SET answer=false,accepted=false,answer_version=CASE WHEN email_preferences.answer THEN email_preferences.answer_version+1 ELSE email_preferences.answer_version END,accepted_version=CASE WHEN email_preferences.accepted THEN email_preferences.accepted_version+1 ELSE email_preferences.accepted_version END',
        [row.id],
      );
      await m.query(
        "UPDATE email_outbox SET state='cancelled',encrypted_payload=NULL WHERE user_id=$1 AND state='pending' AND kind IN ('ANSWER','ACCEPTED')",
        [row.id],
      );
      return message;
    });
  }

  /** One leased durable job per tick, across API processes. No production mail without explicit config. */
  async tick() {
    if (this.busy || !this.enabled || this.stopping) return;
    this.busy = true;
    try {
      if (++this.ticks % 720 === 1) {
        // Retain verification rows through the rolling daily rate limit, then remove addresses.
        await this.db.query(
          "DELETE FROM email_request_limits WHERE last_requested_at<clock_timestamp()-interval '48 hours'",
        );
        await this.db.query(
          "DELETE FROM email_tokens WHERE token_hash IN (SELECT token_hash FROM email_tokens WHERE expires_at<clock_timestamp()-interval '24 hours' LIMIT 1000)",
        );
        await this.db.query(
          "DELETE FROM email_outbox WHERE id IN (SELECT id FROM email_outbox WHERE state<>'pending' AND created_at<clock_timestamp()-interval '30 days' LIMIT 1000)",
        );
      }
      // Commit the first-attempt clock before external I/O. A process crash cannot reset the provider dedupe window.
      const lease = randomUUID();
      const [jobs]: [Job[], number] = await this.db.query(
        `UPDATE email_outbox SET lease_id=$1,lease_until=clock_timestamp()+interval '60 seconds',
        first_attempt_at=coalesce(first_attempt_at,clock_timestamp()) WHERE id=(SELECT id FROM email_outbox
        WHERE state='pending' AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
        ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1) AND state='pending' RETURNING *`,
        [lease],
      );
      if (!jobs[0]) return;
      await this.prepare(jobs[0].user_id, jobs[0].id, lease);
      await this.deliver(jobs[0].user_id, jobs[0].id, lease);
    } finally {
      this.busy = false;
    }
  }
  // Commit the exact provider body before external I/O so crashes cannot regenerate a different unsubscribe link.
  private async prepare(userId: string, id: string, lease: string) {
    await this.db.transaction(async (m) => {
      const [user]: Recipient[] = await m.query(
        'SELECT id,email,email_verified_at,deleted_at,suspended_at FROM users WHERE id=$1 FOR UPDATE',
        [userId],
      );
      if (!user || user.deleted_at || user.suspended_at) return;
      const [job]: Job[] = await m.query(
        "SELECT * FROM email_outbox WHERE id=$1 AND lease_id=$2 AND state='pending' FOR UPDATE",
        [id, lease],
      );
      if (!job || job.encrypted_payload || job.kind === 'VERIFY') return;
      const [source] = await m.query(
        'SELECT post_id FROM notifications WHERE id=$1 AND user_id=$2',
        [job.notification_id, userId],
      );
      if (!source) return;
      const token = newEmailToken();
      await m.query(
        "INSERT INTO email_tokens(token_hash,user_id,purpose,email,expires_at) VALUES($1,$2,'UNSUBSCRIBE',$3,clock_timestamp()+interval '365 days')",
        [tokenHash(token), userId, user.email],
      );
      const payload: Payload = {
        from: this.config.getOrThrow<string>('EMAIL_FROM'),
        to: [user.email],
        subject:
          job.kind === 'ANSWER'
            ? '못풀준 새 답변 알림'
            : '못풀준 답변 채택 알림',
        text: `${job.kind === 'ANSWER' ? '작성한 글에 새 답변이 달렸습니다.' : '작성한 답변이 채택됐습니다.'}\n${this.origin}/community/${source.post_id}\n\n이메일 알림 수신 해제:\n${this.origin}/email/unsubscribe#token=${token}`,
      };
      await m.query(
        'UPDATE email_outbox SET encrypted_payload=$2 WHERE id=$1',
        [id, seal(payload, this.secret)],
      );
    });
  }
  private async deliver(userId: string, id: string, lease: string) {
    await this.db.transaction(async (m) => {
      const [user]: Recipient[] = await m.query(
        'SELECT id,email,email_verified_at,deleted_at,suspended_at FROM users WHERE id=$1 FOR UPDATE',
        [userId],
      );
      const [job]: Job[] = await m.query(
        `SELECT *,first_attempt_at<clock_timestamp()-interval '23 hours' AS expired,
        created_at<clock_timestamp()-interval '23 hours' AS obsolete FROM email_outbox WHERE id=$1 AND lease_id=$2 AND state='pending' FOR UPDATE`,
        [id, lease],
      );
      if (!job) return;
      const terminal = async (state: string, reason: string) =>
        m.query(
          'UPDATE email_outbox SET state=$2,encrypted_payload=NULL,lease_until=NULL,last_error=$3 WHERE id=$1',
          [id, state, reason],
        );
      if (!user || user.deleted_at || user.suspended_at) {
        await terminal('cancelled', 'inactive');
        return;
      }
      if (job.expired || job.obsolete || job.attempts >= 8) {
        await terminal('dead', 'expired');
        return;
      }

      if (job.kind === 'VERIFY') {
        const valid = await m.query(
          "SELECT 1 FROM email_tokens WHERE user_id=$1 AND purpose='VERIFY' AND email=$2 AND used_at IS NULL AND expires_at>clock_timestamp()",
          [userId, user.email],
        );
        if (user.email_verified_at || !valid.length) {
          await terminal('cancelled', 'verification_expired');
          return;
        }
      } else {
        const [source] = await m.query(
          `SELECT n.post_id FROM notifications n JOIN email_preferences e ON e.user_id=n.user_id
          JOIN community_posts p ON p.id=n.post_id JOIN community_comments c ON c.id=n.comment_id
          WHERE n.id=$1 AND n.user_id=$2 AND n.type=$3 AND n.actor_id IS DISTINCT FROM n.user_id
            AND CASE n.type WHEN 'ANSWER' THEN e.answer_version ELSE e.accepted_version END=$4 AND p.hidden_at IS NULL AND c.hidden_at IS NULL AND c.post_id=p.id
            AND CASE n.type WHEN 'ANSWER' THEN e.answer ELSE e.accepted AND p.accepted_comment_id=c.id END`,
          [job.notification_id, userId, job.kind, job.consent_version],
        );
        if (!user.email_verified_at || !source) {
          await terminal('cancelled', 'not_eligible');
          return;
        }

        const [{ count }] = await m.query(
          "SELECT count(*)::int AS count FROM email_outbox WHERE user_id=$1 AND sent_at>clock_timestamp()-interval '1 hour'",
          [userId],
        );
        if (count >= 10) {
          await m.query(
            "UPDATE email_outbox SET lease_until=NULL,next_attempt_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",
            [id],
          );
          return;
        }
      }
      // Serialize provider requests, including across instances, and cap rate to one/second.
      const [{ locked }] = await m.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('email-provider',0)) AS locked",
      );
      if (!locked) {
        await m.query(
          "UPDATE email_outbox SET lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",
          [id],
        );
        return;
      }
      const [rate] = await m.query(
        "SELECT 1 FROM email_delivery_clock WHERE last_attempt_at>clock_timestamp()-interval '1 second'",
      );
      if (rate) {
        await m.query(
          "UPDATE email_outbox SET lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",
          [id],
        );
        return;
      }
      let payload: Payload;
      try {
        payload = unseal<Payload>(job.encrypted_payload!, this.secret);
      } catch {
        await terminal('dead', 'payload_unavailable');
        return;
      }
      if (payload.to.length !== 1 || payload.to[0] !== user.email) {
        await terminal('cancelled', 'address_changed');
        return;
      }
      await m.query(
        'UPDATE email_delivery_clock SET last_attempt_at=clock_timestamp()',
      );
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.getOrThrow<string>('EMAIL_API_KEY')}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `unsolvable/${id}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          // Acknowledge only syntactically valid provider receipts; never persist response bodies.
          const receipt = (await response.json()) as { id?: unknown };
          if (typeof receipt.id !== 'string' || !receipt.id)
            throw new Error('invalid_receipt');
          await m.query(
            "UPDATE email_outbox SET state='sent',sent_at=clock_timestamp(),encrypted_payload=NULL,lease_until=NULL,attempts=attempts+1,last_error=NULL WHERE id=$1",
            [id],
          );
        } else if (
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408 ||
          (response.status === 409 && (await retryableConflict(response)))
        ) {
          await this.retry(m, job, `http_${response.status}`);
        } else await terminal('dead', `http_${response.status}`);
      } catch {
        await this.retry(m, job, 'transport_unknown');
      }
    });
  }
  private async retry(m: EntityManager, job: Job, reason: string) {
    await m.query(
      "UPDATE email_outbox SET attempts=attempts+1,last_error=$2,lease_until=NULL,next_attempt_at=clock_timestamp()+($3*interval '1 second') WHERE id=$1",
      [job.id, reason, Math.min(3600, 30 * 2 ** job.attempts)],
    );
  }
}
