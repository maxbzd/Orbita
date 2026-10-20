import { CONTEXT_SECTIONS, DEFAULT_MAX_TOKENS, DEFAULT_WINDOW_DAYS, isContextSection, optionsFromPreset } from '../../ai';
import type { ContextPackOptions, ContextSectionId, PresetTemplate } from '../../ai';
import type { ContextPackPreset, ID, PrivacyLevel } from '../../domain/types';
import { localDayKey } from '../../domain/dates';

/** The state of the context builder and its conversions, kept apart from React so that it can be tested. */

export type PackFormat = 'markdown' | 'json';

export interface ContextDraft {
  sections: ContextSectionId[];
  windowDays: number;
  personIds: ID[];
  projectIds: ID[];
  privacy: PrivacyLevel;
  maxTokens: number;
  format: PackFormat;
}

export const WINDOW_CHOICES = [3, 7, 14, 30, 90] as const;
export const BUDGET_CHOICES = [2_000, 4_000, 8_000, 16_000, 32_000] as const;

export function defaultDraft(privacy: PrivacyLevel = 'full'): ContextDraft {
  return {
    sections: [...CONTEXT_SECTIONS],
    windowDays: DEFAULT_WINDOW_DAYS,
    personIds: [],
    projectIds: [],
    privacy,
    maxTokens: DEFAULT_MAX_TOKENS,
    format: 'markdown',
  };
}

/** A preset (built-in, saved, or made for a person) applied over the current draft (the format stays). */
export function draftFromPreset(preset: PresetTemplate, current: ContextDraft): ContextDraft {
  const options = optionsFromPreset(preset);
  const sections = (options.sections ?? []).filter(isContextSection);
  return {
    ...current,
    sections: sections.length > 0 ? CONTEXT_SECTIONS.filter((id) => sections.includes(id)) : [...CONTEXT_SECTIONS],
    windowDays: options.windowDays ?? current.windowDays,
    personIds: [...(options.personIds ?? [])],
    projectIds: [...(options.projectIds ?? [])],
    privacy: options.privacy ?? current.privacy,
    maxTokens: options.maxTokens ?? current.maxTokens,
  };
}

/** What gets stored when the user saves their own preset. */
export function presetFromDraft(name: string, draft: ContextDraft): PresetTemplate {
  return {
    name: name.trim(),
    sections: [...draft.sections],
    windowDays: draft.windowDays,
    personIds: [...draft.personIds],
    projectIds: [...draft.projectIds],
    privacy: draft.privacy,
    maxTokens: draft.maxTokens,
  };
}

export const draftToOptions = (draft: ContextDraft, now?: Date): ContextPackOptions => ({
  sections: draft.sections,
  windowDays: draft.windowDays,
  personIds: draft.personIds,
  projectIds: draft.projectIds,
  privacy: draft.privacy,
  maxTokens: draft.maxTokens,
  format: draft.format,
  ...(now && { now }),
});

/** Adds or removes a section, keeping the canonical order. The last section cannot be removed. */
export function toggleSection(sections: readonly ContextSectionId[], id: ContextSectionId): ContextSectionId[] {
  const has = sections.includes(id);
  if (has && sections.length === 1) return [...sections];
  const next = has ? sections.filter((section) => section !== id) : [...sections, id];
  return CONTEXT_SECTIONS.filter((section) => next.includes(section));
}

export const toggleId = (ids: readonly ID[], id: ID): ID[] => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

/** `?person=<id>` of a deep link (the person card's "Подготовка к разговору"). */
export function personFromSearch(search: string): ID | null {
  const value = new URLSearchParams(search).get('person');
  return value && value.trim() !== '' ? value : null;
}

/** Where the size stands against the budget: 0..1 of the bar, and whether the pack was cut. */
export function budgetState(tokens: number, maxTokens: number): { ratio: number; nearLimit: boolean } {
  const ratio = maxTokens > 0 ? Math.min(1, tokens / maxTokens) : 0;
  return { ratio, nearLimit: ratio >= 0.9 };
}

const numberFormat = new Intl.NumberFormat('ru-RU');
/** `8000` → `8 000` (non-breaking spaces from Intl). */
export const formatCount = (value: number): string => numberFormat.format(value);

/** `orbita-context-2026-10-08.md` */
export function packFileName(format: PackFormat, now: Date = new Date()): string {
  return `orbita-context-${localDayKey(now)}.${format === 'json' ? 'json' : 'md'}`;
}

/** Built-in templates and the user's own, as one list for the chips: templates first. */
export interface PresetChip {
  key: string;
  name: string;
  preset: PresetTemplate;
  /** Stored by the user: can be deleted. */
  id?: ID;
}

export function presetChips(builtin: readonly PresetTemplate[], saved: readonly ContextPackPreset[]): PresetChip[] {
  const savedNames = new Set(saved.map((preset) => preset.name));
  return [
    ...builtin.filter((preset) => !savedNames.has(preset.name)).map((preset) => ({ key: `builtin:${preset.name}`, name: preset.name, preset })),
    ...saved.map((preset) => ({ key: `saved:${preset.id}`, name: preset.name, preset, id: preset.id })),
  ];
}
