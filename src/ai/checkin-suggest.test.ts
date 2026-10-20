import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, checkinsRepo, wipeAll } from '../db';
import type { Capture } from '../domain/types';
import { MOOD_MIN_CONFIDENCE, applyMoodSuggestion, moodToCheckIn } from './checkin-suggest';
import type { ExtractedMood } from './prompts/schemas';

const mood = (overrides: Partial<ExtractedMood> = {}): ExtractedMood => ({
  valence: -0.4,
  energy: 0.2,
  focus: null,
  stress: 0.7,
  tags: ['#Сон', 'сон', 'работа'],
  note: ' Не выспался ',
  confidence: 0.7,
  quote: null,
  ...overrides,
});

let capture: Capture;

beforeEach(async () => {
  await wipeAll();
  capture = await capturesRepo.create({ kind: 'voice', day: '2026-10-08', createdAt: '2026-10-08T09:00:00Z', text: 'Устал' });
});

describe('moodToCheckIn', () => {
  it('describes a suggested state tied to the record, with clean tags and no empty fields', () => {
    expect(moodToCheckIn(capture, mood())).toEqual({
      at: '2026-10-08T09:00:00Z',
      day: '2026-10-08',
      valence: -0.4,
      energy: 0.2,
      stress: 0.7,
      tags: ['сон', 'работа'],
      note: 'Не выспался',
      captureId: capture.id,
      origin: 'ai_suggested',
    });
    expect(moodToCheckIn(capture, mood({ note: '  ', stress: null }))).not.toHaveProperty('note');
    expect(moodToCheckIn(capture, mood({ stress: null }))).not.toHaveProperty('stress');
  });
});

describe('applyMoodSuggestion', () => {
  it('stores a confident state as a suggestion the user can confirm', async () => {
    const stored = await applyMoodSuggestion(capture, mood());
    expect(stored).toMatchObject({ origin: 'ai_suggested', captureId: capture.id, valence: -0.4 });
    expect(await checkinsRepo.listByDay('2026-10-08')).toHaveLength(1);
  });

  it('makes no suggestion when the model is not sure enough or there is no state', async () => {
    expect(await applyMoodSuggestion(capture, mood({ confidence: MOOD_MIN_CONFIDENCE - 0.01 }))).toBeUndefined();
    expect(await applyMoodSuggestion(capture, null)).toBeUndefined();
    expect(await applyMoodSuggestion(capture, undefined)).toBeUndefined();
    expect(await applyMoodSuggestion(capture, mood({ valence: Number.NaN }))).toBeUndefined();
    expect(await checkinsRepo.listByDay('2026-10-08')).toEqual([]);
  });

  it('refreshes its own earlier suggestion instead of adding a second one', async () => {
    const first = await applyMoodSuggestion(capture, mood());
    const second = await applyMoodSuggestion(capture, mood({ valence: 0.5, energy: 0.9, stress: null, tags: ['отдых'] }));
    expect(second?.id).toBe(first?.id);
    expect(second).toMatchObject({ valence: 0.5, energy: 0.9, tags: ['отдых'] });
    expect(second?.stress).toBeUndefined();
    expect(await checkinsRepo.listByDay('2026-10-08')).toHaveLength(1);
  });

  it('removes its suggestion when a new run no longer finds the state', async () => {
    await applyMoodSuggestion(capture, mood());
    expect(await applyMoodSuggestion(capture, null)).toBeUndefined();
    expect(await checkinsRepo.listByDay('2026-10-08')).toEqual([]);
  });

  it('never touches what the user entered or confirmed', async () => {
    const manual = await checkinsRepo.create({ valence: 0.9, energy: 0.9, day: '2026-10-08', at: '2026-10-08T09:30:00Z', captureId: capture.id, origin: 'manual' });
    expect(await applyMoodSuggestion(capture, mood())).toBeUndefined();
    expect(await applyMoodSuggestion(capture, null)).toBeUndefined();
    expect(await checkinsRepo.listByDay('2026-10-08')).toEqual([manual]);

    const confirmed = await checkinsRepo.confirm((await checkinsRepo.create({ valence: 0, energy: 0.5, day: '2026-10-09', at: '2026-10-09T09:00:00Z', origin: 'ai_suggested', captureId: capture.id })).id);
    const other = await capturesRepo.create({ kind: 'text', day: '2026-10-09', createdAt: '2026-10-09T09:00:00Z', text: 'x' });
    await checkinsRepo.update(confirmed.id, { captureId: other.id });
    expect(await applyMoodSuggestion(other, mood())).toBeUndefined();
    expect((await checkinsRepo.get(confirmed.id))?.origin).toBe('ai_confirmed');
  });
});
