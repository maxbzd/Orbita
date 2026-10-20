import type {
  CaptureContext,
  CaptureKind,
  CaptureSource,
  CheckInOrigin,
  CommitmentDirection,
  DecisionRating,
  IdeaStage,
  ItemStatus,
  PatternKind,
  PatternStatus,
  PersonRole,
  PredictionOutcome,
  ProcessStatus,
  ProjectKind,
  ProjectStatus,
  TaskPriority,
} from '../../domain/types';
import type { Moment } from './time';

/**
 * Authoring format of the demo content. Everything is written in "days ago / days ahead" terms and
 * refers to other pieces by short keys; `build.ts` turns the specs into real records.
 */

export type PersonKey = 'nina' | 'omar' | 'greg' | 'hana' | 'marcus' | 'ben' | 'priya' | 'theo' | 'maya' | 'mom' | 'sam' | 'dana';

export type ProjectKey = 'app' | 'studio' | 'news' | 'team' | 'run';

export interface PersonSpec {
  key: PersonKey;
  name: string;
  aliases: string[];
  role: PersonRole;
  notes: string;
  /** −1..1 */
  mood: number;
}

export interface ProjectSpec {
  key: ProjectKey;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description: string;
  keywords: string[];
  color: string;
  /** Days ago the project was created. */
  startedD: number;
}

export interface CaptureSpec {
  key: string;
  kind: CaptureKind;
  at: Moment;
  context?: CaptureContext;
  title: string;
  summary: string;
  text: string;
  people?: PersonKey[];
  projects?: ProjectKey[];
  tags?: string[];
  /** Defaults to `done`. */
  status?: ProcessStatus;
  pinned?: boolean;
  source?: CaptureSource;
  /** A `text` capture that was dictated rather than typed: it gets a duration. */
  dictated?: boolean;
}

// ───────── Items ─────────

/** Fields every item spec shares. */
export interface ItemSpecBase {
  /** Stable key: the id of the record is derived from it. */
  key: string;
  /** Source capture; the item is created a couple of minutes after it. */
  cap?: string;
  /** Verbatim substring of the capture text. */
  quote?: string;
  title: string;
  body?: string;
  people?: PersonKey[];
  projects?: ProjectKey[];
  tags?: string[];
  /** Defaults to `active`. */
  status?: ItemStatus;
  confidence?: number;
  /** Deadline / review / resolution date, in days from today (negative = in the past). */
  due?: number;
  /** Days ago the item was closed (done, dropped); needed with `done`. */
  closed?: number;
  /** Creation time for items without a source capture. */
  at?: Moment;
  /** Key of an item this one possibly duplicates. */
  duplicateOf?: string;
}

export interface DecisionSpec extends ItemSpecBase {
  kind: 'decision';
  question?: string;
  chosen: string;
  alternatives: string[];
  reasons: string[];
  expected?: string;
  outcome?: { rating: DecisionRating; note: string; ago: number };
}

export interface CommitmentSpec extends ItemSpecBase {
  kind: 'commitment';
  direction: CommitmentDirection;
  /** The person, when they exist in the demo set. */
  who?: PersonKey;
  /** Free-form name when there is no person yet. */
  whoName?: string;
}

export interface IdeaSpec extends ItemSpecBase {
  kind: 'idea';
  stage: IdeaStage;
  /** Keys of related ideas. */
  related?: string[];
}

export interface PredictionSpec extends ItemSpecBase {
  kind: 'prediction';
  probability: number;
  outcome?: PredictionOutcome;
  note?: string;
}

export interface TaskSpec extends ItemSpecBase {
  kind: 'task';
  priority?: TaskPriority;
  /** Days from today. */
  scheduled?: number;
}

export interface QuestionSpec extends ItemSpecBase {
  kind: 'question';
  answer?: string;
}

export interface LessonSpec extends ItemSpecBase {
  kind: 'lesson';
}

export interface FactSpec extends ItemSpecBase {
  kind: 'fact';
  value?: string;
  /** Key of the fact that replaces this one. */
  supersededBy?: string;
}

export type ItemSpec =
  | DecisionSpec
  | CommitmentSpec
  | IdeaSpec
  | PredictionSpec
  | TaskSpec
  | QuestionSpec
  | LessonSpec
  | FactSpec;

// ───────── Check-ins, patterns, links ─────────

/** A check-in written next to a capture (a typed `checkin` note, or a state suggested from a voice note). */
export interface CheckInSpec {
  cap: string;
  /** Minutes after the capture. */
  after?: number;
  valence: number;
  energy: number;
  focus?: number;
  stress?: number;
  sleepHours?: number;
  tags: string[];
  note?: string;
  origin: CheckInOrigin;
}

export interface PatternSpec {
  key: string;
  title: string;
  description: string;
  kind: PatternKind;
  status: PatternStatus;
  confidence: number;
  suggestion?: string;
  /** Evidence quotes: capture key and a substring of its text. */
  evidence: { cap: string; quote: string }[];
  /** Days ago the pattern was first suggested. */
  foundD: number;
  /** Total observed occurrences, when more than the quoted ones. */
  occurrences?: number;
}

export interface LinkSpec {
  from: string;
  to: string;
  kind: 'related' | 'caused' | 'follows' | 'supersedes' | 'duplicate';
}

/** Which story beats shape the generated check-ins; days are "days ago". */
export interface StoryBeats {
  /** Days of pressure: tests, deadlines, difficult conversations. */
  deadlines: readonly number[];
  /** Days when something good happened (payment, new customer). */
  wins: readonly number[];
  /** Nights with too little sleep, as inclusive day ranges. */
  shortNights: readonly (readonly [from: number, to: number])[];
}
