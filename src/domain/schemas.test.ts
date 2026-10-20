import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  captureSchema,
  checkInSchema,
  dayKeySchema,
  isoDateSchema,
  itemSchema,
  linkSchema,
  patternSchema,
  personSchema,
  presetSchema,
  profileSchema,
  projectSchema,
  reviewSchema,
  sealedDataSchema,
  settingsSchema,
  tombstoneSchema,
  usageRowSchema,
} from './schemas';
import { ITEM_KINDS } from './types';

const at = '2026-10-07T12:30:00.000Z';
const base = { id: 'id-1', createdAt: at, updatedAt: at };
const itemBase = { ...base, status: 'active', title: 'Заголовок', personIds: [], projectIds: [], tags: [] };

const validItems = {
  decision: { ...itemBase, kind: 'decision', chosen: 'Запускаю курс', alternatives: ['Ждать'], reasons: ['Есть спрос'] },
  commitment: { ...itemBase, kind: 'commitment', direction: 'i_owe', counterpartyName: 'Маша' },
  idea: { ...itemBase, kind: 'idea', stage: 'spark', relatedIds: [] },
  prediction: { ...itemBase, kind: 'prediction', probability: 0.7 },
  task: { ...itemBase, kind: 'task', priority: 'high', scheduledFor: '2026-10-08' },
  question: { ...itemBase, kind: 'question' },
  lesson: { ...itemBase, kind: 'lesson' },
  fact: { ...itemBase, kind: 'fact', value: '14 учеников' },
} as const;

describe('primitives', () => {
  it('accepts UTC ISO instants only', () => {
    expect(isoDateSchema.safeParse('2026-10-07T12:30:00.000Z').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-10-07T12:30:00Z').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-10-07T12:30:00+03:00').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-10-07').success).toBe(false);
    expect(isoDateSchema.safeParse('yesterday').success).toBe(false);
  });

  it('accepts real calendar days only', () => {
    expect(dayKeySchema.safeParse('2026-10-07').success).toBe(true);
    expect(dayKeySchema.safeParse('2028-02-29').success).toBe(true);
    expect(dayKeySchema.safeParse('2026-02-29').success).toBe(false);
    expect(dayKeySchema.safeParse('07.10.2026').success).toBe(false);
  });
});

describe('itemSchema', () => {
  it('has a valid example for every kind of the contract', () => {
    expect(Object.keys(validItems).sort()).toEqual([...ITEM_KINDS].sort());
    for (const [kind, item] of Object.entries(validItems)) {
      const result = itemSchema.safeParse(item);
      expect(result.success, kind).toBe(true);
      if (result.success) expect(result.data.kind).toBe(kind);
    }
  });

  it('rejects an unknown kind and a missing required kind-specific field', () => {
    expect(itemSchema.safeParse({ ...itemBase, kind: 'habit' }).success).toBe(false);
    const { chosen: _chosen, ...withoutChosen } = validItems.decision;
    expect(itemSchema.safeParse(withoutChosen).success).toBe(false);
    expect(itemSchema.safeParse({ ...validItems.commitment, direction: 'both' }).success).toBe(false);
  });

  it('enforces the title limit of 120 characters', () => {
    expect(itemSchema.safeParse({ ...validItems.lesson, title: 'я'.repeat(120) }).success).toBe(true);
    expect(itemSchema.safeParse({ ...validItems.lesson, title: 'я'.repeat(121) }).success).toBe(false);
    expect(itemSchema.safeParse({ ...validItems.lesson, title: '' }).success).toBe(false);
  });

  it('keeps prediction probability within [0.01, 0.99] (invariant 5)', () => {
    for (const probability of [0.01, 0.5, 0.99]) {
      expect(itemSchema.safeParse({ ...validItems.prediction, probability }).success, String(probability)).toBe(true);
    }
    for (const probability of [0, 0.005, 1, 1.2, -0.1]) {
      expect(itemSchema.safeParse({ ...validItems.prediction, probability }).success, String(probability)).toBe(false);
    }
  });

  it('validates decision outcome ratings 1..5', () => {
    const outcome = (rating: number) => ({ ...validItems.decision, outcome: { rating, note: 'ок', at } });
    expect(itemSchema.safeParse(outcome(3)).success).toBe(true);
    expect(itemSchema.safeParse(outcome(0)).success).toBe(false);
    expect(itemSchema.safeParse(outcome(6)).success).toBe(false);
    expect(itemSchema.safeParse(outcome(2.5)).success).toBe(false);
  });

  it('bounds confidence to 0..1 and rejects bad dates', () => {
    expect(itemSchema.safeParse({ ...validItems.lesson, confidence: 1.1 }).success).toBe(false);
    expect(itemSchema.safeParse({ ...validItems.lesson, dueAt: '12 октября' }).success).toBe(false);
  });

  it('converts to JSON Schema with one branch per kind (needed for structured AI output)', () => {
    const jsonSchema = z.toJSONSchema(itemSchema) as { oneOf?: unknown[]; anyOf?: unknown[] };
    expect((jsonSchema.oneOf ?? jsonSchema.anyOf)?.length).toBe(ITEM_KINDS.length);
  });
});

describe('entity schemas', () => {
  it('accepts a minimal capture and rejects a bad status or day', () => {
    const capture = { ...base, kind: 'voice', day: '2026-10-07', text: '', projectIds: [], personIds: [], tags: [], status: 'raw' };
    expect(captureSchema.safeParse(capture).success).toBe(true);
    expect(captureSchema.safeParse({ ...capture, status: 'pending' }).success).toBe(false);
    expect(captureSchema.safeParse({ ...capture, day: '2026-10-7' }).success).toBe(false);
    expect(captureSchema.safeParse({ ...capture, source: { importedFrom: 'chatgpt', app: 'ChatGPT' } }).success).toBe(true);
    expect(captureSchema.safeParse({ ...capture, source: { importedFrom: 'telegram' } }).success).toBe(false);
  });

  it('strips unknown keys', () => {
    const result = lessonParse({ ...validItems.lesson, hacker: '<script>' });
    expect(result).not.toHaveProperty('hacker');
  });

  it('validates people and projects', () => {
    const person = { ...base, name: 'Маша', aliases: ['Мария'], role: 'student', mentionCount: 0 };
    expect(personSchema.safeParse(person).success).toBe(true);
    expect(personSchema.safeParse({ ...person, role: 'enemy' }).success).toBe(false);
    expect(personSchema.safeParse({ ...person, name: '' }).success).toBe(false);
    expect(personSchema.safeParse({ ...person, relationMood: 1.5 }).success).toBe(false);
    expect(personSchema.safeParse({ ...person, mentionCount: -1 }).success).toBe(false);

    const project = { ...base, name: 'Школа', kind: 'business', status: 'active', keywords: [] };
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, status: 'archived' }).success).toBe(false);
  });

  it('validates check-ins with the contract ranges', () => {
    const checkIn = { ...base, at, day: '2026-10-07', valence: -0.4, energy: 0.6, tags: ['сон'], origin: 'manual' };
    expect(checkInSchema.safeParse(checkIn).success).toBe(true);
    expect(checkInSchema.safeParse({ ...checkIn, valence: -1.2 }).success).toBe(false);
    expect(checkInSchema.safeParse({ ...checkIn, energy: -0.1 }).success).toBe(false);
    expect(checkInSchema.safeParse({ ...checkIn, origin: 'auto' }).success).toBe(false);
  });

  it('validates patterns and reviews', () => {
    const pattern = {
      ...base,
      title: 'Откладываю звонки',
      description: 'Повторяется',
      kind: 'behavior',
      evidence: [{ captureId: 'c1', day: '2026-10-01', quote: 'потом позвоню' }],
      confidence: 0.7,
      status: 'candidate',
      firstSeenDay: '2026-10-01',
      lastSeenDay: '2026-10-07',
      occurrences: 3,
    };
    expect(patternSchema.safeParse(pattern).success).toBe(true);
    expect(patternSchema.safeParse({ ...pattern, confidence: 2 }).success).toBe(false);

    const review = {
      ...base,
      period: 'week',
      startDay: '2026-10-05',
      endDay: '2026-10-11',
      headline: 'Неделя',
      sections: [{ id: 's1', title: 'Итоги', kind: 'stats', body: '5 записей', data: { count: 5 } }],
      questions: ['Что получилось?'],
      generatedBy: 'rules',
    };
    expect(reviewSchema.safeParse(review).success).toBe(true);
    expect(reviewSchema.safeParse({ ...review, period: 'decade' }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, generatedBy: 'human' }).success).toBe(false);
  });

  it('validates the system rows', () => {
    expect(
      profileSchema.safeParse({ id: 'me', name: '', about: '', goals: '', values: '', talkStyle: '', glossary: [{ term: 'OKR' }], updatedAt: at })
        .success,
    ).toBe(true);
    expect(profileSchema.safeParse({ id: 'you', name: '', about: '', goals: '', values: '', talkStyle: '', glossary: [], updatedAt: at }).success).toBe(false);
    expect(
      usageRowSchema.safeParse({ id: 'u1', at, provider: 'anthropic', model: 'm', purpose: 'extract', inputTokens: 10, outputTokens: 5 }).success,
    ).toBe(true);
    expect(
      usageRowSchema.safeParse({ id: 'u1', at, provider: 'anthropic', model: 'm', purpose: 'chat', inputTokens: 10, outputTokens: 5 }).success,
    ).toBe(false);
    expect(
      presetSchema.safeParse({ id: 'p1', name: 'Утро', sections: ['projects'], windowDays: 7, personIds: [], projectIds: [], privacy: 'initials', maxTokens: 4000 })
        .success,
    ).toBe(true);
    expect(linkSchema.safeParse({ id: 'l1', from: 'a', to: 'b', kind: 'related', createdAt: at }).success).toBe(true);
    expect(linkSchema.safeParse({ id: 'l1', from: 'a', to: 'b', kind: 'friend', createdAt: at }).success).toBe(false);
    expect(tombstoneSchema.safeParse({ id: 'x', table: 'items', deletedAt: at }).success).toBe(true);
  });
});

describe('sealedDataSchema', () => {
  const sealed = { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: 600_000, salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' };

  it('accepts a well-formed payload', () => {
    expect(sealedDataSchema.safeParse(sealed).success).toBe(true);
  });

  it('refuses weak or absurd iteration counts', () => {
    expect(sealedDataSchema.safeParse({ ...sealed, iterations: 1000 }).success).toBe(false);
    expect(sealedDataSchema.safeParse({ ...sealed, iterations: 209_999 }).success).toBe(false);
    expect(sealedDataSchema.safeParse({ ...sealed, iterations: 210_000 }).success).toBe(true);
    expect(sealedDataSchema.safeParse({ ...sealed, iterations: 2_000_000_000 }).success).toBe(false);
  });
});

describe('settingsSchema', () => {
  it('turns nothing into complete defaults', () => {
    const defaults = settingsSchema.parse({});
    expect(defaults.id).toBe('settings');
    expect(defaults.ai.provider).toBe('anthropic');
    expect(defaults.ai.anthropic).toEqual({ apiKey: '', models: { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' } });
    expect(defaults.onboarding).toEqual({ done: false });
    expect(defaults.autoAccept).toEqual({ enabled: false, minConfidence: 0.85 });
    expect(defaults.capture).toEqual({ defaultContext: null, keepAudio: true, walkMode: true });
    expect(defaults.lock.enabled).toBe(false);
    expect(settingsSchema.parse(undefined)).toEqual(defaults);
  });

  it('never throws and falls back per field', () => {
    const defaults = settingsSchema.parse({});
    const parsed = settingsSchema.parse({
      ai: 'oops',
      theme: 5,
      lock: { enabled: 'yes', autoLockMinutes: 15 },
      capture: { defaultContext: 'walk', keepAudio: 'maybe' },
      autoAccept: { enabled: true, minConfidence: 7 },
      unknown: { a: 1 },
    });
    expect(parsed.ai).toEqual(defaults.ai);
    expect(parsed.theme).toBe(defaults.theme);
    expect(parsed.lock.enabled).toBe(false);
    expect(parsed.lock.autoLockMinutes).toBe(15);
    expect(parsed.capture).toEqual({ defaultContext: 'walk', keepAudio: true, walkMode: true });
    expect(parsed.autoAccept).toEqual({ enabled: true, minConfidence: defaults.autoAccept.minConfidence });
    expect(parsed).not.toHaveProperty('unknown');
  });

  it('keeps valid values', () => {
    const parsed = settingsSchema.parse({
      ai: { provider: 'openai-compat', openaiCompat: { apiKey: 'sk-1', baseUrl: 'https://api.groq.com/openai/v1' } },
      stt: { provider: 'openai-compat', model: 'whisper-large-v3-turbo' },
      theme: 'light',
      onboarding: { done: true, completedAt: at },
    });
    expect(parsed.ai.provider).toBe('openai-compat');
    expect(parsed.ai.openaiCompat.apiKey).toBe('sk-1');
    expect(parsed.ai.openaiCompat.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(parsed.ai.openaiCompat.models.fast).toBe('gpt-4o-mini');
    expect(parsed.stt).toMatchObject({ provider: 'openai-compat', model: 'whisper-large-v3-turbo', language: 'ru' });
    expect(parsed.theme).toBe('light');
    expect(parsed.onboarding).toEqual({ done: true, completedAt: at });
  });

  it('drops a malformed sealed-secrets blob instead of failing', () => {
    expect(settingsSchema.parse({ lock: { sealedSecrets: { v: 2 } } }).lock.sealedSecrets).toBeNull();
  });
});

function lessonParse(value: unknown) {
  return itemSchema.parse(value);
}
