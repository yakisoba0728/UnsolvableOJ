import { Redis, type RedisOptions } from 'ioredis';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { databaseConnectionOptions } from '../src/config/database.config.js';

export const multiApiBudgets = {
  actionMs: 45_000, processStopPhaseMs: 15_000, cleanupOperationsMs: 5000,
  connectionDrainMs: 1000, reportMs: 3000, existingTestMs: 90_000,
} as const;

/** A deadline guards operation factories, not just their returned promises.
 * Register connection owners before starting an asynchronous connect operation.
 * Every late resolution/rejection is consumed, and cannot start the next await.
 */
export class DeadlineScope {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly deadline: number;
  private readonly timer: NodeJS.Timeout;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly closers = new Set<() => void>();
  private readonly waiters = new Set<(reason: unknown) => void>();
  private readonly parentAbort: () => void;
  readonly closeFailures: string[] = [];

  constructor(milliseconds: number, private readonly label: string, private readonly parent?: AbortSignal) {
    this.deadline = performance.now() + milliseconds;
    this.timer = setTimeout(() => this.close(new Error(`${label} deadline exceeded`)), milliseconds);
    this.signal.addEventListener('abort', () => {
      for (const close of this.closers) close();
      this.closers.clear();
      for (const reject of this.waiters) reject(this.signal.reason);
      this.waiters.clear();
    }, { once: true });
    this.parentAbort = () => this.close(parent!.reason);
    if (parent?.aborted) this.parentAbort();
    else parent?.addEventListener('abort', this.parentAbort, { once: true });
  }

  remaining(maximum = Number.POSITIVE_INFINITY) {
    this.signal.throwIfAborted();
    const left = Math.floor(this.deadline - performance.now());
    if (left <= 0) {
      this.close(new Error(`${this.label} deadline exceeded`));
      this.signal.throwIfAborted();
    }
    return Math.min(maximum, left);
  }

  own(forceClose: () => void) {
    const close = () => {
      try { forceClose(); } catch (error) {
        this.closeFailures.push(error instanceof Error ? error.name : 'UnknownError');
      }
    };
    if (this.signal.aborted) close();
    else this.closers.add(close);
  }

  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.remaining();
    const pending = Promise.resolve().then(() => {
      this.remaining();
      return operation(this.signal);
    });
    this.pending.add(pending);
    return new Promise<T>((resolve, reject) => {
      this.waiters.add(reject);
      pending.then((value) => {
        this.pending.delete(pending);
        this.waiters.delete(reject);
        try { this.remaining(); resolve(value); } catch (error) { reject(error); }
      }, (error: unknown) => {
        this.pending.delete(pending);
        this.waiters.delete(reject);
        reject(error);
      });
    });
  }

  settled() { return Promise.allSettled(this.pending); }
  get pendingCount() { return this.pending.size; }

  close(reason: unknown = new Error(`${this.label} closed`)) {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.parentAbort);
    if (!this.signal.aborted) this.controller.abort(reason);
  }
}

interface PgClient {
  connect(): Promise<void>;
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  on(event: 'error', listener: () => void): void;
}

// pg is an existing direct dependency. Its installed package has no declaration
// files; describe only the public methods used by this disposable observer.
const { Client } = createRequire(import.meta.url)('pg') as {
  Client: new (options: Record<string, unknown>) => PgClient;
};

export function ownedPostgres(scope: DeadlineScope, url: string, ssl: boolean) {
  scope.remaining();
  const socket = new Socket();
  socket.on('error', () => {});
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  // Ownership exists before Client/connect can open a connection. Destroying
  // this supplied transport also terminates a TLS wrapper or pending startup.
  scope.own(() => { socket.destroy(new Error('Owned PostgreSQL observer closed')); });
  const options = databaseConnectionOptions(url, ssl);
  const client = new Client({ connectionString: options.url, ssl: options.ssl, stream: socket,
    connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 2000 });
  client.on('error', () => {}); // Errors are reported by the guarded operation.
  // Do not call Client.end() during startup: this installed pg version suppresses
  // its connect callback when _ending is set. Destroying with an error instead
  // closes the owned socket and settles both startup and active query promises.
  return {
    socket, closed,
    connect: () => scope.run(() => client.connect()),
    query: async <T = Record<string, unknown>>(sql: string, parameters?: unknown[]) =>
      (await scope.run(() => client.query<T>(sql, parameters))).rows,
  };
}

export function ownedRedis(scope: DeadlineScope, options: RedisOptions) {
  scope.remaining();
  const client = new Redis({ ...options, lazyConnect: true, enableOfflineQueue: false,
    connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 1, retryStrategy: () => null });
  const closed = new Promise<void>((resolve) => client.once('end', () => resolve()));
  client.on('error', () => {});
  // disconnect is synchronous, disables reconnection, and works even while
  // connect is pending. No late connect result can allocate a replacement.
  scope.own(() => { client.disconnect(false); });
  return { client, closed, connect: () => scope.run(() => client.connect()) };
}
