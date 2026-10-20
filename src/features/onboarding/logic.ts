import type { AiProviderId } from '../../domain/types';
import { msg, t } from '../../i18n';

/** What the user does (screen 2 of the onboarding). Stored as text in `Profile.about`. */
export type Occupation = 'work' | 'study' | 'project' | 'other';

export const OCCUPATIONS: ReadonlyArray<{ value: Occupation; label: string }> = [
  { value: 'work', label: msg('Work') },
  { value: 'study', label: msg('Study') },
  { value: 'project', label: msg('My own project') },
  { value: 'other', label: msg('Other') },
];

/** The text saved into the profile: a chip's label, or what the user typed under "Other". */
export function aboutFor(occupation: Occupation | null, other: string): string {
  if (occupation === null) return '';
  if (occupation === 'other') return other.trim() || t('Other');
  const label = OCCUPATIONS.find((option) => option.value === occupation)?.label;
  return label ? t(label) : '';
}

/** The patch for the profile: only what the user filled in (the rest is never overwritten with blanks). */
export function profilePatch({ name, occupation, other }: { name: string; occupation: Occupation | null; other: string }): { name?: string; about?: string } {
  const patch: { name?: string; about?: string } = {};
  const cleanName = name.trim();
  if (cleanName !== '') patch.name = cleanName;
  const about = aboutFor(occupation, other);
  if (about !== '') patch.about = about;
  return patch;
}

export type KeyProvider = Extract<AiProviderId, 'anthropic' | 'openai-compat'>;

export const KEY_PROVIDERS: ReadonlyArray<{ value: KeyProvider; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai-compat', label: msg('OpenAI-compatible') },
];

/** The settings patch that connects the model; the key is trimmed, an empty key changes nothing. */
export function aiSettingsPatch({ provider, apiKey, baseUrl }: { provider: KeyProvider; apiKey: string; baseUrl: string }) {
  const key = apiKey.trim();
  if (provider === 'anthropic') return { ai: { provider, anthropic: { apiKey: key } } };
  const url = baseUrl.trim();
  return { ai: { provider, openaiCompat: { apiKey: key, ...(url !== '' && { baseUrl: url }) } } };
}

/** The phrase the trainer asks the user to say. */
export const trainerPhrase = (): string => t('I decided to start the course in November because…');

/** What the app does NOT do: four crossed-out promises on the first screen. */
export const NOT_DOING: readonly string[] = [
  msg('I send nothing without your action'),
  msg('I never show your records to others'),
  msg('I collect no analytics'),
  msg('I do not learn from your records'),
];
