export type PracticeMode = 'copy' | 'recall';
export interface PracticeWord {
  id: string; word: string; prompt: string; source: string; fingerprint: string;
}
export interface PracticeTurn {
  id: string; entryId: string; round: number; started: boolean; hinted: boolean; interrupted: boolean;
  /** Absent in early 0.1.6 records; rotated whenever a page resumes this turn. */
  activationId?: string;
}
export interface PracticeAttempt {
  turnId: string; entryId: string; round: number; correct: boolean; hinted: boolean;
  assisted: boolean; interrupted: boolean; skipped: boolean; elapsedMs: number;
}
export interface PracticeSession {
  id: string; owner: string; epoch: string | null; mode: PracticeMode;
  words: PracticeWord[]; queue: PracticeTurn[]; attempts: PracticeAttempt[]; invalidated: number;
}
export interface PracticeRecord {
  schema: 1; revision: number; session: PracticeSession | null;
  receipts: Array<{ id: string; digest: string }>;
}
export interface PracticeSummary {
  total: number; answered: number; firstCorrect: number; hinted: number; assisted: number;
  interrupted: number; skipped: number; retries: number; retryCorrect: number; elapsedMs: number;
  needsWork: Array<{ id: string; word: string }>;
}
export interface PracticeView {
  scope: string; owner: string; label: string; revision: number; blocked: string | null;
  corrupt?: boolean;
  available: { copy: number; recall: number; excluded: number };
  session: null | {
    id: string; mode: PracticeMode; completed: boolean; invalidated: number;
    current: null | { turnId: string; activationId: string; round: number; prompt: string; source: string; word?: string; started: boolean; hinted: boolean; interrupted: boolean };
    last: null | { word: string; correct: boolean; skipped: boolean };
    summary: PracticeSummary;
  };
}
export type PracticeAction =
  | { kind: 'start'; mode: PracticeMode; replace: boolean; entryIds?: string[] }
  | { kind: 'answer'; turnId: string; answer: string; assisted: boolean; skipped: boolean; elapsedMs: number }
  | { kind: 'reveal'; turnId: string }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'clear' };
export interface PracticeCommand {
  type: 'PRACTICE_COMMAND'; requestId: string; scope: string; owner: string; revision: number; action: PracticeAction;
}
export type PracticeMessage = { type: 'PRACTICE_GET' } | PracticeCommand;
