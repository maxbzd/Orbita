import type { ZodType } from 'zod';
import { BadResponseError } from './errors';

/**
 * Everything a model says is untrusted text. This module turns it into data without ever executing or
 * interpreting it: fences and chatter around the JSON are cut away, small syntax slips are repaired,
 * a truncated answer is closed at the last complete element, and the result is validated with zod.
 * Strings stay strings (`<script>` in a title is just 8 characters); nothing here uses `eval`.
 */

// ───────── Limits ─────────

export const LIMITS = {
  /** Longest string kept from a model answer; longer ones are cut with an ellipsis. */
  maxString: 8_000,
  /** Longest array kept (extras are dropped). */
  maxArray: 300,
  /** Deepest nesting kept (deeper structure is replaced by null). */
  maxDepth: 12,
  /** Longer answers are not scanned at all. */
  maxInput: 2_000_000,
  /** JSON blocks collected from one answer. */
  maxCandidates: 12,
  /** Opening brackets tried per answer (keeps pathological input linear enough). */
  maxScans: 64,
  /** Deepest bracket nesting scanned: a real answer never comes close, garbage like "{{{{…" is abandoned early. */
  maxNesting: 64,
} as const;

// ───────── Scanning ─────────

const OPENERS = '{[';
const CLOSER_OF: Record<string, string> = { '{': '}', '[': ']' };

/** Removes the BOM and reasoning blocks some models print before the answer. */
function stripNoise(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .trim();
}

/** Bodies of ```fenced``` blocks, including a last one whose closing fence is missing (truncated answer). */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  for (const match of text.matchAll(fence)) {
    const body = match[1].trim();
    if (body !== '') blocks.push(body);
  }
  return blocks;
}

type BlockScan = { kind: 'balanced'; end: number } | { kind: 'unterminated' } | { kind: 'mismatch' };

/** How the bracket at `start` ends: closed properly, never closed (truncated text), or closed by the wrong bracket. */
function scanBlock(text: string, start: number): BlockScan {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (OPENERS.includes(char)) {
      stack.push(CLOSER_OF[char]);
      if (stack.length > LIMITS.maxNesting) return { kind: 'mismatch' };
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return { kind: 'mismatch' };
      if (stack.length === 0) return { kind: 'balanced', end: i };
    }
  }
  return { kind: 'unterminated' };
}

function nextOpener(text: string, from: number): number {
  for (let i = from; i < text.length; i++) if (OPENERS.includes(text[i])) return i;
  return -1;
}

// ───────── Repair ─────────

const BARE_LITERALS: Record<string, string> = { None: 'null', True: 'true', False: 'false', NaN: 'null', undefined: 'null' };
const BARE_TOKEN = /[A-Za-z0-9+\-.]+/y;

function nextNonSpace(text: string, from: number): string | undefined {
  for (let i = from; i < text.length; i++) if (!/\s/.test(text[i])) return text[i];
  return undefined;
}

export interface Repaired {
  text: string;
  fixes: string[];
}

/**
 * Fixes the slips models actually make: raw line breaks inside strings, trailing commas, a missing comma
 * between two values, Python-style literals. Works token by token outside strings, so string contents
 * are never touched (except escaping control characters).
 */
export function repairJsonText(input: string): Repaired {
  const fixes = new Set<string>();
  let out = '';
  let inString = false;
  /** True right after a complete value: another value starting here means a comma is missing. */
  let afterValue = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (char === '\\') {
        out += char + (input[i + 1] ?? '');
        i++;
      } else if (char === '"') {
        inString = false;
        afterValue = true;
        out += char;
      } else if (char === '\n') {
        fixes.add('escaped line breaks inside strings');
        out += '\\n';
      } else if (char === '\r') {
        fixes.add('escaped line breaks inside strings');
        out += '\\r';
      } else if (char === '\t') {
        fixes.add('escaped line breaks inside strings');
        out += '\\t';
      } else if (char < ' ') {
        out += ' ';
      } else {
        out += char;
      }
      continue;
    }

    if (/\s/.test(char)) {
      out += char;
      continue;
    }
    if (char === '"') {
      if (afterValue) {
        fixes.add('inserted missing commas');
        out = `${out.trimEnd()},${out.slice(out.trimEnd().length)}`;
      }
      inString = true;
      afterValue = false;
      out += char;
    } else if (char === ',') {
      // A comma right before a closing bracket is a trailing comma.
      const next = nextNonSpace(input, i + 1);
      if (next === '}' || next === ']') fixes.add('removed trailing commas');
      else out += char;
      afterValue = false;
    } else if (char === '{' || char === '[') {
      if (afterValue) {
        fixes.add('inserted missing commas');
        out = `${out.trimEnd()},${out.slice(out.trimEnd().length)}`;
      }
      out += char;
      afterValue = false;
    } else if (char === '}' || char === ']') {
      out += char;
      afterValue = true;
    } else if (char === ':') {
      out += char;
      afterValue = false;
    } else {
      BARE_TOKEN.lastIndex = i;
      const token = BARE_TOKEN.exec(input)?.[0];
      if (token === undefined) {
        out += char;
        continue;
      }
      if (afterValue) {
        fixes.add('inserted missing commas');
        out = `${out.trimEnd()},${out.slice(out.trimEnd().length)}`;
      }
      const literal = BARE_LITERALS[token];
      if (literal !== undefined) fixes.add('replaced non-JSON literals');
      out += literal ?? token;
      i += token.length - 1;
      afterValue = true;
    }
  }
  return { text: out, fixes: [...fixes] };
}

interface OpenContainer {
  closer: string;
  /** Index of the opening bracket in the text. */
  at: number;
}

/**
 * For an answer cut off by the token limit: drops the element that was being written (the last
 * incomplete array item or object property) and closes everything still open. Returns null when the
 * text is not truncated (every bracket closed) or cannot be mended.
 */
export function closeTruncatedJson(text: string): string | null {
  const open: OpenContainer[] = [];
  /** Commas outside strings with the number of containers open at that moment. */
  const commas: { index: number; depth: number }[] = [];
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (OPENERS.includes(char)) {
      open.push({ closer: CLOSER_OF[char], at: i });
      if (open.length > LIMITS.maxNesting) return null;
    } else if (char === '}' || char === ']') {
      if (open.pop()?.closer !== char) return null;
    } else if (char === ',') commas.push({ index: i, depth: open.length });
  }
  if (open.length === 0) return null;

  // Prefer cutting inside the innermost open array: its items are the repeated, droppable elements.
  let target = open.length;
  for (let level = open.length; level >= 1; level--) {
    if (open[level - 1].closer === ']') {
      target = level;
      break;
    }
  }
  const container = open[target - 1];
  const lastComma = [...commas].reverse().find((comma) => comma.depth === target && comma.index > container.at);
  const kept = lastComma ? text.slice(0, lastComma.index) : text.slice(0, container.at + 1);
  const closers = open
    .slice(0, target)
    .map((entry) => entry.closer)
    .reverse()
    .join('');
  return kept + closers;
}

// ───────── Parsing ─────────

export interface JsonCandidate {
  value: unknown;
  /** Human-readable list of what had to be fixed; empty for clean JSON. */
  fixes: string[];
}

function tryParse(text: string): JsonCandidate | undefined {
  try {
    return { value: JSON.parse(text) as unknown, fixes: [] };
  } catch {
    // fall through to the repaired variant
  }
  const repaired = repairJsonText(text);
  try {
    return { value: JSON.parse(repaired.text) as unknown, fixes: repaired.fixes };
  } catch {
    return undefined;
  }
}

const isContainer = (value: unknown): boolean => typeof value === 'object' && value !== null;
/** A container with something in it: closing a truncated answer down to `{}` or `[]` recovers nothing. */
const hasContent = (value: unknown): boolean => isContainer(value) && Object.keys(value as object).length > 0;

/**
 * JSON values found in one piece of text, in order of appearance. A top-level block that never closes
 * (the answer hit the token limit) is closed at its last complete element; text before it that merely
 * looks like a bracket (prose with a stray "{") is skipped.
 */
function scanCandidates(source: string): JsonCandidate[] {
  const found: JsonCandidate[] = [];
  let from = 0;
  for (let scans = 0; found.length < LIMITS.maxCandidates && scans < LIMITS.maxScans; scans++) {
    const start = nextOpener(source, from);
    if (start === -1) break;
    const scan = scanBlock(source, start);
    if (scan.kind === 'balanced') {
      const parsed = tryParse(source.slice(start, scan.end + 1));
      if (parsed && isContainer(parsed.value)) found.push(parsed);
      from = scan.end + 1;
      continue;
    }
    if (scan.kind === 'unterminated') {
      const closed = closeTruncatedJson(source.slice(start));
      const parsed = closed === null ? undefined : tryParse(closed);
      if (parsed && hasContent(parsed.value)) {
        found.push({ value: parsed.value, fixes: [...parsed.fixes, 'closed a truncated answer'] });
        break;
      }
    }
    from = start + 1;
  }
  return found;
}

/** Every JSON value found in an answer: clean text first, then fenced blocks, then blocks inside the text. */
export function jsonCandidates(raw: string): JsonCandidate[] {
  if (raw.length > LIMITS.maxInput) return [];
  const text = stripNoise(raw);
  if (text === '') return [];

  const whole = tryParse(text);
  if (whole && isContainer(whole.value) && whole.fixes.length === 0) return [whole];

  for (const source of [...fencedBlocks(text), text.replace(/```[a-zA-Z0-9_-]*/g, '')]) {
    const found = scanCandidates(source);
    if (found.length > 0) return found;
  }
  return [];
}

/** First JSON object or array found in the answer. */
export function parseJsonLoose(raw: string): JsonCandidate | undefined {
  return jsonCandidates(raw)[0];
}

// ───────── Sanitizing ─────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanString(value: string, maxString: number): string {
  const cleaned = value.replace(CONTROL_CHARS, '');
  const chars = Array.from(cleaned);
  return chars.length <= maxString ? cleaned : `${chars.slice(0, maxString - 1).join('').trimEnd()}…`;
}

export interface SanitizeOptions {
  maxString?: number;
  maxArray?: number;
  maxDepth?: number;
}

/**
 * Bounds an untrusted value: strings are cut and stripped of control characters, arrays shortened,
 * nesting limited, keys that could poison prototypes dropped. Pure data in, pure data out.
 */
export function sanitizeValue(value: unknown, options: SanitizeOptions = {}, depth = 0): unknown {
  const { maxString = LIMITS.maxString, maxArray = LIMITS.maxArray, maxDepth = LIMITS.maxDepth } = options;
  if (typeof value === 'string') return cleanString(value, maxString);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= maxDepth) return null;
  if (Array.isArray(value)) return value.slice(0, maxArray).map((entry) => sanitizeValue(entry, options, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!FORBIDDEN_KEYS.has(key)) result[cleanString(key, 200)] = sanitizeValue(entry, options, depth + 1);
  }
  return result;
}

// ───────── Validation ─────────

export type ParseOutcome<T> = { ok: true; data: T; fixes: string[] } | { ok: false; problem: string };

function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const shown = issues.slice(0, 8).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  const extra = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : '';
  return `${shown.join('; ')}${extra}`;
}

/** Validates an already-parsed value (e.g. the `input` of a tool call). */
export function validateValue<T>(value: unknown, schema: ZodType<T>, fixes: string[] = []): ParseOutcome<T> {
  const result = schema.safeParse(sanitizeValue(value));
  if (result.success) return { ok: true, data: result.data, fixes };
  return { ok: false, problem: describeIssues(result.error.issues) };
}

/**
 * Parses an answer and validates it. The first JSON block that satisfies the schema wins; if none does,
 * the problem of the first parseable block is reported, so that the repair request can name it.
 */
export function parseModelText<T>(raw: string, schema: ZodType<T>): ParseOutcome<T> {
  if (raw.trim() === '') return { ok: false, problem: 'The answer is empty' };
  const candidates = jsonCandidates(raw);
  if (candidates.length === 0) return { ok: false, problem: 'The answer contains no JSON object' };
  let firstProblem: string | undefined;
  for (const candidate of candidates) {
    const outcome = validateValue(candidate.value, schema, candidate.fixes);
    if (outcome.ok) return outcome;
    firstProblem ??= outcome.problem;
  }
  return { ok: false, problem: firstProblem ?? 'The answer does not match the schema' };
}

// ───────── One automatic repair ─────────

export interface TokenCount {
  inputTokens: number;
  outputTokens: number;
}

/** One model answer: either free text (to be parsed) or an already structured value (tool call input). */
export interface RawReply extends TokenCount {
  text?: string;
  value?: unknown;
  /** The model stopped because of the output limit. */
  truncated?: boolean;
}

export interface RepairContext {
  previous: string;
  problem: string;
}

const MAX_PREVIOUS_IN_REPAIR = 6_000;

/** The user message of the repair request: the original task plus what went wrong. */
export function buildRepairUser(original: string, context: RepairContext): string {
  const previous =
    context.previous.length > MAX_PREVIOUS_IN_REPAIR ? `${context.previous.slice(0, MAX_PREVIOUS_IN_REPAIR)}…` : context.previous;
  return [
    original,
    '',
    '---',
    'Your previous answer was rejected.',
    `Problem: ${context.problem}`,
    'Previous answer:',
    previous === '' ? '(empty)' : previous,
    '',
    'Return the corrected answer: one complete JSON object that matches the schema exactly. No prose, no code fences.',
  ].join('\n');
}

function interpret<T>(reply: RawReply, schema: ZodType<T>): ParseOutcome<T> {
  if (reply.value !== undefined) return validateValue(reply.value, schema);
  const outcome = parseModelText(reply.text ?? '', schema);
  if (!outcome.ok && reply.truncated) {
    return { ok: false, problem: `${outcome.problem} (the answer was cut off by the output token limit)` };
  }
  return outcome;
}

function describePrevious(reply: RawReply): string {
  if (reply.value !== undefined) return JSON.stringify(reply.value) ?? '';
  return reply.text ?? '';
}

export interface StructuredRun<T> extends TokenCount {
  data: T;
  repaired: boolean;
}

/**
 * Calls the model, validates the answer and — exactly once — asks for a corrected answer when it is
 * unusable. `call` receives the repair context on the second call. A second failure is a
 * `BadResponseError`; the caller marks the capture failed with a "повторить" button.
 */
export async function runStructured<T>(
  schema: ZodType<T>,
  call: (repair?: RepairContext) => Promise<RawReply>,
): Promise<StructuredRun<T>> {
  const first = await call();
  const firstOutcome = interpret(first, schema);
  if (firstOutcome.ok) {
    return { data: firstOutcome.data, inputTokens: first.inputTokens, outputTokens: first.outputTokens, repaired: false };
  }

  const second = await call({ previous: describePrevious(first), problem: firstOutcome.problem });
  const secondOutcome = interpret(second, schema);
  const totals = {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
  };
  if (secondOutcome.ok) return { data: secondOutcome.data, ...totals, repaired: true };
  throw new BadResponseError(secondOutcome.problem);
}
