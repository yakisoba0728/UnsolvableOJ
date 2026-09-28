export const JUDGE_QUEUE = 'judge-submissions';

export interface JudgeSubmissionJob {
  submissionId: string;
  generation: number;
}
