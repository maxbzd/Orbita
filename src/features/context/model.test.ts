import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, CONTEXT_SECTIONS, presetForPerson } from '../../ai';
import { budgetState, defaultDraft, draftFromPreset, draftToOptions, formatCount, packFileName, personFromSearch, presetChips, presetFromDraft, toggleId, toggleSection } from './model';

describe('draft and presets', () => {
  it('starts with every section, two weeks, and the privacy level of the settings', () => {
    const draft = defaultDraft('initials');
    expect(draft).toMatchObject({ windowDays: 14, privacy: 'initials', maxTokens: 8000, format: 'markdown', personIds: [], projectIds: [] });
    expect(draft.sections).toEqual([...CONTEXT_SECTIONS]);
  });

  it('a built-in preset replaces sections, window, privacy and limit but keeps the format', () => {
    const base = { ...defaultDraft('full'), format: 'json' as const };
    const morning = BUILTIN_PRESETS.find((preset) => preset.name === 'Утренний разбор');
    const draft = draftFromPreset(morning!, base);
    expect(draft.sections).toEqual(['profile', 'commitments', 'tasks', 'decisions', 'predictions', 'recent']);
    expect(draft).toMatchObject({ windowDays: 3, maxTokens: 4000, format: 'json' });
  });

  it('a person preset (deep link) filters by that person', () => {
    const draft = draftFromPreset(presetForPerson({ id: 'p1', name: 'Маша' }), defaultDraft());
    expect(draft.personIds).toEqual(['p1']);
    expect(draft.windowDays).toBe(60);
  });

  it('saving a draft and applying it back gives the same draft', () => {
    const draft = { ...defaultDraft('anonymous'), sections: toggleSection(defaultDraft().sections, 'facts'), windowDays: 30, personIds: ['a', 'b'] };
    const preset = presetFromDraft('  Мой  ', draft);
    expect(preset.name).toBe('Мой');
    expect(draftFromPreset(preset, defaultDraft())).toEqual(draft);
  });

  it('turns a draft into pack options', () => {
    const now = new Date('2026-10-08T09:00:00Z');
    expect(draftToOptions(defaultDraft('full'), now)).toMatchObject({ windowDays: 14, privacy: 'full', maxTokens: 8000, format: 'markdown', now });
  });

  it('lists built-in templates, then the user\'s own, without repeating a seeded one', () => {
    const saved = [
      { id: 's1', name: 'Утренний разбор', sections: [], windowDays: 3, personIds: [], projectIds: [], privacy: 'full' as const, maxTokens: 4000 },
      { id: 's2', name: 'Мой', sections: [], windowDays: 7, personIds: [], projectIds: [], privacy: 'full' as const, maxTokens: 4000 },
    ];
    const chips = presetChips(BUILTIN_PRESETS, saved);
    expect(chips.map((chip) => chip.name)).toEqual(['Недельный обзор', 'Стратегическая сессия', 'Утренний разбор', 'Мой']);
    expect(chips.filter((chip) => chip.id).map((chip) => chip.id)).toEqual(['s1', 's2']);
  });
});

describe('small helpers', () => {
  it('keeps the section order and never empties the list', () => {
    expect(toggleSection(['profile', 'facts'], 'projects')).toEqual(['profile', 'projects', 'facts']);
    expect(toggleSection(['profile', 'facts'], 'facts')).toEqual(['profile']);
    expect(toggleSection(['profile'], 'profile')).toEqual(['profile']);
  });
  it('toggles ids', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('reads the person from the deep link', () => {
    expect(personFromSearch('?person=abc')).toBe('abc');
    expect(personFromSearch('?person=')).toBeNull();
    expect(personFromSearch('')).toBeNull();
  });
  it('measures the budget', () => {
    expect(budgetState(4000, 8000)).toEqual({ ratio: 0.5, nearLimit: false });
    expect(budgetState(9000, 8000)).toEqual({ ratio: 1, nearLimit: true });
    expect(budgetState(10, 0).ratio).toBe(0);
  });
  it('formats numbers and file names', () => {
    expect(formatCount(8000).replace(/\s/g, ' ')).toBe('8 000');
    expect(packFileName('markdown', new Date(2026, 9, 8, 12))).toBe('orbita-context-2026-10-08.md');
    expect(packFileName('json', new Date(2026, 9, 8, 12))).toBe('orbita-context-2026-10-08.json');
  });
});
