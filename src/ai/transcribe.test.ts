import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, audioRepo, capturesRepo, profileRepo, wipeAll } from '../db';
import { defaultSettings } from '../db/settings';
import { AbortedError, OfflineError, UnsupportedError } from './errors';
import type { SttProvider, TranscribeOptions } from './providers/types';
import { applyGlossary, buildSttPrompt, restingStatus, transcribeCapture } from './transcribe';

const stt = (text: string, durationSec?: number): SttProvider & { calls: TranscribeOptions[] } => {
  const calls: TranscribeOptions[] = [];
  return {
    id: 'mock',
    calls,
    transcribe: (_blob, options) => {
      calls.push(options);
      return Promise.resolve({ text, ...(durationSec !== undefined && { durationSec }) });
    },
  };
};

const failingStt = (error: Error): SttProvider => ({ id: 'mock', transcribe: () => Promise.reject(error) });

async function voiceCapture(extra: Partial<Parameters<typeof capturesRepo.create>[0]> = {}) {
  const capture = await capturesRepo.create({ kind: 'voice', day: '2026-10-08', ...extra });
  await audioRepo.save(capture.id, new Blob(['sound'], { type: 'audio/webm' }));
  return capture;
}

beforeEach(wipeAll);

describe('buildSttPrompt', () => {
  it('lists the built-in niche abbreviations first, then the author\'s terms once each', () => {
    expect(buildSttPrompt([{ term: 'тестовое' }, { term: 'OKR' }, { term: ' Zoom ', hint: 'видеосвязь' }, { term: '' }])).toBe('Термины: OKR, KPI, CRM, тестовое, Zoom.');
  });

  it('stays short however long the glossary is', () => {
    const glossary = Array.from({ length: 300 }, (_, index) => ({ term: `термин-номер-${index}` }));
    const prompt = buildSttPrompt(glossary);
    expect(prompt.length).toBeLessThanOrEqual(620);
    expect(prompt.startsWith('Термины: OKR, KPI, CRM, термин-номер-0')).toBe(true);
  });
});

describe('applyGlossary', () => {
  it('restores the spelling of abbreviations and capitalized terms', () => {
    const result = applyGlossary('готовлю okr и kpi, показываю в zoom, crm вырос', [{ term: 'Zoom' }]);
    expect(result).toEqual({ text: 'готовлю OKR и KPI, показываю в Zoom, CRM вырос', replacements: 4 });
  });

  it('joins an abbreviation the recognizer spelled out', () => {
    expect(applyGlossary('Пишут O-K-R, а потом k.p.i.', []).text).toBe('Пишут OKR, а потом KPI');
  });

  it('never rewrites inflected words, lower-case terms or parts of other words', () => {
    const glossary = [{ term: 'Zoom' }, { term: 'тестовик' }];
    const text = 'Пробник в zoomе, okrшный Пробник, OKR-2026';
    expect(applyGlossary(text, glossary).text).toBe('Пробник в zoomе, okrшный Пробник, OKR-2026');
  });

  it('counts only real changes', () => {
    expect(applyGlossary('OKR уже верно', []).replacements).toBe(0);
  });

  it('is safe with terms full of regex characters', () => {
    expect(applyGlossary('Работаю в C++ и (на) Zoom', [{ term: 'C++' }, { term: '(на)' }]).text).toBe('Работаю в C++ и (на) Zoom');
  });
});

describe('restingStatus', () => {
  it('maps busy statuses to a place to rest and leaves others alone', () => {
    expect(restingStatus('transcribing', 'raw')).toBe('raw');
    expect(restingStatus('extracting', 'transcribed')).toBe('transcribed');
    expect(restingStatus('review', 'raw')).toBe('review');
    expect(restingStatus('failed', 'raw')).toBe('failed');
  });
});

describe('transcribeCapture', () => {
  it('stores the text as heard and the text cleaned with the glossary, and moves on', async () => {
    await profileRepo.save({ glossary: [{ term: 'тестовое', hint: 'первое занятие' }] });
    const capture = await voiceCapture();
    const recognizer = stt('  Сегодня тестовое, готовим okr  ', 42);
    const result = await transcribeCapture(capture.id, { stt: recognizer });

    expect(result).toMatchObject({ rawText: 'Сегодня тестовое, готовим okr', text: 'Сегодня тестовое, готовим OKR', status: 'transcribed', durationSec: 42 });
    expect(result.error).toBeUndefined();
    expect(recognizer.calls[0]).toMatchObject({ lang: 'ru', prompt: 'Термины: OKR, KPI, CRM, тестовое.' });
  });

  it('keeps the duration the recording already has', async () => {
    const capture = await voiceCapture({ durationSec: 30 });
    const recognizer = stt('текст', 99);
    expect((await transcribeCapture(capture.id, { stt: recognizer })).durationSec).toBe(30);
    expect(recognizer.calls[0].durationSec).toBe(30);
  });

  it('replaces an earlier text when run again', async () => {
    const capture = await voiceCapture({ text: 'старый текст', rawText: 'старый' });
    const result = await transcribeCapture(capture.id, { stt: stt('новый текст') });
    expect(result).toMatchObject({ text: 'новый текст', rawText: 'новый текст' });
  });

  it('marks silence as skipped with empty text', async () => {
    const capture = await voiceCapture();
    expect(await transcribeCapture(capture.id, { stt: stt('   ') })).toMatchObject({ status: 'skipped', text: '', rawText: '' });
  });

  it('saves a failure on the capture for the retry button and rethrows it', async () => {
    const capture = await voiceCapture();
    await expect(transcribeCapture(capture.id, { stt: failingStt(new OfflineError()) })).rejects.toBeInstanceOf(OfflineError);
    const failed = await capturesRepo.get(capture.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toMatch(/[а-яё]/i);
  });

  it('puts the capture back where it was when cancelled', async () => {
    const capture = await voiceCapture();
    await expect(transcribeCapture(capture.id, { stt: failingStt(new AbortedError()) })).rejects.toBeInstanceOf(AbortedError);
    expect((await capturesRepo.get(capture.id))?.status).toBe('raw');
  });

  it('passes the cancel signal on and the language from the settings', async () => {
    const capture = await voiceCapture();
    const controller = new AbortController();
    const transcribe = vi.fn(() => Promise.resolve({ text: 'ок' }));
    await transcribeCapture(capture.id, {
      stt: { id: 'mock', transcribe },
      signal: controller.signal,
      settings: { ...defaultSettings(), stt: { ...defaultSettings().stt, language: 'en' } },
    });
    expect(transcribe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lang: 'en', signal: controller.signal }));
  });

  it('refuses a capture without audio or a missing one', async () => {
    const text = await capturesRepo.create({ kind: 'text', text: 'написано' });
    await expect(transcribeCapture(text.id, { stt: stt('x') })).rejects.toBeInstanceOf(UnsupportedError);
    await expect(transcribeCapture('missing', { stt: stt('x') })).rejects.toBeInstanceOf(NotFoundError);
  });
});
