export const JUDGE_QUEUE = 'judge-submissions';
export const JUDGE_WORKERS_KEY = 'judge:workers';
// Workers heartbeat every 10 seconds.
export const JUDGE_WORKER_ONLINE_MS = 30_000;
export const JUDGE_WORKER_PRUNE_MS = 60_000;

export interface JudgeSubmissionJob {
  submissionId: string;
  generation: number;
}
