export type ProjectFiles = Record<string, string>;
export interface Challenge {
  id: string;
  title: string;
  summary: string;
  stack: string;
  difficulty: string;
  durationMin: number;
  requirements: string[];
  rubric: { label: string; max: number; description: string }[];
}
export interface VibeMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  baseRevision: number;
  files?: ProjectFiles;
  failed?: boolean;
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
  evaluationStatus: "complete" | "unavailable";
  reflection: string;
  checks: VibeCheck[];
}
export interface VibeEvent {
  id: string;
  type: "save" | "apply" | "undo" | "run" | "submit";
  createdAt: string;
  revision: number;
  paths?: string[];
  messageId?: string;
}
export interface VibeSummary {
  id: string;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  report: VibeReport | null;
}
export interface VibeAttempt {
  id: string;
  challenge: Challenge;
  revision: number;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  busyUntil: string | null;
  files: ProjectFiles;
  editablePaths: string[];
  messages: VibeMessage[];
  events: VibeEvent[];
  runs: VibeRun[];
  report: VibeReport | null;
  canUndo: boolean;
  remainingAiRequests: number;
  remainingRuns: number;
  availability: { ai: boolean; runner: boolean };
  limits: {
    aiRequests: number;
    runs: number;
    dailyAttempts: number;
    fileBytes: number;
    minutes: number;
  };
}
export interface VibeCatalog {
  items: Challenge[];
  availability: { ai: boolean; runner: boolean };
}
