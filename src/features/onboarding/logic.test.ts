import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { NOT_DOING, aboutFor, aiSettingsPatch, profilePatch } from './logic';

describe('profile from the dialogue', () => {
  it('turns the chip into the profile text, and "Другое" into what was typed', () => {
    expect(aboutFor('work', '')).toBe('Работа');
    expect(aboutFor('project', 'игнор')).toBe('Свой проект');
    expect(aboutFor('other', '  Готовлю к OKR ')).toBe('Готовлю к OKR');
    expect(aboutFor('other', '  ')).toBe('Другое');
    expect(aboutFor(null, 'x')).toBe('');
  });

  it('patches only what was filled in', () => {
    expect(profilePatch({ name: ' Саша ', occupation: 'work', other: '' })).toEqual({ name: 'Саша', about: 'Работа' });
    expect(profilePatch({ name: '', occupation: null, other: '' })).toEqual({});
    expect(profilePatch({ name: 'Аня', occupation: null, other: '' })).toEqual({ name: 'Аня' });
  });
});

describe('AI settings from the key step', () => {
  it('fills the Anthropic key', () => {
    expect(aiSettingsPatch({ provider: 'anthropic', apiKey: ' k ', baseUrl: 'ignored' })).toEqual({ ai: { provider: 'anthropic', anthropic: { apiKey: 'k' } } });
  });

  it('fills the OpenAI-compatible key and address; an empty address keeps the default', () => {
    expect(aiSettingsPatch({ provider: 'openai-compat', apiKey: 'k', baseUrl: ' https://api.groq.com/openai/v1 ' })).toEqual({
      ai: { provider: 'openai-compat', openaiCompat: { apiKey: 'k', baseUrl: 'https://api.groq.com/openai/v1' } },
    });
    expect(aiSettingsPatch({ provider: 'openai-compat', apiKey: 'k', baseUrl: ' ' }).ai).toEqual({ provider: 'openai-compat', openaiCompat: { apiKey: 'k' } });
  });
});

describe('the promise', () => {
  it('lists four things the app does not do', () => {
    expect(NOT_DOING).toHaveLength(4);
    expect(NOT_DOING.every((line) => t(line).startsWith('Не '))).toBe(true);
  });
});
