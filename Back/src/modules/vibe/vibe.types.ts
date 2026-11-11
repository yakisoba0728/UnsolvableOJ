export type ProjectFiles = Record<string, string>;
export interface VibeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  baseRevision: number;
  files?: ProjectFiles;
  failed?: boolean;
}
export interface VibeEvent {
  id: string;
  type: 'save' | 'apply' | 'undo' | 'run' | 'submit';
  createdAt: string;
  revision: number;
  paths?: string[];
  messageId?: string;
}
export interface VibeCheck {
  name: string;
  passed: boolean;
  detail?: string;
}
export interface VibeRun {
  id: string;
  revision: number;
  createdAt: string;
  checks: VibeCheck[];
}
export interface ReviewSection {
  score: number;
  feedback: string;
  evidence: string[];
}
export interface VibeReport {
  outcome: number;
  passed: number;
  total: number;
  prompt: ReviewSection | null;
  process: ReviewSection | null;
  evaluationStatus: 'complete' | 'unavailable';
  model: string;
  reflection: string;
  checks: VibeCheck[];
}
export interface VibeState {
  files: ProjectFiles;
  messages: VibeMessage[];
  events: VibeEvent[];
  runs: VibeRun[];
  undo: ProjectFiles | null;
  report: VibeReport | null;
  aiRequests: number;
  evaluations: number;
}
export interface VibeAttemptRow {
  id: string;
  user_id: string;
  challenge_id: string;
  revision: number;
  state: VibeState;
  model: string;
  started_at: Date;
  deadline_at: Date;
  submitted_at: Date | null;
  operation_id: string | null;
  busy_until: Date | null;
}
